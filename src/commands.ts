import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'

import { resultText, type Flow2SpecPluginRuntime } from './runtime/plugin-runtime.js'

export function registerCommands(ctx: Context, runtime: Flow2SpecPluginRuntime): () => void {
  return ctx.commands.register({
    name: 'flow2spec',
    description: 'Inspect and operate Flow2Spec for the current project',
    input: { hint: 'status | init | doctor | route <request> | kb check | kb build | update' },
    handler: async ({ agent, rawInput, signal }: CommandInvocation) => {
      try {
        const input = rawInput.trim()
        const [command = 'status', subcommand] = input.split(/\s+/, 2)
        const project = await runtime.projectForAgent(agent, signal)
        signal.throwIfAborted()
        let value: unknown
        if (command === 'status') {
          value = await runtime.status(agent)
        } else if (command === 'init') {
          value = await project.api.project.init({ mode: 'native-host', locale: project.locale })
          runtime.invalidate(project.root)
        } else if (command === 'doctor') {
          value = await runtime.doctor(agent)
        } else if (command === 'route') {
          const request = input.slice(command.length).trim()
          const match = project.api.routing.match({ request })
          const expanded = project.api.routing.expand(match)
          value = { match, expanded, verification: project.api.routing.verify(expanded) }
        } else if (command === 'kb' && subcommand === 'check') {
          value = project.api.knowledge.check({ strict: true, strictRevision: true })
        } else if (command === 'kb' && subcommand === 'build') {
          value = {
            build: project.api.knowledge.build(),
            check: project.api.knowledge.check({ strict: true, strictRevision: true }),
          }
          runtime.invalidate(project.root)
        } else if (command === 'update') {
          value = await project.api.update.check({ force: true, signal })
        } else {
          return { kind: 'error', text: `Unknown /flow2spec command: ${input || command}` }
        }
        return { kind: 'success', text: resultText(value) }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
