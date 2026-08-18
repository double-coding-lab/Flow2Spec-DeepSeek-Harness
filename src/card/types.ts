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

export interface CardRpcPayload {
  cwd?: string
}
