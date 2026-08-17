import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'

export type Flow2SpecLocale = 'auto' | 'zh-CN' | 'en-US'

export interface Flow2SpecPluginConfig {
  locale?: Flow2SpecLocale
  autoInitialize?: boolean
  strictCompatibility?: boolean
  skills?: {
    enabled?: boolean
    providerName?: string
    rank?: number
  }
  routing?: {
    enabled?: boolean
    injectContext?: boolean
    maxFiles?: number
    maxLines?: number
  }
  hooks?: {
    sessionSummary?: boolean
    updateCheck?: boolean
    configPrecheck?: boolean
  }
  commands?: {
    enabled?: boolean
  }
  tools?: {
    readOnly?: boolean
    knowledgeWrite?: boolean
  }
}

export interface ResolvedFlow2SpecPluginConfig {
  locale: Flow2SpecLocale
  autoInitialize: boolean
  strictCompatibility: boolean
  skills: {
    enabled: boolean
    providerName: string
    rank: number
  }
  routing: {
    enabled: boolean
    injectContext: boolean
    maxFiles: number
    maxLines: number
  }
  hooks: {
    sessionSummary: boolean
    updateCheck: boolean
    configPrecheck: boolean
  }
  commands: {
    enabled: boolean
  }
  tools: {
    readOnly: boolean
    knowledgeWrite: boolean
  }
}

const toggles = z.object({
  enabled: z.boolean().default(true),
})

export const Config: Schema<Flow2SpecPluginConfig> = z.object({
  locale: z.union(['auto', 'zh-CN', 'en-US']).default('auto'),
  autoInitialize: z.boolean().default(true),
  strictCompatibility: z.boolean().default(true),
  skills: z.object({
    enabled: z.boolean().default(true),
    providerName: z.string().min(1).default('flow2spec'),
    rank: z.number().min(1).default(250),
  }),
  routing: z.object({
    enabled: z.boolean().default(true),
    injectContext: z.boolean().default(true),
    maxFiles: z.number().min(1).default(20),
    maxLines: z.number().min(1).default(400),
  }),
  hooks: z.object({
    sessionSummary: z.boolean().default(true),
    updateCheck: z.boolean().default(true),
    configPrecheck: z.boolean().default(true),
  }),
  commands: toggles,
  tools: z.object({
    readOnly: z.boolean().default(true),
    knowledgeWrite: z.boolean().default(true),
  }),
})

export function resolveConfig(config: Flow2SpecPluginConfig = {}): ResolvedFlow2SpecPluginConfig {
  assertKnownConfig(config)
  return {
    locale: config.locale ?? 'auto',
    autoInitialize: config.autoInitialize ?? true,
    strictCompatibility: config.strictCompatibility ?? true,
    skills: {
      enabled: config.skills?.enabled ?? true,
      providerName: config.skills?.providerName ?? 'flow2spec',
      rank: config.skills?.rank ?? 250,
    },
    routing: {
      enabled: config.routing?.enabled ?? true,
      injectContext: config.routing?.injectContext ?? true,
      maxFiles: config.routing?.maxFiles ?? 20,
      maxLines: config.routing?.maxLines ?? 400,
    },
    hooks: {
      sessionSummary: config.hooks?.sessionSummary ?? true,
      updateCheck: config.hooks?.updateCheck ?? true,
      configPrecheck: config.hooks?.configPrecheck ?? true,
    },
    commands: {
      enabled: config.commands?.enabled ?? true,
    },
    tools: {
      readOnly: config.tools?.readOnly ?? true,
      knowledgeWrite: config.tools?.knowledgeWrite ?? true,
    },
  }
}

const allowedConfigKeys: Readonly<Record<string, readonly string[]>> = {
  root: ['locale', 'autoInitialize', 'strictCompatibility', 'skills', 'routing', 'hooks', 'commands', 'tools'],
  skills: ['enabled', 'providerName', 'rank'],
  routing: ['enabled', 'injectContext', 'maxFiles', 'maxLines'],
  hooks: ['sessionSummary', 'updateCheck', 'configPrecheck'],
  commands: ['enabled'],
  tools: ['readOnly', 'knowledgeWrite'],
}

function assertKnownConfig(config: Flow2SpecPluginConfig): void {
  assertKeys('root', config)
  for (const section of ['skills', 'routing', 'hooks', 'commands', 'tools'] as const) {
    const value = config[section]
    if (value !== undefined) assertKeys(section, value)
  }
}

function assertKeys(section: keyof typeof allowedConfigKeys, value: object): void {
  const allowed = new Set(allowedConfigKeys[section])
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (unknown.length > 0) {
    const prefix = section === 'root' ? '' : `${section}.`
    throw new TypeError(`Unknown Flow2Spec plugin config field: ${prefix}${unknown[0]}`)
  }
}
