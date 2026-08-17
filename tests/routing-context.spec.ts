import { describe, expect, it } from 'vitest'

import {
  renderRoutingContext,
  resolveRoute,
  RoutingContextStore,
} from '../src/context/routing-context.js'
import type { ProjectCoreApi } from '../src/runtime/project-runtime.js'

function routeApi(verification = { ok: true, confidence: 'high', fallback: false }): ProjectCoreApi {
  return {
    project: {
      init: async () => ({}),
      inspect: () => ({ cwd: 'C:/repo', config: {} }),
    },
    config: { load: () => ({}) },
    collaboration: { resolveDeveloper: () => ({}) },
    doctor: { run: () => ({ ok: true }) },
    routing: {
      match: (input: Record<string, unknown>) => ({ ...input, manifestVersion: '3.4.0' }),
      expand: (result: Record<string, unknown>) => ({ ...result, topics: ['project-architecture'] }),
      verify: () => verification,
      loadContext: () => ({
        files: [{
          topic: 'project-architecture',
          path: '.Knowledge/topics/project-architecture.md',
          content: '# Architecture\nFacts.',
        }],
        lineCount: 2,
        truncated: false,
      }),
    },
  } as unknown as ProjectCoreApi
}

describe('routing context', () => {
  it('runs match, expand, verify and bounded context loading', () => {
    const snapshot = resolveRoute(routeApi(), 'change the API', {
      injectContext: true,
      maxFiles: 20,
      maxLines: 400,
    })
    expect(snapshot.context?.files).toHaveLength(1)
    expect(renderRoutingContext(snapshot)).toContain('topics: project-architecture')
    expect(renderRoutingContext(snapshot)).toContain('source: .Knowledge/topics/project-architecture.md')
  })

  it('does not load fallback context', () => {
    const snapshot = resolveRoute(routeApi({ ok: false, confidence: 'low', fallback: true }), 'unknown', {
      injectContext: true,
      maxFiles: 20,
      maxLines: 400,
    })
    expect(snapshot.context).toBeUndefined()
    expect(renderRoutingContext(snapshot)).toContain('fallback: true')
  })

  it('stores snapshots by agent identity', () => {
    const store = new RoutingContextStore<object>()
    const agent = {}
    const snapshot = resolveRoute(routeApi(), 'request', {
      injectContext: true,
      maxFiles: 20,
      maxLines: 400,
    })
    store.set(agent, snapshot)
    expect(store.render(agent)).toContain('<flow2spec_context>')
    store.clear(agent)
    expect(store.render(agent)).toBe('')
  })
})
