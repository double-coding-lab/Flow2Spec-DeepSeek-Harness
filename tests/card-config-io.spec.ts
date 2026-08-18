import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  applyChanges,
  diffConfigChanges,
  normalizeChanges,
  validateChanges,
} from '../src/card/config-fields.js'
import {
  CardConfigError,
  fingerprintOf,
  readWorkspaceConfig,
  saveWorkspaceConfig,
} from '../src/card/config-io.js'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'flow2spec-card-config-'))
}

describe('readWorkspaceConfig', () => {
  it('reports an uninitialized workspace when the file is missing', async () => {
    const root = await tempRoot()
    expect(readWorkspaceConfig(root)).toEqual({ initialized: false, fingerprint: '' })
  })

  it('returns parsed fields and a fingerprint for a valid file', async () => {
    const root = await tempRoot()
    const raw = '{\n  "subAgent": false\n}\n'
    await writeFile(join(root, 'flow2spec.config.json'), raw, 'utf8')
    const result = readWorkspaceConfig(root)
    expect(result.initialized).toBe(true)
    expect(result.config).toEqual({ subAgent: false })
    expect(result.fingerprint).toBe(fingerprintOf(raw))
  })

  it('rejects invalid JSON', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'flow2spec.config.json'), 'not-json', 'utf8')
    expect(() => readWorkspaceConfig(root)).toThrow(CardConfigError)
    try {
      readWorkspaceConfig(root)
    } catch (error) {
      expect(error).toMatchObject({ code: 'config-invalid' })
    }
  })
})

describe('saveWorkspaceConfig', () => {
  it('keeps unknown fields when saving known keys', async () => {
    const root = await tempRoot()
    const raw = `${JSON.stringify({ subAgent: true, custom: { keep: 1 }, extra: 'yes' }, null, 2)}\n`
    await writeFile(join(root, 'flow2spec.config.json'), raw, 'utf8')
    const before = readWorkspaceConfig(root)
    const saved = saveWorkspaceConfig({
      root,
      fingerprint: before.fingerprint,
      changes: [{ path: ['subAgent'], value: false }],
    })
    expect(saved.config).toEqual({ subAgent: false, custom: { keep: 1 }, extra: 'yes' })
    const disk = await readFile(join(root, 'flow2spec.config.json'), 'utf8')
    expect(JSON.parse(disk)).toEqual(saved.config)
    expect(saved.fingerprint).toBe(readWorkspaceConfig(root).fingerprint)
  })

  it('rejects a stale fingerprint without writing', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'flow2spec.config.json'), `${JSON.stringify({ subAgent: true }, null, 2)}\n`, 'utf8')
    const before = readWorkspaceConfig(root)
    await writeFile(join(root, 'flow2spec.config.json'), `${JSON.stringify({ subAgent: true, extra: 1 }, null, 2)}\n`, 'utf8')
    expect(() => saveWorkspaceConfig({
      root,
      fingerprint: before.fingerprint,
      changes: [{ path: ['subAgent'], value: false }],
    })).toThrow(CardConfigError)
    expect(JSON.parse(await readFile(join(root, 'flow2spec.config.json'), 'utf8'))).toEqual({
      subAgent: true,
      extra: 1,
    })
  })

  it('rejects unknown paths, wrong types, and illegal developer ids', () => {
    expect(validateChanges([{ path: ['nope'], value: true }])).toMatch(/Unknown/)
    expect(validateChanges([{ path: ['locale'], value: true }])).toMatch(/locale/)
    expect(validateChanges([{ path: ['collaboration', 'developerId'], value: 'Alice@corp.com' }]))
      .toMatch(/developerId/)
    expect(validateChanges([{ path: ['subAgent'], value: false }])).toBeUndefined()
  })

  it('trims developerId before validating', () => {
    const changes = normalizeChanges([{ path: ['collaboration', 'developerId'], value: '  alice  ' }])
    expect(changes).toEqual([{ path: ['collaboration', 'developerId'], value: 'alice' }])
    expect(validateChanges(changes)).toBeUndefined()
  })

  it('rejects saving an uninitialized workspace', async () => {
    const root = await tempRoot()
    await mkdir(root, { recursive: true })
    expect(() => saveWorkspaceConfig({
      root,
      fingerprint: '',
      changes: [{ path: ['subAgent'], value: false }],
    })).toThrow(CardConfigError)
  })
})

describe('diffConfigChanges', () => {
  it('emits only leaves that actually changed', () => {
    const loaded = { subAgent: true, changeTracking: { feat: true } }
    const draft = applyChanges(loaded, [{ path: ['changeTracking', 'fix'], value: true }])
    expect(diffConfigChanges(draft, loaded)).toEqual([
      { path: ['changeTracking', 'fix'], value: true },
    ])
  })
})
