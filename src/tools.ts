import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { KnowledgeDelta } from '@double-coding/flow2spec-core'

import { KnowledgePlanStore } from './plan-store.js'
import { type Flow2SpecPluginRuntime } from './runtime/plugin-runtime.js'

const jsonOutput = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

export interface ToolRegistrationOptions {
  readOnly: boolean
  knowledgeWrite: boolean
}

export const FLOW2SPEC_WRITE_TOOLS = new Set([
  'flow2spec_kb_apply',
  'flow2spec_kb_build',
  'flow2spec_project_init',
])

export function registerTools(
  ctx: Context,
  runtime: Flow2SpecPluginRuntime,
  plans: KnowledgePlanStore,
  options: ToolRegistrationOptions,
): void {
  if (options.readOnly) {
    ctx.tools.register(defineTool({
      name: 'flow2spec_route',
      description: 'Route a request through Flow2Spec match, expand, verify, and bounded context loading.',
      parameters: {
        request: { type: 'string', required: true, description: 'The development request to route.' },
      },
      output: jsonOutput,
      async execute({ request }, exec) {
        const agent = requireAgent(exec.agent)
        const project = await runtime.projectForAgent(agent, exec.signal)
        const match = project.api.routing.match({ request })
        const expanded = project.api.routing.expand(match)
        const verification = project.api.routing.verify(expanded)
        return asJson({
          match,
          expanded,
          verification,
          context: verification.ok && !verification.fallback
            ? project.api.routing.loadContext(expanded)
            : undefined,
        })
      },
    }))

    ctx.tools.register(defineTool({
      name: 'flow2spec_doctor',
      description: 'Run Flow2Spec Core and native Harness compatibility diagnostics.',
      parameters: {},
      output: jsonOutput,
      async execute(_args, exec) {
        return asJson(await runtime.doctor(requireAgent(exec.agent)))
      },
    }))

    ctx.tools.register(defineTool({
      name: 'flow2spec_kb_status',
      description: 'Read Flow2Spec project, knowledge, and collaboration status.',
      parameters: {},
      output: jsonOutput,
      async execute(_args, exec) {
        return asJson(await runtime.status(requireAgent(exec.agent)))
      },
    }))

    ctx.tools.register(defineTool({
      name: 'flow2spec_kb_check',
      description: 'Validate Flow2Spec knowledge routing and topic revisions.',
      parameters: {
        strict: { type: 'boolean', default: true, description: 'Enable strict validation.' },
      },
      output: jsonOutput,
      async execute({ strict = true }, exec) {
        const project = await runtime.projectForAgent(requireAgent(exec.agent), exec.signal)
        return asJson(project.api.knowledge.check({ strict, strictRevision: strict }))
      },
    }))
  }

  if (options.knowledgeWrite) {
    ctx.tools.register(defineTool({
      name: 'flow2spec_kb_plan',
      description: 'Plan a structured Flow2Spec knowledge delta and return a guarded plan hash.',
      parameters: {
        delta: { type: 'json', required: true, description: 'A Flow2Spec KnowledgeDelta object.' },
      },
      output: jsonOutput,
      async execute({ delta }, exec) {
        const project = await runtime.projectForAgent(requireAgent(exec.agent), exec.signal)
        return asJson(plans.create(project.root, project.api, delta as unknown as KnowledgeDelta))
      },
    }))

    ctx.tools.register(defineTool({
      name: 'flow2spec_kb_apply',
      description: 'Apply the exact previously planned knowledge delta after revision checks.',
      parameters: {
        delta: { type: 'json', required: true, description: 'The unchanged planned KnowledgeDelta object.' },
        planHash: { type: 'string', required: true, description: 'Hash returned by flow2spec_kb_plan.' },
      },
      output: jsonOutput,
      async execute({ delta, planHash }, exec) {
        const project = await runtime.projectForAgent(requireAgent(exec.agent), exec.signal)
        const result = plans.apply(project.root, project.api, delta as unknown as KnowledgeDelta, planHash)
        runtime.invalidate(project.root)
        return asJson(result)
      },
    }))

    ctx.tools.register(defineTool({
      name: 'flow2spec_kb_build',
      description: 'Rebuild Flow2Spec routing files and run strict validation.',
      parameters: {},
      output: jsonOutput,
      async execute(_args, exec) {
        const project = await runtime.projectForAgent(requireAgent(exec.agent), exec.signal)
        const result = {
          build: project.api.knowledge.build(),
          check: project.api.knowledge.check({ strict: true, strictRevision: true }),
        }
        runtime.invalidate(project.root)
        return asJson(result)
      },
    }))

    ctx.tools.register(defineTool({
      name: 'flow2spec_project_init',
      description: 'Incrementally initialize Flow2Spec in native-host mode without reset or overwrite.',
      parameters: {},
      output: jsonOutput,
      async execute(_args, exec) {
        const project = await runtime.projectForAgent(requireAgent(exec.agent), exec.signal)
        const result = await project.api.project.init({ mode: 'native-host', locale: project.locale })
        runtime.invalidate(project.root)
        return asJson(result)
      },
    }))
  }
}

function requireAgent<T>(agent: T | undefined): T {
  if (agent === undefined) throw new Error('Flow2Spec tools require an active DeepSeek Harness agent.')
  return agent
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}
