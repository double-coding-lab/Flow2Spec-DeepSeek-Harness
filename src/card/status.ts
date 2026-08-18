import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import { createFlow2Spec } from '@double-coding/flow2spec-core'

import { inspectCompatibility, type CoreCapabilityManifest } from '../compatibility.js'
import { PLUGIN_VERSION } from '../version.js'
import type { CardStatus, ProjectBaseline } from './types.js'

const require = createRequire(import.meta.url)

export interface CardStatusInput {
  cwd?: string
  hostVersion?: string
  cordisVersion?: string
  pluginVersion?: string
  coreVersion?: string
  core?: CoreCapabilityManifest
  exists?: (path: string) => boolean
}

export function inspectCardStatus(input: CardStatusInput = {}): CardStatus {
  const exists = input.exists ?? existsSync
  const pluginVersion = input.pluginVersion ?? PLUGIN_VERSION
  const coreVersion = input.coreVersion ?? readInstalledPackageVersion('@double-coding/flow2spec-core')
  const compatibility = inspectCompatibility({
    core: input.core ?? loadCoreCapabilities(input.cwd),
    ...(input.hostVersion === undefined ? {} : { hostVersion: input.hostVersion }),
    ...(input.cordisVersion === undefined ? {} : { cordisVersion: input.cordisVersion }),
  })

  if (input.cwd === undefined || input.cwd.trim() === '') {
    return {
      pluginVersion,
      coreVersion,
      compatibility: toCardCompatibility(compatibility),
      projectBaseline: 'unlinked',
    }
  }

  const workspaceRoot = resolveWorkspaceRoot(input.cwd, exists)
  const projectBaseline: ProjectBaseline = hasProjectBaseline(workspaceRoot, exists) ? 'ready' : 'missing'
  return {
    pluginVersion,
    coreVersion,
    compatibility: toCardCompatibility(compatibility),
    projectBaseline,
    workspaceRoot,
  }
}

export function readInstalledPackageVersion(specifier: string): string {
  try {
    const pkg = require(`${specifier}/package.json`) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

export function resolveWorkspaceRoot(cwd: string, exists: (path: string) => boolean = existsSync): string {
  let current = resolve(cwd)
  while (true) {
    if (exists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

export function hasProjectBaseline(root: string, exists: (path: string) => boolean = existsSync): boolean {
  return exists(join(root, 'flow2spec.config.json')) && exists(join(root, '.Knowledge'))
}

function loadCoreCapabilities(cwd: string | undefined): CoreCapabilityManifest {
  try {
    const api = createFlow2Spec(cwd === undefined ? {} : { cwd })
    return api.resources.capabilities()
  } catch {
    return { protocolVersion: 0, capabilities: [] }
  }
}

function toCardCompatibility(report: ReturnType<typeof inspectCompatibility>) {
  return {
    ok: report.ok,
    hostSupported: report.hostSupported,
    cordisSupported: report.cordisSupported,
  }
}
