import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { inspectCardStatus } from '../src/card/status.js'
import { REQUIRED_CORE_CAPABILITIES } from '../src/compatibility.js'
import { PLUGIN_VERSION } from '../src/version.js'

function completeCore() {
  return {
    protocolVersion: 2,
    capabilities: REQUIRED_CORE_CAPABILITIES.map(id => ({ id })),
  }
}

describe('inspectCardStatus', () => {
  it('reports an unlinked workspace when cwd is missing', () => {
    const status = inspectCardStatus({
      core: completeCore(),
      pluginVersion: PLUGIN_VERSION,
      coreVersion: '3.4.0',
    })
    expect(status.projectBaseline).toBe('unlinked')
    expect(status.workspaceRoot).toBeUndefined()
    expect(status.pluginVersion).toBe(PLUGIN_VERSION)
  })

  it('does not treat a git repo without Flow2Spec files as ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flow2spec-card-missing-'))
    await mkdir(join(root, '.git'))
    const status = inspectCardStatus({
      cwd: root,
      core: completeCore(),
      coreVersion: '3.4.0',
    })
    expect(status.projectBaseline).toBe('missing')
    expect(status.workspaceRoot).toBe(root)
  })

  it('detects an existing project baseline without initializing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flow2spec-card-ready-'))
    await mkdir(join(root, '.git'))
    await mkdir(join(root, '.Knowledge'))
    await writeFile(join(root, 'flow2spec.config.json'), '{}', 'utf8')
    const status = inspectCardStatus({
      cwd: root,
      core: completeCore(),
      coreVersion: '3.4.0',
    })
    expect(status.projectBaseline).toBe('ready')
    expect(status.workspaceRoot).toBe(root)
  })
})
