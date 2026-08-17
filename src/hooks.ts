import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'

import type { ResolvedFlow2SpecPluginConfig } from './config.js'
import { asPluginError, type Flow2SpecPluginRuntime } from './runtime/plugin-runtime.js'
import { FLOW2SPEC_WRITE_TOOLS } from './tools.js'

export function registerHooks(
  ctx: Context,
  runtime: Flow2SpecPluginRuntime,
  config: ResolvedFlow2SpecPluginConfig,
  invalidateSkills: () => void,
): void {
  const logger = ctx.logger('flow2spec')
  const sessionAgents = new WeakMap<Session, Agent>()

  ctx.on('agent/session-start', ({ agent }) => {
    sessionAgents.set(agent.session, agent)
    void runtime.projectForAgent(agent).then(async project => {
      if (config.hooks.sessionSummary) {
        logger.info('Flow2Spec ready: root=%s locale=%s taskRoot=%s',
          project.root,
          project.locale,
          project.collaboration.taskRoot,
        )
      }
      if (config.hooks.updateCheck) {
        const update = await project.api.update.check()
        if (update.notice !== '') logger.info('%s', update.notice)
      }
    }).catch(error => logger.warn('%s', asPluginError(error).message))
  })

  ctx.on('agent/pre-step', async (payload, next) => {
    if (!config.routing.enabled) return next()
    try {
      await runtime.routeAgent(payload.agent, payload.messages, payload.signal)
    } catch (error) {
      if (!payload.signal.aborted) logger.warn('%s', asPluginError(error).message)
    }
    return next()
  })

  ctx.on('agent/request', async (payload, next) => {
    try {
      await runtime.projectForAgent(payload.agent, payload.signal)
    } catch (error) {
      if (!payload.signal.aborted) logger.warn('%s', asPluginError(error).message)
    }
    return next()
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'flow2spec_kb_apply') {
      const args = exec.arguments as { planHash?: unknown }
      if (typeof args.planHash !== 'string' || args.planHash.length === 0) {
        return { kind: 'deny', reason: 'flow2spec_kb_apply requires a planHash from flow2spec_kb_plan.' }
      }
    }
    return next()
  })

  ctx.on('tools/result', (exec, result) => {
    if (!result.isError && FLOW2SPEC_WRITE_TOOLS.has(exec.name)) {
      const cwd = exec.agent?.session.header.cwd
      runtime.invalidate(cwd)
      invalidateSkills()
    }
  })

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    const agent = sessionAgents.get(session)
    if (agent !== undefined) runtime.routes.clear(agent)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    runtime.releaseAgent(agent)
  })
}
