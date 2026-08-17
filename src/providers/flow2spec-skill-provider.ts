import { join } from 'node:path'

import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
} from '@deepseek-ai/dsh-skill'
import type { Flow2SpecApi } from '@double-coding/flow2spec-core'

export interface Flow2SpecSkillResource {
  readonly name: string
  readonly description: string
  readonly content: string
  readonly relativePath: string
  readonly resourceRoot?: string
  readonly whenToUse?: string
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly invocation?: {
    readonly modelInvocable: boolean
    readonly userInvocable: boolean
  }
}

export interface Flow2SpecSkillCatalogSource {
  list(options: SkillLookupOptions): Promise<readonly Flow2SpecSkillResource[]>
}

export class CoreSkillCatalogSource implements Flow2SpecSkillCatalogSource {
  constructor(
    private readonly getRuntime: (cwd: string, signal?: AbortSignal) => Promise<{ api: Flow2SpecApi; locale: 'zh-CN' | 'en-US' }>,
  ) {}

  async list(options: SkillLookupOptions): Promise<readonly Flow2SpecSkillResource[]> {
    const cwd = options.cwd ?? process.cwd()
    const runtime = await this.getRuntime(cwd, options.signal)
    options.signal?.throwIfAborted()
    return runtime.api.resources.skillCatalog({ host: 'dsh', locale: runtime.locale }).map(skill => ({
      name: skill.name,
      description: skill.description,
      content: renderSkillWithResources(skill),
      relativePath: skill.relativePath,
      resourceRoot: join(runtime.api.resources.root, 'templates', runtime.locale),
      metadata: { resources: skill.resources },
    }))
  }
}

function renderSkillWithResources(skill: ReturnType<Flow2SpecApi['resources']['skillCatalog']>[number]): string {
  if (skill.resources.length === 0) return skill.content
  const resources = skill.resources.map(resource => [
    `### ${resource.relativePath}`,
    '',
    resource.content.trim(),
  ].join('\n'))
  return [
    skill.content.trimEnd(),
    '',
    '<flow2spec_skill_resources>',
    ...resources,
    '</flow2spec_skill_resources>',
    '',
  ].join('\n')
}

interface SkillLocator {
  readonly kind: 'flow2spec-core-skill'
  readonly skill: Flow2SpecSkillResource
}

function isSkillLocator(value: unknown): value is SkillLocator {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<SkillLocator>
  return candidate.kind === 'flow2spec-core-skill' && candidate.skill !== undefined
}

export class Flow2SpecSkillProvider implements SkillProvider {
  readonly name: string

  constructor(
    private readonly source: Flow2SpecSkillCatalogSource,
    options: { name?: string; rank?: number } = {},
  ) {
    this.name = options.name ?? 'flow2spec'
    this.rank = options.rank ?? 250
  }

  private readonly rank: number

  async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
    options.signal?.throwIfAborted()
    const skills = await this.source.list(options)
    options.signal?.throwIfAborted()
    return skills.map(skill => this.candidate(skill))
  }

  async get(
    candidate: SkillCandidate,
    options: SkillLookupOptions,
  ): Promise<SkillDefinition | undefined> {
    options.signal?.throwIfAborted()
    if (!isSkillLocator(candidate.locator)) return undefined
    const skill = candidate.locator.skill
    return {
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
      invocation: skill.invocation ?? { modelInvocable: true, userInvocable: true },
      source: 'runtime',
      provider: this.name,
      ...(skill.resourceRoot === undefined
        ? {}
        : { resourceBase: { kind: 'directory' as const, path: skill.resourceRoot } }),
      ...(skill.metadata === undefined ? {} : { metadata: skill.metadata }),
      content: skill.content,
    }
  }

  private candidate(skill: Flow2SpecSkillResource): SkillCandidate {
    return {
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
      invocation: skill.invocation ?? { modelInvocable: true, userInvocable: true },
      source: 'runtime',
      provider: this.name,
      ...(skill.resourceRoot === undefined
        ? {}
        : { resourceBase: { kind: 'directory' as const, path: skill.resourceRoot } }),
      rank: this.rank,
      locator: { kind: 'flow2spec-core-skill', skill } satisfies SkillLocator,
      ...(skill.metadata === undefined ? {} : { metadata: skill.metadata }),
    }
  }
}
