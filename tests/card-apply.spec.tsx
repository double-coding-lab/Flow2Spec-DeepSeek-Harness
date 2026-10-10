// @vitest-environment jsdom
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { apply, CARD_CSS } from '../src/client/index.js'

interface SlotRegistration {
  options: { name: string; id: string; order: number; locale: string; inject: () => { rpc: unknown } }
  boundTo: unknown
}

function fakeContext(registrations: SlotRegistration[]): Context {
  const rpc = { call: () => Promise.resolve({ ok: true }) }
  const slots = {
    // The cordis service proxy binds `this.ctx` at call time, so the plugin must never
    // detach `register` from its service; capturing `this` here is what proves it did not.
    inject(_name: string, setup: () => unknown): () => void {
      setup()
      return () => {}
    },
    register(this: unknown, options: SlotRegistration['options']): () => void {
      registrations.push({ options, boundTo: this })
      return () => {}
    },
  }
  const ctx = {
    slots,
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    connection: { rpc },
    effect: (setup: () => unknown) => {
      setup()
      return () => {}
    },
  }
  return ctx as unknown as Context
}

describe('client apply', () => {
  it('registers the settings card as a method call so the service keeps its context', () => {
    const registrations: SlotRegistration[] = []
    const ctx = fakeContext(registrations)

    apply(ctx)

    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.boundTo).toBe((ctx as unknown as { slots: unknown }).slots)
  })

  it('registers a top-level settings section with its own locale namespace', () => {
    const registrations: SlotRegistration[] = []

    apply(fakeContext(registrations))

    const options = registrations[0]?.options
    expect(options?.name).toBe('settings.section')
    expect(options?.id).toBe('flow2spec')
    expect(options?.order).toBe(25)
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

describe('settings nav icon override', () => {
  it('hides the host fallback icon on the Flow2Spec nav row', () => {
    const hide = parseStyleRules(CARD_CSS)
      .find(rule => rule.selectorText.includes('_navCell') && rule.selectorText.includes('navIcon'))
    expect(hide?.style.getPropertyValue('display')).toBe('none')
  })

  it('paints the plugin glyph with a mask that inherits the nav text color', () => {
    expect(CARD_CSS).toContain('[class*="_navList"]>[class*="_navCell"]:last-child::before')
    expect(CARD_CSS).toContain('background-color:currentColor')
    expect(CARD_CSS).toContain('-webkit-mask:url("data:image/svg+xml')
    expect(CARD_CSS).toContain('mask:url("data:image/svg+xml')
  })
})

describe('workspace picker pane fill', () => {
  const rule = (prefix: string): string => {
    const line = CARD_CSS.split('\n').find(item => item.startsWith(prefix))
    if (line === undefined) throw new Error(`rule ${prefix} is not in CARD_CSS`)
    return line
  }

  it('stretches the page and section so the picker can fill the host scroll pane', () => {
    expect(rule('.f2sPc-page{')).toContain('height:100%')
    expect(rule('.f2sPc-workspace{')).toContain('flex:1 1 auto')
    expect(rule('.f2sPc-workspace{')).toContain('min-height:0')
    expect(rule('.f2sPc-picker{')).toContain('flex:1 1 auto')
    expect(rule('.f2sPc-picker{')).toContain('min-height:120px')
  })

  it('protects the rows above and below the picker from flex shrinkage', () => {
    expect(rule('.f2sPc-page>*{')).toContain('flex:none')
    expect(rule('.f2sPc-workspace>*{')).toContain('flex:none')
  })

  it('caps the picker back at 240px once a workspace form is open', () => {
    const editing = rule('.f2sPc-workspace.f2sPc-editing>.f2sPc-picker{')
    expect(editing).toContain('flex:none')
    expect(editing).toContain('max-height:240px')
  })

  it('keeps a bounded viewport fallback in case the host pane chain stops resolving', () => {
    expect(rule('.f2sPc-picker{')).toContain('max-height:max(200px,calc(100vh - 400px))')
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
