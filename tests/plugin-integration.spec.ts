import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

import * as flow2specPlugin from '../src/index.js'

describe('Cordis integration', () => {
  it('loads, initializes a project, exposes skills, and disposes cleanly', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'flow2spec-dsh-plugin-'))
    const legacySkill = join(cwd, '.dsh', 'skills', 'f2s-kb-sync', 'SKILL.md')
    await mkdir(join(cwd, '.dsh', 'skills', 'f2s-kb-sync'), { recursive: true })
    await writeFile(legacySkill, '# legacy\n', 'utf8')
    const ctx = new Context()
    const fibers = [
      ctx.plugin(SystemPrompt, {}),
      ctx.plugin(SkillRegistry, {}),
      ctx.plugin(CommandRuntime, undefined),
      ctx.plugin(ToolRuntime, undefined),
    ]
    await Promise.all(fibers)
    const plugin = ctx.plugin(flow2specPlugin, { autoInitialize: true })
    await plugin

    const skills = await ctx.skills.list({ cwd })
    expect(skills.length).toBeGreaterThan(10)
    expect(skills.some(skill => skill.name === 'f2s-req-plan')).toBe(true)
    const loaded = await ctx.skills.get('f2s-req-plan', { cwd })
    expect(loaded?.content).toContain('flow2spec.config.json')
    const agent = { session: { header: { cwd } } } as Agent
    expect(ctx.commands.list(agent).some(command => command.name === 'flow2spec')).toBe(true)
    for (const tool of [
      'flow2spec_route',
      'flow2spec_doctor',
      'flow2spec_kb_status',
      'flow2spec_kb_check',
      'flow2spec_kb_plan',
      'flow2spec_kb_apply',
      'flow2spec_kb_build',
      'flow2spec_project_init',
    ]) {
      expect(ctx.tools.get(tool)).toBeDefined()
    }

    const messages = [{
      id: 'msg-plugin-integration' as UserMessage['id'],
      role: 'user',
      content: [{ type: 'text', text: 'plan a Flow2Spec task' }],
      source: { kind: 'user' },
    }] as UserMessage[]
    const signal = new AbortController().signal
    const command = ctx.commands.find(agent, 'flow2spec')
    const doctor = await command?.handler({ agent, rawInput: ' doctor', signal } as never)
    expect(doctor?.kind).toBe('success')
    expect(doctor?.text).toContain('.dsh/skills/f2s-kb-sync')
    await ctx.waterfall('agent/pre-step', {
      agent,
      messages,
      turn: 1,
      step: 1,
      signal,
    }, async () => ({ kind: 'enter', messages }))
    const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent as never, signal })
    const promptContext = assembly.contexts.find(context => context.name === 'flow2spec')?.text
    expect(promptContext).toContain('flow2spec.config.json')
    expect(promptContext).not.toContain('{{')

    await plugin.dispose()
    expect(await ctx.skills.list({ cwd })).toEqual([])
    expect(existsSync(legacySkill)).toBe(true)
    await Promise.all(fibers.reverse().map(fiber => fiber.dispose()))
  })
})
