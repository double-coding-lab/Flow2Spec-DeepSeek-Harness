import type { Flow2SpecProjectConfig } from '@double-coding/flow2spec-core'

import type { ConfigChange } from './types.js'

export type FormFieldKind = 'boolean' | 'locale' | 'developerId'
export type FormGroupId = 'locale' | 'orchestration' | 'tracking' | 'update' | 'collaboration'

export interface FormField {
  path: readonly string[]
  kind: FormFieldKind
  group: FormGroupId
  labelKey: string
  hintKey?: string
}

export const DEVELOPER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export const FORM_FIELDS: readonly FormField[] = [
  { path: ['locale'], kind: 'locale', group: 'locale', labelKey: 'field.locale', hintKey: 'field.localeHint' },
  { path: ['subAgent'], kind: 'boolean', group: 'orchestration', labelKey: 'field.subAgent' },
  { path: ['switchAgentVerification'], kind: 'boolean', group: 'orchestration', labelKey: 'field.switchAgentVerification' },
  { path: ['intentRecognition'], kind: 'boolean', group: 'orchestration', labelKey: 'field.intentRecognition' },
  { path: ['changeTracking', 'feat'], kind: 'boolean', group: 'tracking', labelKey: 'field.changeTrackingFeat' },
  { path: ['changeTracking', 'fix'], kind: 'boolean', group: 'tracking', labelKey: 'field.changeTrackingFix' },
  { path: ['changeTracking', 'implement'], kind: 'boolean', group: 'tracking', labelKey: 'field.changeTrackingImplement' },
  { path: ['updateCheck', 'enabled'], kind: 'boolean', group: 'update', labelKey: 'field.updateCheck' },
  { path: ['collaboration', 'enabled'], kind: 'boolean', group: 'collaboration', labelKey: 'field.collaborationEnabled' },
  {
    path: ['collaboration', 'developerId'],
    kind: 'developerId',
    group: 'collaboration',
    labelKey: 'field.developerId',
    hintKey: 'field.developerIdHint',
  },
]

export const FORM_GROUP_ORDER: readonly FormGroupId[] = [
  'locale',
  'orchestration',
  'tracking',
  'update',
  'collaboration',
]

export const FORM_DEFAULTS: Flow2SpecProjectConfig = {
  locale: 'zh-CN',
  subAgent: true,
  switchAgentVerification: true,
  intentRecognition: true,
  changeTracking: { feat: true, fix: false, implement: true },
  updateCheck: { enabled: true },
  collaboration: { enabled: true, developerId: '' },
}

const knownPaths = new Set(FORM_FIELDS.map(field => pathKey(field.path)))
const fieldByPath = new Map(FORM_FIELDS.map(field => [pathKey(field.path), field]))

export function pathKey(path: readonly string[]): string {
  return path.join('.')
}

export function getAt(source: unknown, path: readonly string[]): unknown {
  let current: unknown = source
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export function setAt(
  source: Record<string, unknown>,
  path: readonly string[],
  value: string | boolean,
): Record<string, unknown> {
  const root = cloneRecord(source)
  applyLeaf(root, path, { kind: 'set', value })
  return root
}

export function displayValue(source: unknown, field: FormField): string | boolean {
  const value = getAt(source, field.path)
  if (field.kind === 'boolean') return typeof value === 'boolean' ? value : Boolean(getAt(FORM_DEFAULTS, field.path))
  if (field.kind === 'locale') return value === 'en-US' || value === 'zh-CN' ? value : 'zh-CN'
  return typeof value === 'string' ? value : ''
}

export function diffConfigChanges(
  draft: Record<string, unknown>,
  loaded: Record<string, unknown>,
): ConfigChange[] {
  const changes: ConfigChange[] = []
  for (const field of FORM_FIELDS) {
    const next = getAt(draft, field.path)
    const prev = getAt(loaded, field.path)
    if (Object.is(next, prev)) continue
    if (next === undefined) {
      changes.push({ path: field.path, remove: true })
      continue
    }
    if (typeof next === 'string' || typeof next === 'boolean') {
      changes.push({ path: field.path, value: next })
    }
  }
  return changes
}

export function normalizeChanges(changes: readonly ConfigChange[]): ConfigChange[] {
  return changes.map(change => {
    if (!('value' in change)) return change
    if (pathKey(change.path) !== 'collaboration.developerId') return change
    if (typeof change.value !== 'string') return change
    return { path: change.path, value: change.value.trim() }
  })
}

export function validateChanges(changes: readonly ConfigChange[]): string | undefined {
  if (changes.length === 0) return 'No configuration changes to save.'
  for (const change of changes) {
    const key = pathKey(change.path)
    const field = fieldByPath.get(key)
    if (field === undefined || !knownPaths.has(key)) {
      return `Unknown configuration path: ${key}`
    }
    if ('remove' in change && change.remove) continue
    if (!('value' in change)) return `Invalid change for ${key}.`
    const message = validateFieldValue(field, change.value)
    if (message !== undefined) return message
  }
  return undefined
}

export function applyChanges(
  source: Record<string, unknown>,
  changes: readonly ConfigChange[],
): Record<string, unknown> {
  const root = cloneRecord(source)
  for (const change of changes) {
    if ('remove' in change && change.remove) {
      applyLeaf(root, change.path, { kind: 'remove' })
      continue
    }
    if ('value' in change) applyLeaf(root, change.path, { kind: 'set', value: change.value })
  }
  return root
}

export function isConfigChange(value: unknown): value is ConfigChange {
  if (value === null || typeof value !== 'object') return false
  const path = (value as { path?: unknown }).path
  if (!Array.isArray(path) || path.length === 0 || path.some(part => typeof part !== 'string')) return false
  if ('remove' in value && (value as { remove: unknown }).remove === true) return true
  const next = (value as { value?: unknown }).value
  return typeof next === 'string' || typeof next === 'boolean'
}

function validateFieldValue(field: FormField, value: string | boolean): string | undefined {
  if (field.kind === 'boolean') {
    return typeof value === 'boolean' ? undefined : `${pathKey(field.path)} must be a boolean.`
  }
  if (field.kind === 'locale') {
    return value === 'zh-CN' || value === 'en-US' ? undefined : 'locale must be zh-CN or en-US.'
  }
  if (typeof value !== 'string') return 'collaboration.developerId must be a string.'
  if (value === '') return undefined
  if (!DEVELOPER_ID_PATTERN.test(value)) {
    return 'collaboration.developerId must be 1–64 characters of [a-z0-9-], without leading or trailing hyphens. Empty means infer from git.'
  }
  return undefined
}

function applyLeaf(
  root: Record<string, unknown>,
  path: readonly string[],
  action: { kind: 'set'; value: string | boolean } | { kind: 'remove' },
): void {
  let cursor = root
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index]
    if (key === undefined) return
    const nested = cursor[key]
    if (nested === undefined || nested === null || typeof nested !== 'object' || Array.isArray(nested)) {
      const created: Record<string, unknown> = {}
      cursor[key] = created
      cursor = created
    } else {
      cursor = nested as Record<string, unknown>
    }
  }
  const leaf = path[path.length - 1]
  if (leaf === undefined) return
  if (action.kind === 'remove') {
    delete cursor[leaf]
    return
  }
  cursor[leaf] = action.value
}

function cloneRecord(source: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(source)
}
