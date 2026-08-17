import { createHash } from 'node:crypto'

import type {
  Flow2SpecApi,
  KnowledgeDelta,
  KnowledgePlanResult,
} from '@double-coding/flow2spec-core'

import { Flow2SpecDshError } from './errors.js'

interface StoredPlan {
  readonly root: string
  readonly delta: KnowledgeDelta
  readonly result: KnowledgePlanResult
  readonly createdAt: number
}

export class KnowledgePlanStore {
  private readonly plans = new Map<string, StoredPlan>()

  create(root: string, api: Flow2SpecApi, delta: KnowledgeDelta): KnowledgePlanResult & { planHash: string } {
    const result = api.knowledge.plan({ delta })
    const planHash = hashDelta(delta)
    this.plans.set(planHash, { root, delta, result, createdAt: Date.now() })
    return { ...result, planHash }
  }

  apply(
    root: string,
    api: Flow2SpecApi,
    delta: KnowledgeDelta,
    planHash: string,
  ): ReturnType<Flow2SpecApi['knowledge']['apply']> {
    const stored = this.plans.get(planHash)
    if (
      stored === undefined
      || stored.root !== root
      || hashDelta(delta) !== planHash
      || Date.now() - stored.createdAt > 30 * 60 * 1000
    ) {
      throw new Flow2SpecDshError(
        'F2S_DSH_PLAN_STALE',
        'Knowledge plan is missing, expired, or does not match the submitted delta.',
        { planHash },
      )
    }
    const current = api.knowledge.plan({ delta })
    if (!current.mergeable) {
      throw new Flow2SpecDshError(
        'F2S_DSH_KB_CONFLICT',
        'Knowledge revisions changed after planning.',
        { conflicts: current.conflicts },
      )
    }
    const result = api.knowledge.apply({ delta, planHash })
    this.plans.delete(planHash)
    return result
  }

  clear(): void {
    this.plans.clear()
  }
}

export function hashDelta(delta: KnowledgeDelta): string {
  return createHash('sha256').update(stableStringify(delta)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
