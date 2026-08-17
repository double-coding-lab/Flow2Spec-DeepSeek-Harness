import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  createFlow2Spec,
  type Flow2SpecApi,
  type Flow2SpecLocale as CoreLocale,
  type Flow2SpecProjectConfig,
} from '@double-coding/flow2spec-core'

import { assertCompatibility, type CompatibilityReport } from '../compatibility.js'
import { Flow2SpecDshError } from '../errors.js'

export type ProjectCoreApi = Flow2SpecApi
export type RoutingMatchResult = ReturnType<Flow2SpecApi['routing']['match']>
export type RoutingExpandedResult = ReturnType<Flow2SpecApi['routing']['expand']>
export type RoutingVerificationResult = ReturnType<Flow2SpecApi['routing']['verify']>
export type RoutingLoadedContext = ReturnType<Flow2SpecApi['routing']['loadContext']>

export type ProjectCoreFactory = (options: {
  cwd: string
  signal?: AbortSignal
  onProgress?: (event: unknown) => void
}) => Flow2SpecApi

export interface ProjectRuntime {
  readonly root: string
  readonly api: ProjectCoreApi
  readonly config: Flow2SpecProjectConfig
  readonly collaboration: ReturnType<Flow2SpecApi['collaboration']['resolveDeveloper']>
  readonly compatibility: CompatibilityReport
  readonly locale: CoreLocale
}

export interface ProjectRuntimeOptions {
  autoInitialize: boolean
  locale: 'auto' | 'zh-CN' | 'en-US'
  signal?: AbortSignal
}

export class ProjectRuntimeManager {
  private readonly runtimes = new Map<string, Promise<ProjectRuntime>>()

  constructor(
    private readonly createCore: ProjectCoreFactory = createFlow2Spec,
    private readonly onProgress: (event: unknown) => void = () => {},
  ) {}

  async get(cwd: string, options: ProjectRuntimeOptions): Promise<ProjectRuntime> {
    const root = await findProjectRoot(cwd)
    const existing = this.runtimes.get(root)
    if (existing !== undefined) return existing
    const pending = this.create(root, options)
    this.runtimes.set(root, pending)
    try {
      return await pending
    } catch (error) {
      if (this.runtimes.get(root) === pending) this.runtimes.delete(root)
      throw error
    }
  }

  invalidate(cwd?: string): void {
    if (cwd === undefined) {
      this.runtimes.clear()
      return
    }
    const target = resolve(cwd)
    for (const root of this.runtimes.keys()) {
      if (target === root || target.startsWith(`${root}\\`) || target.startsWith(`${root}/`)) {
        this.runtimes.delete(root)
      }
    }
  }

  private async create(root: string, options: ProjectRuntimeOptions): Promise<ProjectRuntime> {
    options.signal?.throwIfAborted()
    const api = this.createCore({
      cwd: root,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onProgress: this.onProgress,
    })
    try {
      const compatibility = assertCompatibility({ core: api.resources.capabilities() })
      if (options.autoInitialize) {
        await api.project.init({
          mode: 'native-host',
          ...(options.locale === 'auto' ? {} : { locale: options.locale }),
        })
      }
      const inspection = api.project.inspect()
      const locale = resolveProjectLocale(options.locale, inspection.config)
      return {
        root,
        api,
        config: inspection.config,
        collaboration: api.collaboration.resolveDeveloper(),
        compatibility,
        locale,
      }
    } catch (error) {
      options.signal?.throwIfAborted()
      throw new Flow2SpecDshError(
        'F2S_DSH_INIT_FAILED',
        `Failed to initialize Flow2Spec for ${root}.`,
        { root },
        error,
      )
    }
  }
}

function resolveProjectLocale(
  requested: ProjectRuntimeOptions['locale'],
  config: Flow2SpecProjectConfig,
): CoreLocale {
  if (requested !== 'auto') return requested
  return config.locale === 'en-US' ? 'en-US' : 'zh-CN'
}

export async function findProjectRoot(cwd: string): Promise<string> {
  let current = resolve(cwd)
  while (true) {
    try {
      await access(resolve(current, '.git'))
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolve(cwd)
      current = parent
    }
  }
}
