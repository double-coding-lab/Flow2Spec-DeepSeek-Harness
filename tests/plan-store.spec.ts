import type { Flow2SpecApi, KnowledgeDelta } from '@double-coding/flow2spec-core'
import { describe, expect, it, vi } from 'vitest'

import { Flow2SpecDshError } from '../src/errors.js'
import { hashDelta, KnowledgePlanStore } from '../src/plan-store.js'

const delta: KnowledgeDelta = {
  taskId: 'task-1',
  developerId: 'alice',
  baseRevisions: { architecture: 1 },
  changes: [{ type: 'appendBody', targetTopic: 'architecture', content: 'Fact.' }],
}

function api(mergeable = true): Flow2SpecApi {
  return {
    knowledge: {
      plan: vi.fn(() => ({ delta, plan: [], conflicts: mergeable ? [] : ['revision'], mergeable })),
      apply: vi.fn(() => ({ dryRun: false, changedFiles: ['architecture.md'], plan: [] })),
    },
  } as unknown as Flow2SpecApi
}

describe('KnowledgePlanStore', () => {
  it('uses a stable hash and applies only the exact planned delta', () => {
    const store = new KnowledgePlanStore()
    const core = api()
    const plan = store.create('C:/repo', core, delta)
    expect(plan.planHash).toBe(hashDelta({ ...delta, baseRevisions: { architecture: 1 } }))
    expect(store.apply('C:/repo', core, delta, plan.planHash).changedFiles).toEqual(['architecture.md'])
  })

  it('rejects an unplanned or changed delta', () => {
    const store = new KnowledgePlanStore()
    const core = api()
    const plan = store.create('C:/repo', core, delta)
    const changed = { ...delta, notes: 'changed' }
    expect(() => store.apply('C:/repo', core, changed, plan.planHash))
      .toThrowError(expect.objectContaining<Partial<Flow2SpecDshError>>({ code: 'F2S_DSH_PLAN_STALE' }))
  })

  it('rejects a revision conflict discovered before apply', () => {
    const store = new KnowledgePlanStore()
    const first = api()
    const plan = store.create('C:/repo', first, delta)
    expect(() => store.apply('C:/repo', api(false), delta, plan.planHash))
      .toThrowError(expect.objectContaining<Partial<Flow2SpecDshError>>({ code: 'F2S_DSH_KB_CONFLICT' }))
  })
})
