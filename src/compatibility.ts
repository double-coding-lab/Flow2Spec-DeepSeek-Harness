import semver from 'semver'

import { Flow2SpecDshError } from './errors.js'
import {
  REQUIRED_CORE_PROTOCOL,
  VERIFIED_CORDIS_RANGE,
  VERIFIED_HOST_RANGE,
} from './version.js'

export const REQUIRED_CORE_CAPABILITIES = [
  'project.init',
  'project.inspect',
  'config.load',
  'routing.graph',
  'routing.state',
  'routing.match',
  'routing.expand',
  'routing.verify',
  'routing.load-context',
  'knowledge.status',
  'knowledge.check',
  'knowledge.plan',
  'knowledge.apply',
  'knowledge.build',
  'collaboration.resolve',
  'doctor.run',
  'resources.capabilities',
  'resources.skill-catalog',
  'resources.unified-entry',
  'update.check',
] as const

export interface CoreCapabilityManifest {
  protocolVersion: number
  capabilities: ReadonlyArray<{ id: string }>
}

export interface CompatibilityInput {
  core: CoreCapabilityManifest
  hostVersion?: string
  cordisVersion?: string
}

export interface CompatibilityReport {
  ok: boolean
  missingCapabilities: string[]
  protocolVersion: number
  hostSupported: boolean | undefined
  cordisSupported: boolean | undefined
}

function supports(version: string | undefined, range: string): boolean | undefined {
  if (version === undefined) return undefined
  const normalized = semver.valid(version)
  return normalized === null ? false : semver.satisfies(normalized, range, { includePrerelease: true })
}

export function inspectCompatibility(input: CompatibilityInput): CompatibilityReport {
  const available = new Set(input.core.capabilities.map(capability => capability.id))
  const missingCapabilities = REQUIRED_CORE_CAPABILITIES.filter(id => !available.has(id))
  const hostSupported = supports(input.hostVersion, VERIFIED_HOST_RANGE)
  const cordisSupported = supports(input.cordisVersion, VERIFIED_CORDIS_RANGE)
  return {
    ok: input.core.protocolVersion === REQUIRED_CORE_PROTOCOL
      && missingCapabilities.length === 0
      && hostSupported !== false
      && cordisSupported !== false,
    missingCapabilities,
    protocolVersion: input.core.protocolVersion,
    hostSupported,
    cordisSupported,
  }
}

export function assertCompatibility(input: CompatibilityInput): CompatibilityReport {
  const report = inspectCompatibility(input)
  if (report.hostSupported === false || report.cordisSupported === false) {
    throw new Flow2SpecDshError(
      'F2S_DSH_HOST_UNSUPPORTED',
      'DeepSeek Harness or Cordis is outside the verified compatibility range.',
      {
        hostVersion: input.hostVersion,
        hostRange: VERIFIED_HOST_RANGE,
        cordisVersion: input.cordisVersion,
        cordisRange: VERIFIED_CORDIS_RANGE,
      },
    )
  }
  if (input.core.protocolVersion !== REQUIRED_CORE_PROTOCOL || report.missingCapabilities.length > 0) {
    throw new Flow2SpecDshError(
      'F2S_DSH_CORE_CAPABILITY_MISSING',
      'Flow2Spec Core does not expose the native host contract required by this plugin.',
      {
        requiredProtocol: REQUIRED_CORE_PROTOCOL,
        actualProtocol: input.core.protocolVersion,
        missingCapabilities: report.missingCapabilities,
      },
    )
  }
  return report
}
