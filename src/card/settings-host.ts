import { createFlow2Spec } from '@double-coding/flow2spec-core'
import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

import { isConfigChange } from './config-fields.js'
import { CardConfigError, readWorkspaceConfig, saveWorkspaceConfig } from './config-io.js'
import { inspectCardStatus, readInstalledPackageVersion } from './status.js'
import { checkForUpdates } from './check-update.js'
import type { ConfigChange } from './types.js'
import type { Flow2SpecPluginRuntime } from '../runtime/plugin-runtime.js'

export const FLOW2SPEC_SETTINGS_NS = settingsNamespace('flow2spec')
export const FLOW2SPEC_RPC_CHANNEL = '/flow2spec'

const EmptyCardSchema = z.object({})

interface RpcHandle {
  handle(
    channel: string,
    handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<{
      ok: true
      value: unknown
    } | {
      ok: false
      error: { code: string; message: string; details: Record<string, unknown> }
    }>,
    options: { authority: 'loopback' | 'trusted-host' },
  ): () => Promise<void>
}

export type CardRuntime = Pick<Flow2SpecPluginRuntime, 'invalidate' | 'configSnapshot'>

export type CardRpcResult = {
  ok: true
  value: unknown
} | {
  ok: false
  error: { code: string; message: string; details: Record<string, unknown> }
}

export function registerSettingsCard(ctx: Context, runtime: CardRuntime): void {
  ctx.inject(['settings'], (scoped) => {
    installSettingsSection(scoped, FLOW2SPEC_SETTINGS_NS, EmptyCardSchema, {}, {
      setSource: () => {},
      onChange: () => {},
    })
  })

  ctx.inject(['connection'], (scoped) => {
    const connection = (scoped as Context & { connection: { rpc: RpcHandle } }).connection
    const handle = createCardRpcHandler(runtime)
    const dispose = connection.rpc.handle(FLOW2SPEC_RPC_CHANNEL, handle, { authority: 'loopback' })
    scoped.effect(() => () => {
      void dispose()
    })
  })
}

export function createCardRpcHandler(
  runtime: CardRuntime,
): (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<CardRpcResult> {
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
