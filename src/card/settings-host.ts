import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

import { inspectCardStatus, readInstalledPackageVersion } from './status.js'
import { checkForUpdates } from './check-update.js'
import type { CardRpcPayload } from './types.js'

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

export function registerSettingsCard(ctx: Context): void {
  ctx.inject(['settings'], (scoped) => {
    installSettingsSection(scoped, FLOW2SPEC_SETTINGS_NS, EmptyCardSchema, {}, {
      setSource: () => {},
      onChange: () => {},
    })
  })

  ctx.inject(['connection'], (scoped) => {
    const connection = (scoped as Context & { connection: { rpc: RpcHandle } }).connection
    const dispose = connection.rpc.handle(FLOW2SPEC_RPC_CHANNEL, async (endpoint, payload, signal) => {
      try {
        const cwd = readCwd(payload)
        if (endpoint === 'card.status') {
          return { ok: true as const, value: inspectCardStatus({
            ...(cwd === undefined ? {} : { cwd }),
            ...hostVersions(),
          }) }
        }
        if (endpoint === 'card.checkUpdate') {
          return { ok: true as const, value: await checkForUpdates({
            ...(cwd === undefined ? {} : { cwd }),
            signal,
          }) }
        }
        return {
          ok: false as const,
          error: {
            code: 'bad-request',
            message: `Unknown Flow2Spec card endpoint: ${endpoint}`,
            details: { issues: [] },
          },
        }
      } catch (error) {
        return {
          ok: false as const,
          error: {
            code: 'internal',
            message: error instanceof Error ? error.message : String(error),
            details: {},
          },
        }
      }
    }, { authority: 'loopback' })
    scoped.effect(() => () => {
      void dispose()
    })
  })
}

function readCwd(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const cwd = (payload as CardRpcPayload).cwd
  if (typeof cwd !== 'string') return undefined
  const trimmed = cwd.trim()
  return trimmed === '' ? undefined : trimmed
}

function hostVersions(): { hostVersion?: string; cordisVersion?: string } {
  const hostVersion = readInstalledPackageVersion('@deepseek-ai/dsh-agent')
  const cordisVersion = readInstalledPackageVersion('@deepseek-ai/cordis')
  return {
    ...(hostVersion === 'unknown' ? {} : { hostVersion }),
    ...(cordisVersion === 'unknown' ? {} : { cordisVersion }),
  }
}
