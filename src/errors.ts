export type Flow2SpecDshErrorCode =
  | 'F2S_DSH_HOST_UNSUPPORTED'
  | 'F2S_DSH_CORE_CAPABILITY_MISSING'
  | 'F2S_DSH_INIT_FAILED'
  | 'F2S_DSH_SKILL_DISCOVERY_FAILED'
  | 'F2S_DSH_SKILL_LOAD_FAILED'
  | 'F2S_DSH_ROUTING_INVALID'
  | 'F2S_DSH_PLAN_STALE'
  | 'F2S_DSH_KB_CONFLICT'
  | 'F2S_DSH_ABORTED'

export class Flow2SpecDshError extends Error {
  readonly code: Flow2SpecDshErrorCode
  readonly details: Readonly<Record<string, unknown>>
  readonly causeCode?: string

  constructor(
    code: Flow2SpecDshErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'Flow2SpecDshError'
    this.code = code
    this.details = details
    const candidate = cause as { code?: unknown } | undefined
    if (typeof candidate?.code === 'string') this.causeCode = candidate.code
  }
}
