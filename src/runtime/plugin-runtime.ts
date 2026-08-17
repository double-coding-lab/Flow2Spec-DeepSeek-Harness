import {
  existsSync,
  readFileSync,
  readdirSync,
  unwatchFile,
  watch,
  watchFile,
  type Stats,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'

import { Flow2SpecDshError } from '../errors.js'
import { resolveConfig, type ResolvedFlow2SpecPluginConfig } from '../config.js'
import {
  ProjectRuntimeManager,
  type ProjectRuntime,
} from './project-runtime.js'
import {
  extractRequestText,
  resolveRoute,
  RoutingContextStore,
  type RoutingSnapshot,
} from '../context/routing-context.js'

export class Flow2SpecPluginRuntime {
  readonly projects: ProjectRuntimeManager
  readonly routes = new RoutingContextStore<Agent>()
  private readonly agents = new Map<Agent, ProjectRuntime>()
  private readonly watchers = new Map<string, CloseableWatcher[]>()
  private readonly config: ResolvedFlow2SpecPluginConfig

  constructor(config: ResolvedFlow2SpecPluginConfig) {
    this.config = config
    this.projects = new ProjectRuntimeManager()
  }

  async projectForAgent(agent: Agent, signal?: AbortSignal): Promise<ProjectRuntime> {
    const runtime = await this.projects.get(agent.session.header.cwd ?? process.cwd(), {
      autoInitialize: this.config.autoInitialize,
      locale: this.config.locale,
      ...(signal === undefined ? {} : { signal }),
    })
    this.agents.set(agent, runtime)
    this.ensureWatchers(runtime.root)
    return runtime
  }

  async routeAgent(agent: Agent, messages: readonly UserMessage[], signal?: AbortSignal): Promise<RoutingSnapshot> {
    const runtime = await this.projectForAgent(agent, signal)
    const request = extractRequestText(messages)
    const key = `${runtime.root}\u0000${runtime.api.routing.state().validation.topicCount}\u0000${request}`
    const cached = this.routes.getCached(key)
    if (cached !== undefined) {
      this.routes.set(agent, cached)
      return cached
    }
    signal?.throwIfAborted()
    const snapshot = resolveRoute(runtime.api, request, {
      maxFiles: this.config.routing.maxFiles,
      maxLines: this.config.routing.maxLines,
      injectContext: this.config.routing.injectContext,
    })
    this.routes.setCached(key, snapshot)
    this.routes.set(agent, snapshot)
    return snapshot
  }

  renderPromptContext(agent: Agent | undefined): string {
    const route = this.routes.render(agent)
    if (agent === undefined) return route
    const runtime = this.agents.get(agent)
    if (runtime === undefined) return route
    const entry = runtime.api.resources.unifiedEntry({
      host: 'dsh',
      locale: runtime.locale,
      projectConfig: runtime.config,
    })
    return [entry, route].filter(Boolean).join('\n\n')
  }

  async status(agent: Agent): Promise<Record<string, unknown>> {
    const runtime = await this.projectForAgent(agent)
    return {
      pluginVersion: '1.0.0',
      coreVersion: readCoreVersion(runtime.api.resources.root),
      compatibility: runtime.compatibility,
      projectRoot: runtime.root,
      locale: runtime.locale,
      developer: runtime.collaboration,
      knowledge: runtime.api.knowledge.status(),
    }
  }

  async doctor(agent: Agent): Promise<Record<string, unknown>> {
    const runtime = await this.projectForAgent(agent)
    const report = runtime.api.doctor.run()
    const oldSkills = findLegacyProjectSkills(runtime.root)
    return {
      ...report,
      plugin: {
        compatibility: runtime.compatibility,
        provider: this.config.skills.enabled,
        oldProjectSkills: oldSkills,
      },
    }
  }

  invalidate(cwd?: string): void {
    this.routes.invalidate()
    this.projects.invalidate(cwd)
    if (cwd === undefined) {
      this.agents.clear()
      for (const watchers of this.watchers.values()) watchers.forEach(watcher => watcher.close())
      this.watchers.clear()
      return
    }
    const target = resolve(cwd)
    for (const [agent, runtime] of this.agents) {
      const changed = relative(runtime.root, target)
      if (changed === '' || (!changed.startsWith('..') && !changed.includes(':'))) {
        this.agents.delete(agent)
      }
    }
    for (const [root, watchers] of this.watchers) {
      const changed = relative(root, target)
      if (changed === '' || (!changed.startsWith('..') && !changed.includes(':'))) {
        watchers.forEach(watcher => watcher.close())
        this.watchers.delete(root)
      }
    }
  }

  configSnapshot(): ResolvedFlow2SpecPluginConfig {
    return resolveConfig(this.config)
  }

  releaseAgent(agent: Agent): void {
    this.routes.clear(agent)
    this.agents.delete(agent)
  }

  private ensureWatchers(root: string): void {
    if (this.watchers.has(root)) return
    if (usePollingWatchers()) {
      const watchers = pollingWatchPaths(root).map(path => createPollingWatcher(path, () => {
        this.invalidate(root)
      }))
      this.watchers.set(root, watchers)
      return
    }
    const paths = [
      root,
      join(root, '.Knowledge'),
      join(root, '.Knowledge', 'topics'),
      join(root, '.Knowledge', 'matchers'),
    ].filter(path => existsSync(path))
    const watchers = paths.map(path => watch(path, (_event, filename) => {
      const changed = String(filename ?? '')
      if (changed.endsWith('update-check.json')) return
      if (path === root && changed !== 'flow2spec.config.json') return
      this.invalidate(root)
    }))
    this.watchers.set(root, watchers)
  }
}

interface CloseableWatcher {
  close(): void
}

function usePollingWatchers(): boolean {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
  return process.platform === 'win32' && nodeMajor >= 24
}

function pollingWatchPaths(root: string): string[] {
  const knowledgeRoot = join(root, '.Knowledge')
  const directories = [
    knowledgeRoot,
    join(knowledgeRoot, 'topics'),
    join(knowledgeRoot, 'matchers'),
  ].filter(path => existsSync(path))
  const files = [
    join(root, 'flow2spec.config.json'),
    join(knowledgeRoot, 'manifest-routing.json'),
    ...directories.flatMap(directory => {
      try {
        return readdirSync(directory, { withFileTypes: true })
          .filter(entry => entry.isFile() && entry.name !== 'update-check.json')
          .map(entry => join(directory, entry.name))
      } catch {
        return []
      }
    }),
  ].filter(path => existsSync(path))
  return [...new Set([...directories, ...files])]
}

function createPollingWatcher(path: string, onChange: () => void): CloseableWatcher {
  const listener = (current: Stats, previous: Stats): void => {
    if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) onChange()
  }
  watchFile(path, { interval: 1_000, persistent: false }, listener)
  return {
    close: () => unwatchFile(path, listener),
  }
}

function readCoreVersion(resourcesRoot: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(resourcesRoot, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

function findLegacyProjectSkills(root: string): string[] {
  const skillsRoot = join(root, '.dsh', 'skills')
  if (!existsSync(skillsRoot)) return []
  try {
    const entries = readdirSync(skillsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
    return entries.filter(name => name.startsWith('f2s-')).map(name => `.dsh/skills/${name}`)
  } catch {
    return []
  }
}

export function asPluginError(error: unknown, code: 'F2S_DSH_ROUTING_INVALID' | 'F2S_DSH_ABORTED' = 'F2S_DSH_ROUTING_INVALID'): Flow2SpecDshError {
  if (error instanceof Flow2SpecDshError) return error
  return new Flow2SpecDshError(code, error instanceof Error ? error.message : String(error), {}, error)
}

export function resultText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
