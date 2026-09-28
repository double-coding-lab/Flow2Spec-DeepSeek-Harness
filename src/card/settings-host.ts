import type { IncomingMessage, ServerResponse } from 'node:http'

import { createFlow2Spec } from '@double-coding/flow2spec-core'
import type { Context } from '@deepseek-ai/cordis'

import { isConfigChange } from './config-fields.js'
import { CardConfigError, readWorkspaceConfig, saveWorkspaceConfig } from './config-io.js'
import { inspectCardStatus, readInstalledPackageVersion } from './status.js'
import { checkForUpdates } from './check-update.js'
import type { ConfigChange } from './types.js'
import type { Flow2SpecPluginRuntime } from '../runtime/plugin-runtime.js'

export const FLOW2SPEC_RPC_CHANNEL = '/flow2spec'

const MAX_RPC_BODY_BYTES = 1_048_576
const JSON_CONTENT_TYPE = 'application/json'

export type CardRpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<CardRpcResult>

interface HostConnectionLike {
  admit(request: IncomingMessage): { peer: unknown } | { rejection: 401 | 403 }
}

interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

export type CardRuntime = Pick<Flow2SpecPluginRuntime, 'invalidate' | 'configSnapshot'>

export type CardRpcResult = {
  ok: true
  value: unknown
} | {
  ok: false
  error: { code: string; message: string; details: Record<string, unknown> }
}

/**
 * Serve the card channel from our own prefix route. `connection.rpc.handle()`
 * is unusable in the verified baseline: it registers through the connection
 * service's own context, which has no `webServer` in its inject list, so every
 * call throws `cannot get property "webServer" without inject`. Registering the
 * route directly keeps the trust fence by routing admission through
 * `connection.admit`.
 */
export function registerSettingsCard(ctx: Context, runtime: CardRuntime): void {
  ctx.inject(['connection', 'webServer'], (scoped) => {
    const connection = (scoped as Context & { connection: HostConnectionLike }).connection
    const webServer = (scoped as Context & { webServer: WebServerLike }).webServer
    const handle = createCardRpcHandler(runtime)
    scoped.effect(() => webServer.register({
      kind: 'prefix',
      path: FLOW2SPEC_RPC_CHANNEL,
      handler: (req, res) => serveCardRpc(connection, handle, req, res),
    }), `flow2spec: ${FLOW2SPEC_RPC_CHANNEL} RPC channel`)
  })
}

