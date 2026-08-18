import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createCardRpcHandler, type CardRuntime } from '../src/card/settings-host.js'
import { fingerprintOf, readWorkspaceConfig } from '../src/card/config-io.js'
import type { ResolvedFlow2SpecPluginConfig } from '../src/config.js'

function runtimeStub(): CardRuntime & { invalidate: ReturnType<typeof vi.fn> } {
  const invalidate = vi.fn()
  return {
    invalidate,
    configSnapshot(): ResolvedFlow2SpecPluginConfig {
      return {
        locale: 'zh-CN',
        autoInitialize: true,
        strictCompatibility: true,
        skills: { enabled: true, providerName: 'flow2spec', rank: 250 },
        routing: { enabled: true, injectContext: true, maxFiles: 20, maxLines: 400 },
        hooks: { sessionSummary: true, updateCheck: true, configPrecheck: true },
        commands: { enabled: true },
        tools: { readOnly: true, knowledgeWrite: true },
      }
    },
  }
}

describe('createCardRpcHandler', () => {
  it('reads workspace config by cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flow2spec-card-rpc-'))
    const raw = `${JSON.stringify({ intentRecognition: false }, null, 2)}\n`
    await writeFile(join(root, 'flow2spec.config.json'), raw, 'utf8')
    const handle = createCardRpcHandler(runtimeStub())
    const result = await handle('card.config.read', { cwd: root }, new AbortController().signal)
    expect(result).toEqual({
      ok: true,
      value: {
        initialized: true,
        config: { intentRecognition: false },
        fingerprint: fingerprintOf(raw),
      },
    })
  })

  it('saves changes and invalidates the runtime cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flow2spec-card-rpc-save-'))
    const raw = `${JSON.stringify({ subAgent: true }, null, 2)}\n`
    await writeFile(join(root, 'flow2spec.config.json'), raw, 'utf8')
    const stub = runtimeStub()
    const handle = createCardRpcHandler(stub)
    const result = await handle('card.config.save', {
      cwd: root,
      fingerprint: fingerprintOf(raw),
      changes: [{ path: ['subAgent'], value: false }],
    }, new AbortController().signal)
    expect(result.ok).toBe(true)
    expect(stub.invalidate).toHaveBeenCalledWith(root)
    expect(JSON.parse(await readFile(join(root, 'flow2spec.config.json'), 'utf8'))).toEqual({ subAgent: false })
  })

  it('maps config-conflict to an rpc error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flow2spec-card-rpc-conflict-'))
    await writeFile(join(root, 'flow2spec.config.json'), `${JSON.stringify({ subAgent: true }, null, 2)}\n`, 'utf8')
    const before = readWorkspaceConfig(root)
    await writeFile(join(root, 'flow2spec.config.json'), `${JSON.stringify({ subAgent: true, extra: true }, null, 2)}\n`, 'utf8')
    const handle = createCardRpcHandler(runtimeStub())
    const result = await handle('card.config.save', {
      cwd: root,
      fingerprint: before.fingerprint,
      changes: [{ path: ['subAgent'], value: false }],
    }, new AbortController().signal)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('config-conflict')
  })

  it('rejects init when the workspace is already initialized', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flow2spec-card-rpc-init-'))
    await writeFile(join(root, 'flow2spec.config.json'), '{}\n', 'utf8')
    const handle = createCardRpcHandler(runtimeStub())
    const result = await handle('card.project.init', { cwd: root }, new AbortController().signal)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('already-initialized')
    expect(result.error.details['initialized']).toBe(true)
  })

  it('rejects unknown endpoints and missing cwd', async () => {
    const handle = createCardRpcHandler(runtimeStub())
    const unknown = await handle('card.nope', {}, new AbortController().signal)
    expect(unknown.ok).toBe(false)
    if (unknown.ok) throw new Error('expected failure')
    expect(unknown.error.code).toBe('bad-request')
    const missing = await handle('card.config.read', {}, new AbortController().signal)
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error('expected failure')
    expect(missing.error.code).toBe('bad-request')
  })
})
