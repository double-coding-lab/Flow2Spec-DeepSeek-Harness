import { describe, expect, it } from 'vitest'

import {
  neutralizePromptVariables,
  renderRoutingContext,
  resolveRoute,
  RoutingContextStore,
} from '../src/context/routing-context.js'
import type { ProjectCoreApi } from '../src/runtime/project-runtime.js'

function routeApi(
  verification = { ok: true, confidence: 'high', fallback: false },
  content = '# Architecture\nFacts.',
): ProjectCoreApi {
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
          content,
        }],
        lineCount: content.split('\n').length,
        truncated: false,
      }),
    },
  } as unknown as ProjectCoreApi
}

const ROUTE_OPTIONS = { injectContext: true, maxFiles: 20, maxLines: 400 }

describe('routing context', () => {
  it('runs match, expand, verify and bounded context loading', () => {
    const snapshot = resolveRoute(routeApi(), 'change the API', ROUTE_OPTIONS)
    expect(snapshot.context?.files).toHaveLength(1)
    expect(renderRoutingContext(snapshot)).toContain('topics: project-architecture')
    expect(renderRoutingContext(snapshot)).toContain('source: .Knowledge/topics/project-architecture.md')
  })

  it('does not load fallback context', () => {
    const snapshot = resolveRoute(
      routeApi({ ok: false, confidence: 'low', fallback: true }),
      'unknown',
      ROUTE_OPTIONS,
    )
    expect(snapshot.context).toBeUndefined()
    expect(renderRoutingContext(snapshot)).toContain('fallback: true')
  })

  it('stores snapshots by agent identity', () => {
    const store = new RoutingContextStore<object>()
    const agent = {}
    const snapshot = resolveRoute(routeApi(), 'request', ROUTE_OPTIONS)
    store.set(agent, snapshot)
    expect(store.render(agent)).toContain('<flow2spec_context>')
    store.clear(agent)
    expect(store.render(agent)).toBe('')
  })
})

describe('prompt variable neutralization', () => {
  it('unwraps simple placeholders', () => {
    expect(neutralizePromptVariables('see `{{FLOW2SPEC_PROJECT_CONFIG}}` table'))
      .toBe('see `FLOW2SPEC_PROJECT_CONFIG` table')
    expect(neutralizePromptVariables('{{ name }}')).toBe('name')
  })

  it('breaks up brace runs that could start a reference', () => {
    expect(neutralizePromptVariables('{{{x}}}')).toBe('{x}')
    expect(neutralizePromptVariables('{ {{a}}')).toBe('{ a')
    expect(neutralizePromptVariables('text with {{ unterminated')).not.toContain('{{')
  })

  it('keeps code samples that only contain closing braces', () => {
    expect(neutralizePromptVariables('try{const a={b:1}}catch{}'))
      .toBe('try{const a={b:1}}catch{}')
  })

  it('renders topic bodies without any prompt variable marker', () => {
    const snapshot = resolveRoute(
      routeApi(undefined, '# Precheck\nUse `{{FLOW2SPEC_PROJECT_CONFIG}}` with care.\n```js\nif (x) { y() }}\n```'),
      'config precheck',
      ROUTE_OPTIONS,
    )
    const rendered = renderRoutingContext(snapshot)
    expect(rendered).not.toContain('{{')
    expect(rendered).toContain('`FLOW2SPEC_PROJECT_CONFIG`')
    expect(rendered).toContain('if (x) { y() }}')
  })
})
