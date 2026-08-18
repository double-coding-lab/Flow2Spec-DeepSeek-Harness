export type ProjectBaseline = 'ready' | 'missing' | 'unlinked'

export interface CardCompatibility {
  ok: boolean
  hostSupported: boolean | undefined
  cordisSupported: boolean | undefined
}

export interface CardStatus {
  pluginVersion: string
  coreVersion: string
  compatibility: CardCompatibility
  projectBaseline: ProjectBaseline
  workspaceRoot?: string
}

export type CheckUpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'failed'

export interface VersionDiff {
  name: 'plugin' | 'core'
  current: string
  latest?: string
  updateAvailable: boolean
}

export interface CheckUpdateResult {
  ok: boolean
  status: Exclude<CheckUpdateStatus, 'idle' | 'checking'>
  diffs: VersionDiff[]
  suggestion?: string
  error?: string
}

export type ConfigChange =
  | { path: readonly string[]; value: string | boolean }
  | { path: readonly string[]; remove: true }

export interface ConfigReadResult {
  initialized: boolean
  config?: Record<string, unknown>
  fingerprint: string
}

export interface ConfigSaveResult {
  fingerprint: string
  config: Record<string, unknown>
}

export interface ProjectInitCardResult extends ConfigReadResult {
  ids: string[]
}

export interface CardRpcPayload {
  cwd?: string
  fingerprint?: string
  changes?: ConfigChange[]
}
