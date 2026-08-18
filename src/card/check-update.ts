import { createFlow2Spec } from '@double-coding/flow2spec-core'
import semver from 'semver'

import { PLUGIN_PACKAGE_NAME, PLUGIN_VERSION } from '../version.js'
import { readInstalledPackageVersion } from './status.js'
import type { CheckUpdateResult, VersionDiff } from './types.js'

const NPM_TIMEOUT_MS = 10_000
const UPGRADE_SUGGESTION = `dsh plugin --profile <profile> add ${PLUGIN_PACKAGE_NAME}`

export interface CheckUpdatesInput {
  cwd?: string
  signal?: AbortSignal
  fetchNpmLatest?: (name: string, signal?: AbortSignal) => Promise<string>
  checkCore?: (cwd: string, signal?: AbortSignal) => Promise<CoreUpdateSnapshot>
}

export interface CoreUpdateSnapshot {
  current: string
  latest: string | null
  needsUpgrade: boolean
}

let inflight: Promise<CheckUpdateResult> | undefined

export async function checkForUpdates(input: CheckUpdatesInput = {}): Promise<CheckUpdateResult> {
  if (inflight !== undefined) return inflight
  inflight = runCheck(input).finally(() => {
    inflight = undefined
  })
  return inflight
}

export function resetUpdateCheckInflight(): void {
  inflight = undefined
}

async function runCheck(input: CheckUpdatesInput): Promise<CheckUpdateResult> {
  const diffs: VersionDiff[] = []
  const fetchNpmLatest = input.fetchNpmLatest ?? fetchNpmLatestVersion
  const errors: string[] = []

  try {
    const latest = await fetchNpmLatest(PLUGIN_PACKAGE_NAME, input.signal)
    diffs.push(diffOf('plugin', PLUGIN_VERSION, latest))
  } catch (error) {
    diffs.push({ name: 'plugin', current: PLUGIN_VERSION, updateAvailable: false })
    errors.push(errorMessage(error))
  }

  if (input.cwd !== undefined && input.cwd.trim() !== '') {
    const checkCore = input.checkCore ?? checkCoreUpdate
    try {
      const core = await checkCore(input.cwd, input.signal)
      diffs.push({
        name: 'core',
        current: core.current,
        updateAvailable: core.needsUpgrade,
        ...(core.latest === null ? {} : { latest: core.latest }),
      })
    } catch (error) {
      errors.push(errorMessage(error))
    }
  }

  if (errors.length > 0 && !diffs.some(diff => diff.updateAvailable)) {
    return {
      ok: false,
      status: 'failed',
      diffs,
      error: errors[0] ?? 'update check failed',
    }
  }

  const updateAvailable = diffs.some(diff => diff.updateAvailable)
  if (updateAvailable) {
    return {
      ok: true,
      status: 'available',
      diffs,
      suggestion: UPGRADE_SUGGESTION,
      ...(errors[0] === undefined ? {} : { error: errors[0] }),
    }
  }

  return {
    ok: true,
    status: 'current',
    diffs,
  }
}

function diffOf(
  name: VersionDiff['name'],
  current: string,
  latest?: string,
  updateAvailable?: boolean,
): VersionDiff {
  const available = updateAvailable ?? (latest !== undefined && isNewer(latest, current))
  return latest === undefined
    ? { name, current, updateAvailable: available }
    : { name, current, latest, updateAvailable: available }
}

function isNewer(latest: string, current: string): boolean {
  const latestValid = semver.valid(latest)
  const currentValid = semver.valid(current)
  if (latestValid === null || currentValid === null) return latest !== current
  return semver.gt(latestValid, currentValid)
}

export async function fetchNpmLatestVersion(name: string, signal?: AbortSignal): Promise<string> {
  const encoded = name.replaceAll('/', '%2f')
  const timeout = AbortSignal.timeout(NPM_TIMEOUT_MS)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  const response = await fetch(`https://registry.npmjs.org/${encoded}/latest`, {
    signal: combined,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status}`)
  }
  const body = await response.json() as { version?: unknown }
  if (typeof body.version !== 'string' || body.version.length === 0) {
    throw new Error('npm registry response is missing version')
  }
  return body.version
}

async function checkCoreUpdate(cwd: string, signal?: AbortSignal): Promise<CoreUpdateSnapshot> {
  const api = createFlow2Spec({ cwd, ...(signal === undefined ? {} : { signal }) })
  const result = await api.update.check({ force: true, ...(signal === undefined ? {} : { signal }) })
  return {
    current: result.manifestVersion ?? readInstalledPackageVersion('@double-coding/flow2spec-core'),
    latest: result.latestVersion,
    needsUpgrade: result.needsUpgrade,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
