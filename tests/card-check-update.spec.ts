import { describe, expect, it } from 'vitest'

import { checkForUpdates, resetUpdateCheckInflight } from '../src/card/check-update.js'
import { PLUGIN_PACKAGE_NAME, PLUGIN_VERSION } from '../src/version.js'

describe('checkForUpdates', () => {
  it('reports current when the plugin matches npm and no workspace is linked', async () => {
    resetUpdateCheckInflight()
    const result = await checkForUpdates({
      fetchNpmLatest: async () => PLUGIN_VERSION,
    })
    expect(result.status).toBe('current')
    expect(result.ok).toBe(true)
    expect(result.diffs).toEqual([
      { name: 'plugin', current: PLUGIN_VERSION, latest: PLUGIN_VERSION, updateAvailable: false },
    ])
  })

  it('suggests a plugin upgrade without installing anything', async () => {
    resetUpdateCheckInflight()
    const result = await checkForUpdates({
      fetchNpmLatest: async (name) => {
        expect(name).toBe(PLUGIN_PACKAGE_NAME)
        return '9.9.9'
      },
    })
    expect(result.status).toBe('available')
    expect(result.suggestion).toContain('dsh plugin')
    expect(result.suggestion).toContain(PLUGIN_PACKAGE_NAME)
  })

  it('includes a core diff when a workspace is linked', async () => {
    resetUpdateCheckInflight()
    const result = await checkForUpdates({
      cwd: '/tmp/project',
      fetchNpmLatest: async () => PLUGIN_VERSION,
      checkCore: async () => ({ current: '3.4.0', latest: '3.5.0', needsUpgrade: true }),
    })
    expect(result.status).toBe('available')
    expect(result.diffs.some(diff => diff.name === 'core' && diff.updateAvailable)).toBe(true)
  })

  it('returns failed when npm is unreachable and no update is known', async () => {
    resetUpdateCheckInflight()
    const result = await checkForUpdates({
      fetchNpmLatest: async () => {
        throw new Error('npm registry returned 503')
      },
    })
    expect(result.status).toBe('failed')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('503')
  })

  it('reuses an inflight check instead of starting a second one', async () => {
    resetUpdateCheckInflight()
    let started = 0
    const fetchNpmLatest = (): Promise<string> => {
      started += 1
      return new Promise(resolve => {
        setTimeout(() => resolve(PLUGIN_VERSION), 30)
      })
    }
    const [first, second] = await Promise.all([
      checkForUpdates({ fetchNpmLatest }),
      checkForUpdates({ fetchNpmLatest }),
    ])
    expect(started).toBe(1)
    expect(first).toBe(second)
    expect(first.status).toBe('current')
  })
})
