import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/config.js'

describe('resolveConfig', () => {
  it('applies the complete plugin defaults', () => {
    expect(resolveConfig()).toEqual({
      locale: 'auto',
      autoInitialize: true,
      strictCompatibility: true,
      skills: { enabled: true, providerName: 'flow2spec', rank: 250 },
      routing: { enabled: true, injectContext: true, maxFiles: 20, maxLines: 400 },
      hooks: { sessionSummary: true, updateCheck: true, configPrecheck: true },
      commands: { enabled: true },
      tools: { readOnly: true, knowledgeWrite: true },
    })
  })

  it('preserves explicit overrides', () => {
    expect(resolveConfig({
      locale: 'en-US',
      autoInitialize: false,
      skills: { rank: 125 },
      routing: { maxFiles: 5 },
    })).toMatchObject({
      locale: 'en-US',
      autoInitialize: false,
      skills: { rank: 125 },
      routing: { maxFiles: 5 },
    })
  })

  it('rejects unknown root and nested fields', () => {
    expect(() => resolveConfig({ unknown: true } as never)).toThrow('Unknown')
    expect(() => resolveConfig({ routing: { maxFile: 5 } } as never)).toThrow('routing.maxFile')
  })
})
