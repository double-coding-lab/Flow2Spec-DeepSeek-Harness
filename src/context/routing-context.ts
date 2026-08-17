import type { UserMessage } from '@deepseek-ai/dsh-session'

import type {
  ProjectCoreApi,
  RoutingExpandedResult,
  RoutingLoadedContext,
  RoutingVerificationResult,
} from '../runtime/project-runtime.js'

export interface RoutingContextOptions {
  maxFiles: number
  maxLines: number
  injectContext: boolean
}

export interface RoutingSnapshot {
  readonly request: string
  readonly expanded: RoutingExpandedResult
  readonly verification: RoutingVerificationResult
  readonly context?: RoutingLoadedContext
  readonly createdAt: number
}

export function extractRequestText(messages: readonly UserMessage[]): string {
  return messages
    .flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

export function resolveRoute(
  api: ProjectCoreApi,
  request: string,
  options: RoutingContextOptions,
): RoutingSnapshot {
  const match = api.routing.match({ request })
  const expanded = api.routing.expand(match)
  const verification = api.routing.verify(expanded)
  if (!verification.ok || verification.fallback === true || !options.injectContext) {
    return { request, expanded, verification, createdAt: Date.now() }
  }
  return {
    request,
    expanded,
    verification,
    context: api.routing.loadContext(expanded, {
      maxFiles: options.maxFiles,
      maxLines: options.maxLines,
    }),
    createdAt: Date.now(),
  }
}

export function renderRoutingContext(snapshot: RoutingSnapshot | undefined): string {
  if (snapshot === undefined || snapshot.request.trim() === '') return ''
  const topics = snapshot.expanded.topics.join(', ') || '(none)'
  const missing = snapshot.verification.missing
    ?.map(item => typeof item === 'string' ? item : item.id ?? item.path ?? item.kind)
    .join(', ') ?? ''
  const header = [
    '<flow2spec_context>',
    `verified: ${snapshot.verification.ok}`,
    `confidence: ${snapshot.verification.confidence ?? 'unknown'}`,
    `topics: ${topics}`,
  ]
  if (snapshot.verification.fallback === true) header.push('fallback: true')
  if (missing !== '') header.push(`missing: ${missing}`)
  if (snapshot.context !== undefined) {
    for (const file of snapshot.context.files) {
      header.push('', `source: ${file.path}`, file.content.trimEnd())
    }
    if (snapshot.context.truncated === true) header.push('', 'context_truncated: true')
  }
  header.push('</flow2spec_context>')
  return header.join('\n')
}

export class RoutingContextStore<TAgent extends object = object> {
  private readonly snapshots = new WeakMap<TAgent, RoutingSnapshot>()
  private readonly cache = new Map<string, RoutingSnapshot>()

  set(agent: TAgent, snapshot: RoutingSnapshot): void {
    this.snapshots.set(agent, snapshot)
  }

  get(agent: TAgent | undefined): RoutingSnapshot | undefined {
    return agent === undefined ? undefined : this.snapshots.get(agent)
  }

  clear(agent: TAgent): void {
    this.snapshots.delete(agent)
  }

  getCached(key: string): RoutingSnapshot | undefined {
    return this.cache.get(key)
  }

  setCached(key: string, snapshot: RoutingSnapshot): void {
    this.cache.set(key, snapshot)
  }

  invalidate(): void {
    this.cache.clear()
  }

  render(agent: TAgent | undefined): string {
    return renderRoutingContext(this.get(agent))
  }
}
