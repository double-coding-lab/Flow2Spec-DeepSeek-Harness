import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  applyChanges,
  normalizeChanges,
  validateChanges,
} from './config-fields.js'
import type { ConfigChange, ConfigReadResult, ConfigSaveResult } from './types.js'

export const CONFIG_FILENAME = 'flow2spec.config.json'

export class CardConfigError extends Error {
  readonly code: 'config-invalid' | 'config-conflict'

  constructor(code: 'config-invalid' | 'config-conflict', message: string) {
    super(message)
    this.name = 'CardConfigError'
    this.code = code
  }
}

export function fingerprintOf(raw: string | undefined): string {
  if (raw === undefined) return ''
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

export function readWorkspaceConfig(root: string): ConfigReadResult {
  const filePath = join(root, CONFIG_FILENAME)
  if (!existsSync(filePath)) {
    return { initialized: false, fingerprint: '' }
  }
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new CardConfigError(
      'config-invalid',
      error instanceof Error ? error.message : String(error),
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new CardConfigError('config-invalid', `${CONFIG_FILENAME} is not valid JSON.`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CardConfigError('config-invalid', `${CONFIG_FILENAME} must be a JSON object.`)
  }
  return {
    initialized: true,
    config: parsed as Record<string, unknown>,
    fingerprint: fingerprintOf(raw),
  }
}

export function saveWorkspaceConfig(input: {
  root: string
  fingerprint: string
  changes: readonly ConfigChange[]
}): ConfigSaveResult {
  const changes = normalizeChanges(input.changes)
  const invalid = validateChanges(changes)
  if (invalid !== undefined) throw new CardConfigError('config-invalid', invalid)

  const current = readWorkspaceConfig(input.root)
  if (current.fingerprint !== input.fingerprint) {
    throw new CardConfigError(
      'config-conflict',
      `${CONFIG_FILENAME} changed on disk. Reload and try again.`,
    )
  }
  if (!current.initialized || current.config === undefined) {
    throw new CardConfigError('config-invalid', 'Workspace is not initialized.')
  }

  const next = applyChanges(current.config, changes)
  const serialized = `${JSON.stringify(next, null, 2)}\n`
  writeFileSync(join(input.root, CONFIG_FILENAME), serialized, 'utf8')
  return {
    fingerprint: fingerprintOf(serialized),
    config: next,
  }
}
