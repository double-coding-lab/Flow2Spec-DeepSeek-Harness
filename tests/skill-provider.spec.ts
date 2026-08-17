import { describe, expect, it } from 'vitest'

import { Flow2SpecSkillProvider } from '../src/providers/flow2spec-skill-provider.js'

describe('Flow2SpecSkillProvider', () => {
  it('lists and loads structured Core skills', async () => {
    const provider = new Flow2SpecSkillProvider({
      async list() {
        return [{
          name: 'f2s-example',
          description: 'Example skill',
          content: '# Example',
          relativePath: 'skills/f2s-example/SKILL.md',
          resourceRoot: 'C:/flow2spec/resources',
        }]
      },
    })
    const candidates = await provider.list({ cwd: 'C:/repo' })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      name: 'f2s-example',
      provider: 'flow2spec',
      rank: 250,
    })
    const loaded = await provider.get(candidates[0]!, {})
    expect(loaded).toMatchObject({ content: '# Example' })
    expect(loaded?.resourceBase).toEqual({
      kind: 'directory',
      path: 'C:/flow2spec/resources',
    })
  })

  it('ignores candidates not owned by the provider', async () => {
    const provider = new Flow2SpecSkillProvider({ async list() { return [] } })
    const loaded = await provider.get({
      name: 'other',
      description: 'Other',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'runtime',
      provider: 'other',
      rank: 1,
      locator: null,
    }, {})
    expect(loaded).toBeUndefined()
  })
})