async function serveCardRpc(
  connection: HostConnectionLike,
  handle: CardRpcHandler,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const admission = connection.admit(req)
  if ('rejection' in admission) {
    res.writeHead(admission.rejection)
    res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
    return
  }
  const endpoint = endpointOf(req.url)
  if (req.method !== 'POST' || endpoint === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  if (contentTypeOf(req) !== JSON_CONTENT_TYPE) {
    res.writeHead(415)
    res.end(`content type must be ${JSON_CONTENT_TYPE}`)
    return
  }
  const raw = await readBody(req)
  if (raw === undefined) {
    res.writeHead(413)
    res.end()
    return
  }
  let envelope: { rpcId?: unknown; method?: unknown; payload?: unknown }
  try {
    envelope = JSON.parse(raw) as typeof envelope
  } catch {
    res.writeHead(400)
    res.end('body is not JSON')
    return
  }
  const rpcId = typeof envelope.rpcId === 'string' ? envelope.rpcId : undefined
  if (rpcId === undefined || typeof envelope.method !== 'string') {
    res.writeHead(400)
    res.end('invalid RPC envelope')
    return
  }
  if (envelope.method !== endpoint) {
    writeReply(res, rpcId, {
      ok: false,
      error: {
        code: 'card/bad-request',
        message: `method ${JSON.stringify(envelope.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
        details: {},
      },
    })
    return
  }
  const controller = new AbortController()
  res.on('close', () => controller.abort())
  try {
    writeReply(res, rpcId, await handle(endpoint, envelope.payload, controller.signal))
  } catch (error) {
    writeReply(res, rpcId, {
      ok: false,
      error: {
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
        details: {},
      },
    })
  }
}

function writeReply(res: ServerResponse, rpcId: string, result: CardRpcResult): void {
  res.writeHead(200, { 'content-type': JSON_CONTENT_TYPE })
  res.end(JSON.stringify({ type: 'server-response', rpcId, result }))
}

function endpointOf(url: string | undefined): string | undefined {
  const pathname = (url ?? '').split('?', 1)[0] ?? ''
  const prefix = `${FLOW2SPEC_RPC_CHANNEL}/`
  if (!pathname.startsWith(prefix)) return undefined
  const endpoint = pathname.slice(prefix.length)
  return /^[A-Za-z0-9_$.-]+$/.test(endpoint) ? endpoint : undefined
}

function contentTypeOf(req: IncomingMessage): string {
  return (req.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    received += buffer.byteLength
    if (received > MAX_RPC_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function createCardRpcHandler(
  runtime: CardRuntime,
): CardRpcHandler {
  return async (endpoint, payload, signal) => {
    try {
      if (endpoint === 'card.status') {
        const cwd = readCwd(payload)
        return {
          ok: true,
          value: inspectCardStatus({
            ...(cwd === undefined ? {} : { cwd }),
            ...hostVersions(),
          }),
        }
      }
      if (endpoint === 'card.checkUpdate') {
        const cwd = readCwd(payload)
        return {
          ok: true,
          value: await checkForUpdates({
            ...(cwd === undefined ? {} : { cwd }),
            signal,
          }),
        }
      }
      if (endpoint === 'card.config.read') {
        return { ok: true, value: readWorkspaceConfig(requireCwd(payload)) }
      }
      if (endpoint === 'card.config.save') {
        const save = readSavePayload(payload)
        const result = saveWorkspaceConfig(save)
        runtime.invalidate(save.root)
        return { ok: true, value: result }
      }
      if (endpoint === 'card.project.init') {
        return { ok: true, value: await initWorkspace(requireCwd(payload), runtime, signal) }
      }
      return fail('bad-request', `Unknown Flow2Spec card endpoint: ${endpoint}`)
    } catch (error) {
      if (error instanceof CardRpcRequestError) {
        return fail(error.code, error.message, error.details)
      }
      if (error instanceof CardConfigError) {
        return fail(error.code, error.message)
      }
      return fail('internal', error instanceof Error ? error.message : String(error))
    }
  }
}

class CardRpcRequestError extends Error {
  readonly code: 'bad-request' | 'already-initialized'
  readonly details: Record<string, unknown>

  constructor(
    code: 'bad-request' | 'already-initialized',
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'CardRpcRequestError'
    this.code = code
    this.details = details
  }
}

async function initWorkspace(
  cwd: string,
  runtime: CardRuntime,
  signal: AbortSignal,
): Promise<unknown> {
  const current = readWorkspaceConfig(cwd)
  if (current.initialized) {
    throw new CardRpcRequestError(
      'already-initialized',
      'Workspace is already initialized.',
      { ...current },
    )
  }
  const locale = runtime.configSnapshot().locale
  const api = createFlow2Spec({ cwd, signal })
  const result = await api.project.init({
    mode: 'native-host',
    ...(locale === 'auto' ? {} : { locale }),
  })
  signal.throwIfAborted()
  runtime.invalidate(cwd)
  const next = readWorkspaceConfig(cwd)
  return { ids: result.ids, ...next }
}

function readSavePayload(payload: unknown): {
  root: string
  fingerprint: string
  changes: ConfigChange[]
} {
  const cwd = requireCwd(payload)
  if (payload === null || typeof payload !== 'object') {
    throw new CardRpcRequestError('bad-request', 'Save payload must be an object.')
  }
  const fingerprint = (payload as { fingerprint?: unknown }).fingerprint
  if (typeof fingerprint !== 'string') {
    throw new CardRpcRequestError('bad-request', 'fingerprint is required.')
  }
  const changes = (payload as { changes?: unknown }).changes
  if (!Array.isArray(changes) || !changes.every(isConfigChange)) {
    throw new CardRpcRequestError('bad-request', 'changes must be an array of field updates.')
  }
  return { root: cwd, fingerprint, changes }
}

function requireCwd(payload: unknown): string {
  const cwd = readCwd(payload)
  if (cwd === undefined) throw new CardRpcRequestError('bad-request', 'cwd is required.')
  return cwd
}

function readCwd(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const cwd = (payload as { cwd?: unknown }).cwd
  if (typeof cwd !== 'string') return undefined
  const trimmed = cwd.trim()
  return trimmed === '' ? undefined : trimmed
}

function fail(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): CardRpcResult {
  return { ok: false, error: { code, message, details } }
}

function hostVersions(): { hostVersion?: string; cordisVersion?: string } {
  const hostVersion = readInstalledPackageVersion('@deepseek-ai/dsh-agent')
  const cordisVersion = readInstalledPackageVersion('@deepseek-ai/cordis')
  return {
    ...(hostVersion === 'unknown' ? {} : { hostVersion }),
    ...(cordisVersion === 'unknown' ? {} : { cordisVersion }),
  }
}
