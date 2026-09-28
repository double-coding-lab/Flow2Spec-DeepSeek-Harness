import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { registerSettingsCard, type CardRuntime } from '../src/card/settings-host.js'
import type { ResolvedFlow2SpecPluginConfig } from '../src/config.js'

interface RegisteredRoute {
  kind: string
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

function runtimeStub(): CardRuntime {
  return {
    invalidate: vi.fn(),
    configSnapshot(): ResolvedFlow2SpecPluginConfig {
      return {
        locale: 'zh-CN',
        autoInitialize: true,
        strictCompatibility: true,
        skills: { enabled: true, providerName: 'flow2spec', rank: 250 },
        routing: { enabled: true, injectContext: true, maxFiles: 20, maxLines: 400 },
        hooks: { sessionSummary: true, updateCheck: true, configPrecheck: true },
        commands: { enabled: true },
        tools: { readOnly: true, knowledgeWrite: true },
      }
    },
  }
}

function register(options: { admit?: () => { peer: unknown } | { rejection: 401 | 403 } } = {}): RegisteredRoute {
  const routes: RegisteredRoute[] = []
  const injected: string[][] = []
  const ctx = {
    inject(names: string[], setup: (scoped: unknown) => void): void {
      injected.push(names)
      setup({
        connection: { admit: options.admit ?? (() => ({ peer: {} })) },
        webServer: {
          register(route: RegisteredRoute): () => void {
            routes.push(route)
            return () => {}
          },
        },
        effect: (setup: () => unknown) => {
          setup()
          return () => {}
        },
      })
    },
  }
  registerSettingsCard(ctx as never, runtimeStub())
  expect(injected[0]).toEqual(['connection', 'webServer'])
  const route = routes[0]
  if (route === undefined) throw new Error('expected the card channel route to be registered')
  return route
}

function request(options: {
  method?: string
  url?: string
  contentType?: string
  body?: unknown
} = {}): IncomingMessage {
  const payload = options.body === undefined ? '' : JSON.stringify(options.body)
  const req = Readable.from(payload === '' ? [] : [Buffer.from(payload, 'utf8')]) as unknown as IncomingMessage
  req.method = options.method ?? 'POST'
  req.url = options.url ?? '/flow2spec/card.status'
  req.headers = { 'content-type': options.contentType ?? 'application/json' }
  return req
}

function response(): { res: ServerResponse; status: () => number; body: () => string } {
  const state = { status: 0, body: '' }
  const res = {
    writeHead(status: number): unknown {
      state.status = status
      return res
    },
    end(chunk?: string): unknown {
      state.body = chunk ?? ''
      return res
    },
    on(): unknown {
      return res
    },
  }
  return { res: res as unknown as ServerResponse, status: () => state.status, body: () => state.body }
}

describe('card host route', () => {
  it('registers one prefix route under the card channel', () => {
    const route = register()
    expect(route.kind).toBe('prefix')
    expect(route.path).toBe('/flow2spec')
  })

  it('serves a card endpoint as a server-response envelope', async () => {
    const route = register()
    const res = response()
    await route.handler(request({
      url: '/flow2spec/card.status',
      body: { rpcId: 'rpc-1', method: 'card.status', payload: {} },
    }), res.res)

    expect(res.status()).toBe(200)
    const reply = JSON.parse(res.body()) as {
      type: string
      rpcId: string
      result: { ok: boolean; value: { pluginVersion: string } }
    }
    expect(reply.type).toBe('server-response')
    expect(reply.rpcId).toBe('rpc-1')
    expect(reply.result.ok).toBe(true)
    expect(reply.result.value.pluginVersion).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('keeps the connection admission fence', async () => {
    const route = register({ admit: () => ({ rejection: 401 }) })
    const res = response()
    await route.handler(request({ body: { rpcId: 'rpc-1', method: 'card.status', payload: {} } }), res.res)
    expect(res.status()).toBe(401)
  })

  it('rejects unknown paths, non-POST methods, and non-JSON content types', async () => {
    const route = register()

    const unknown = response()
    await route.handler(request({ url: '/flow2spec', body: {} }), unknown.res)
    expect(unknown.status()).toBe(404)

    const get = response()
    await route.handler(request({ method: 'GET', body: {} }), get.res)
    expect(get.status()).toBe(404)

    const form = response()
    await route.handler(request({ contentType: 'text/plain', body: {} }), form.res)
    expect(form.status()).toBe(415)
  })

  it('reports an envelope method that disagrees with the endpoint', async () => {
    const route = register()
    const res = response()
    await route.handler(request({
      url: '/flow2spec/card.status',
      body: { rpcId: 'rpc-1', method: 'card.checkUpdate', payload: {} },
    }), res.res)

    const reply = JSON.parse(res.body()) as { rpcId: string; result: { ok: boolean; error: { code: string } } }
    expect(res.status()).toBe(200)
    expect(reply.rpcId).toBe('rpc-1')
    expect(reply.result.ok).toBe(false)
    expect(reply.result.error.code).toBe('card/bad-request')
  })
})
