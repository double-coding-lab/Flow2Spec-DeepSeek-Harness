import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { ProjectRuntimeManager, type ProjectCoreApi } from '../src/runtime/project-runtime.js'
import { REQUIRED_CORE_CAPABILITIES } from '../src/compatibility.js'

function mockApi(root: string, init: () => Promise<unknown>): ProjectCoreApi {
  return {
    project: {
      init,
      inspect: () => ({ cwd: root, config: { locale: 'zh-CN' } }),
    },
    config: { load: () => ({ locale: 'zh-CN' }) },
    collaboration: { resolveDeveloper: () => ({ developerId: 'alice' }) },
    doctor: { run: () => ({ ok: true }) },
    routing: {
      match: (input: Record<string, unknown>) => ({ ...input }),
      expand: (result: Record<string, unknown>) => ({ ...result, topics: [] }),
      verify: () => ({ ok: true }),
      loadContext: () => ({ files: [] }),
    },
    resources: {
      root,
      capabilities: () => ({ protocolVersion: 2, capabilities: REQUIRED_CORE_CAPABILITIES.map(id => ({ id })) }),
    },
  } as unknown as ProjectCoreApi
}

describe('ProjectRuntimeManager', () => {
  it('finds the git root and coalesces initialization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flow2spec-dsh-runtime-'))
    await mkdir(join(root, '.git'))
    const nested = join(root, 'packages', 'app')
    await mkdir(nested, { recursive: true })
    const init = vi.fn(async () => ({}))
    const createCore = vi.fn(({ cwd }: { cwd: string }) => mockApi(cwd, init))
    const manager = new ProjectRuntimeManager(createCore)

    const [first, second] = await Promise.all([
      manager.get(nested, { autoInitialize: true, locale: 'auto' }),
      manager.get(nested, { autoInitialize: true, locale: 'auto' }),
    ])

    expect(first).toBe(second)
    expect(first.root).toBe(root)
    expect(init).toHaveBeenCalledTimes(1)
  })

  it('does not initialize when autoInitialize is disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flow2spec-dsh-runtime-'))
    const init = vi.fn(async () => ({}))
    const manager = new ProjectRuntimeManager(({ cwd }) => mockApi(cwd, init))
    await manager.get(root, { autoInitialize: false, locale: 'en-US' })
    expect(init).not.toHaveBeenCalled()
  })
})
