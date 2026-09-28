import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type PreToolDecision, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'

import * as flow2specPlugin from '../src/index.js'

interface Harness {
  ctx: Context
  cwd: string
  agent: Agent
  dispose: () => Promise<void>
}

const logs: string[] = []
const harnesses: Harness[] = []

async function boot(): Promise<Harness> {
  const cwd = await mkdtemp(join(tmpdir(), 'flow2spec-dsh-hooks-'))
  const ctx = new Context()
  ctx.logger.exporter({
    export(message) {
      logs.push([message.name, message.type, ...message.args.map(String)].join(' '))
    },
  })
  const fibers = [
    ctx.plugin(SystemPrompt, {}),
    ctx.plugin(SkillRegistry, {}),
    ctx.plugin(CommandRuntime, undefined),
    ctx.plugin(ToolRuntime, undefined),
  ]
  await Promise.all(fibers)
  const plugin = ctx.plugin(flow2specPlugin, {
    autoInitialize: true,
    hooks: { sessionSummary: true, updateCheck: false, configPrecheck: true },
  })
  await plugin
  const session = { header: { cwd } } as Session
  const agent = { session } as Agent
  const harness: Harness = {
    ctx,
    cwd,
    agent,
    dispose: async () => {
      await plugin.dispose()
      await Promise.all(fibers.reverse().map(fiber => fiber.dispose()))
    },
  }
  harnesses.push(harness)
  return harness
}

function userMessage(text: string): UserMessage[] {
  return [{
    id: `msg-${text}` as UserMessage['id'],
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }] as UserMessage[]
}

function toolExec(agent: Agent, name: string, args: Record<string, unknown>): ToolExecution {
  const callId = `call-${name}` as ToolExecution['callId']
  return {
    callId,
    rootCallId: callId,
    name,
    arguments: args,
    agent,
    signal: new AbortController().signal,
    token: Symbol(name) as ToolExecution['token'],
  }
}

afterEach(async () => {
  logs.length = 0
  while (harnesses.length > 0) {
    const harness = harnesses.pop()
    if (harness !== undefined) await harness.dispose()
  }
})

describe('native Cordis hooks', () => {
  it('does not create a project hooks directory', async () => {
    const { cwd, ctx, agent } = await boot()
    ctx.emit('agent/created', { agent, source: 'startup' })
    await expect.poll(() => existsSync(join(cwd, 'flow2spec.config.json'))).toBe(true)
    expect(existsSync(join(cwd, '.dsh', 'hooks'))).toBe(false)
    expect(existsSync(join(cwd, '.dsh', 'hooks.json'))).toBe(false)
    expect(existsSync(join(cwd, '.claude', 'hooks'))).toBe(false)
  })

  it('agent/created initializes the project and logs a ready summary', async () => {
    const { cwd, ctx, agent } = await boot()
    ctx.emit('agent/created', { agent, source: 'startup' })
    await expect.poll(() => existsSync(join(cwd, 'flow2spec.config.json'))).toBe(true)
    await expect.poll(() => existsSync(join(cwd, '.Knowledge'))).toBe(true)
    await expect.poll(() => logs.some(line => line.includes('Flow2Spec ready'))).toBe(true)
    expect(logs.find(line => line.includes('Flow2Spec ready'))).toContain(cwd)
  })

  it('pre-step injects routing context, then turn/end clears the request snapshot', async () => {
    const { ctx, agent } = await boot()
    ctx.emit('agent/created', { agent, source: 'startup' })
    const signal = new AbortController().signal
    await ctx.waterfall('agent/pre-step', {
      agent,
      messages: userMessage('plan a Flow2Spec task'),
      turn: 1,
      step: 1,
      signal,
    }, async () => ({ kind: 'enter' as const, messages: userMessage('plan a Flow2Spec task') }))
    const before = await ctx.systemPrompt.assemble({ agent, scope: agent as never, signal })
    const routed = before.contexts.find(context => context.name === 'flow2spec')?.text ?? ''
    expect(routed).toContain('<flow2spec_context>')
    ctx.emit('session/event', agent.session, {
      type: 'turn/end',
      seq: SessionSeq(1),
      time: Date.now(),
      data: { turn: 1, reason: { kind: 'completed' } },
    })
    const after = await ctx.systemPrompt.assemble({ agent, scope: agent as never, signal })
    const remaining = after.contexts.find(context => context.name === 'flow2spec')?.text ?? ''
    expect(remaining).not.toContain('<flow2spec_context>')
  })

  it('pre-execute denies kb_apply without planHash and allows other tools', async () => {
    const { ctx, agent } = await boot()
    const denied = await ctx.waterfall(
      'tools/pre-execute',
      toolExec(agent, 'flow2spec_kb_apply', { delta: {} }),
      async (): Promise<PreToolDecision> => ({ kind: 'allow' }),
    )
    expect(denied).toEqual({
      kind: 'deny',
      reason: 'flow2spec_kb_apply requires a planHash from flow2spec_kb_plan.',
    })
    const allowed = await ctx.waterfall(
      'tools/pre-execute',
      toolExec(agent, 'flow2spec_kb_apply', { planHash: 'abc', delta: {} }),
      async (): Promise<PreToolDecision> => ({ kind: 'allow' }),
    )
    expect(allowed).toEqual({ kind: 'allow' })
    const other = await ctx.waterfall(
      'tools/pre-execute',
      toolExec(agent, 'flow2spec_doctor', {}),
      async (): Promise<PreToolDecision> => ({ kind: 'allow' }),
    )
    expect(other).toEqual({ kind: 'allow' })
  })

  it('tools/result on a write tool invalidates cache so the next pre-step still routes', async () => {
    const { ctx, agent } = await boot()
    const signal = new AbortController().signal
    await ctx.waterfall('agent/pre-step', {
      agent,
      messages: userMessage('plan a Flow2Spec task'),
      turn: 1,
      step: 1,
      signal,
    }, async () => ({ kind: 'enter' as const, messages: userMessage('plan a Flow2Spec task') }))
    ctx.emit('tools/result', toolExec(agent, 'flow2spec_kb_build', {}), {
      isError: false,
      value: null,
      content: [],
    })
    await ctx.waterfall('agent/pre-step', {
      agent,
      messages: userMessage('plan a Flow2Spec task'),
      turn: 1,
      step: 2,
      signal,
    }, async () => ({ kind: 'enter' as const, messages: userMessage('plan a Flow2Spec task') }))
    const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent as never, signal })
    expect(assembly.contexts.find(context => context.name === 'flow2spec')?.text)
      .toContain('<flow2spec_context>')
  })

  it('agent/disposed releases session state without throwing', async () => {
    const { ctx, agent } = await boot()
    ctx.emit('agent/created', { agent, source: 'startup' })
    await expect.poll(() => logs.some(line => line.includes('Flow2Spec ready'))).toBe(true)
    ctx.emit('agent/disposed', { agent })
    const assembly = await ctx.systemPrompt.assemble({
      agent,
      scope: agent as never,
      signal: new AbortController().signal,
    })
    const text = assembly.contexts.find(context => context.name === 'flow2spec')?.text ?? ''
    expect(text).not.toContain('<flow2spec_context>')
  })
})
