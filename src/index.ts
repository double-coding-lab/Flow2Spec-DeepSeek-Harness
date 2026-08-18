import type { Context } from '@deepseek-ai/cordis'

import { registerSettingsCard } from './card/settings-host.js'
import { registerCommands } from './commands.js'
import { Config, resolveConfig, type Flow2SpecPluginConfig } from './config.js'
import { registerHooks } from './hooks.js'
import { KnowledgePlanStore } from './plan-store.js'
import {
  CoreSkillCatalogSource,
  Flow2SpecSkillProvider,
} from './providers/flow2spec-skill-provider.js'
import { Flow2SpecPluginRuntime } from './runtime/plugin-runtime.js'
import { registerTools } from './tools.js'
import { PLUGIN_VERSION } from './version.js'

export const name = 'flow2spec'
export const version = PLUGIN_VERSION
export const inject = ['skills', 'systemPrompt', 'commands', 'tools']
export { Config }
export type { Flow2SpecPluginConfig }

export function apply(ctx: Context, config: Flow2SpecPluginConfig = {}): () => void {
  const resolved = resolveConfig(config)
  const runtime = new Flow2SpecPluginRuntime(resolved)
  const plans = new KnowledgePlanStore()
  let invalidateSkills = (): void => {}

  if (resolved.skills.enabled) {
    const source = new CoreSkillCatalogSource((cwd, signal) => runtime.projects.get(cwd, {
      autoInitialize: resolved.autoInitialize,
      locale: resolved.locale,
      ...(signal === undefined ? {} : { signal }),
    }))
    ctx.skills.registerProvider(control => {
      invalidateSkills = control.invalidate
      return new Flow2SpecSkillProvider(source, {
        name: resolved.skills.providerName,
        rank: resolved.skills.rank,
      })
    })
  }

  ctx.systemPrompt.context({
    name: 'flow2spec',
    order: -50,
    text: context => runtime.renderPromptContext(context.agent),
  })

  if (resolved.commands.enabled) registerCommands(ctx, runtime)
  registerTools(ctx, runtime, plans, resolved.tools)
  registerHooks(ctx, runtime, resolved, () => invalidateSkills())
  registerSettingsCard(ctx)

  return () => {
    plans.clear()
    runtime.invalidate()
  }
}
