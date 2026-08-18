// @vitest-environment jsdom
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it } from 'vitest'

import { apply, CARD_CSS } from '../src/client/index.js'

interface SlotRegistration {
  options: { name: string; key: string; locale: string; inject: () => { rpc: unknown } }
  boundTo: unknown
}

function fakeContext(registrations: SlotRegistration[]): ClientContext {
  const rpc = { call: () => Promise.resolve({ ok: true }) }
  const slots = {
    // The cordis service proxy binds `this.ctx` at call time, so the plugin must never
    // detach `register` from its service; capturing `this` here is what proves it did not.
    register(this: unknown, options: SlotRegistration['options']): () => void {
      registrations.push({ options, boundTo: this })
      return () => {}
    },
  }
  const ctx = {
    slots,
    locale: { register: () => () => {} },
    connection: { rpc },
    effect: (setup: () => unknown) => {
      setup()
      return () => {}
    },
  }
  return ctx as unknown as ClientContext
}

describe('client apply', () => {
  it('registers the settings card as a method call so the service keeps its context', () => {
    const registrations: SlotRegistration[] = []
    const ctx = fakeContext(registrations)

    apply(ctx)

    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.boundTo).toBe((ctx as unknown as { slots: unknown }).slots)
  })

  it('registers under the settings plugin slot with its own locale namespace', () => {
    const registrations: SlotRegistration[] = []

    apply(fakeContext(registrations))

    const options = registrations[0]?.options
    expect(options?.name).toBe('settings.plugin.item')
    expect(options?.key).toBe('flow2spec')
    expect(options?.locale).toBe('settings.flow2spec')
    expect(options?.inject()).toHaveProperty('rpc')
  })
})

describe('workspace picker styles', () => {
  it('keeps the selected border when the pointer is still over the item', () => {
    const rules = parseStyleRules(CARD_CSS)
    const hover = rules.find(rule => rule.selectorText === '.f2sPc-pick:hover')
    const hoverIdle = rules.find(rule => rule.selectorText.includes('.f2sPc-pick:hover:not(.f2sPc-pickActive)'))
    const active = rules.filter(rule => rule.selectorText.split(',').some(part => part.trim() === '.f2sPc-pickActive:hover' || part.trim() === '.f2sPc-pickActive'))

    expect(hover?.style.getPropertyValue('border-color') ?? '').toBe('')
    expect(hoverIdle?.style.getPropertyValue('background')).toContain('--dsw-alias-bg-layer-3')
    expect(active.some(rule => rule.style.getPropertyValue('border-color').includes('--dsw-alias-label-primary'))).toBe(true)
  })
})

function parseStyleRules(css: string): CSSStyleRule[] {
  const tag = document.createElement('style')
  tag.textContent = css
  document.head.appendChild(tag)
  const rules = [...(tag.sheet?.cssRules ?? [])].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
  tag.remove()
  return rules
}
