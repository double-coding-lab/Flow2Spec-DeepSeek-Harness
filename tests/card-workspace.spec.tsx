// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fingerprintOf } from '../src/card/config-io.js'
import { WorkspaceSection, type ConnectionRpc, type RpcResult, type WorkspaceItem } from '../src/client/workspace.js'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

interface RpcCall {
  endpoint: string
  payload: Record<string, unknown>
}

const ITEMS: readonly WorkspaceItem[] = [
  { workspaceId: 'ws-a', path: 'E:/repo-a', title: 'repo-a' },
  { workspaceId: 'ws-b', path: 'E:/repo-b', title: 'repo-b' },
]

const CONFIGS: Record<string, Record<string, unknown>> = {
  'E:/repo-a': { locale: 'zh-CN', subAgent: true, collaboration: { enabled: true, developerId: '' } },
  'E:/repo-b': { locale: 'en-US', subAgent: false, collaboration: { enabled: true, developerId: 'bob' } },
}

function fakeRpc(calls: RpcCall[]): ConnectionRpc {
  return {
    call(_channel, endpoint, payload): Promise<RpcResult> {
      const body = (payload ?? {}) as Record<string, unknown>
      calls.push({ endpoint, payload: body })
      const root = String(body['cwd'])
      const config = CONFIGS[root]
      if (config === undefined) return Promise.resolve({ ok: false, error: { message: 'unknown workspace' } })
      if (endpoint === 'card.config.read') {
        return Promise.resolve({
          ok: true,
          value: { initialized: true, config, fingerprint: fingerprintOf(JSON.stringify(config)) },
        })
      }
      if (endpoint === 'card.config.save') {
        return Promise.resolve({
          ok: true,
          value: { config, fingerprint: fingerprintOf(JSON.stringify(config)) },
        })
      }
      return Promise.resolve({ ok: false, error: { message: `unexpected ${endpoint}` } })
    },
  }
}

let host: HTMLDivElement
let root: Root
let calls: RpcCall[]

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<WorkspaceSection t={key => key} rpc={fakeRpc(calls)} items={ITEMS} />)
  })
}

function picks(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('.f2sPc-pick')]
}

function localeSelect(): HTMLSelectElement {
  const node = host.querySelector<HTMLSelectElement>('#f2s-field-locale')
  if (node === null) throw new Error('locale select is not rendered')
  return node
}

function buttonByText(text: string): HTMLButtonElement {
  const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)
  if (node === undefined) throw new Error(`button ${text} is not rendered`)
  return node
}

async function click(node: HTMLElement): Promise<void> {
  await act(async () => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function selectLocale(value: string): Promise<void> {
  const node = localeSelect()
  await act(async () => {
    node.value = value
    node.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function readsFor(cwd: string): RpcCall[] {
  return calls.filter(call => call.endpoint === 'card.config.read' && call.payload['cwd'] === cwd)
}

describe('workspace picker selection', () => {
  it('prefetches every workspace config once when the section mounts', async () => {
    await mount()

    expect(readsFor('E:/repo-a')).toHaveLength(1)
    expect(readsFor('E:/repo-b')).toHaveLength(1)
  })

  it('renders the form on click without issuing another request', async () => {
    await mount()
    const before = calls.length

    await click(picks()[0] as HTMLElement)

    expect(picks()[0]?.getAttribute('aria-selected')).toBe('true')
    expect(picks()[0]?.className).toContain('f2sPc-pickActive')
    expect(localeSelect().value).toBe('zh-CN')
    expect(calls).toHaveLength(before)
  })

  it('keeps selection instant when the config request is still pending', async () => {
    const pending: Array<() => void> = []
    await act(async () => {
      root.render(
        <WorkspaceSection
          t={key => key}
          rpc={{
            call(_channel, endpoint, payload) {
              calls.push({ endpoint, payload: (payload ?? {}) as Record<string, unknown> })
              return new Promise<RpcResult>(resolve => {
                pending.push(() => resolve({ ok: true, value: { initialized: true, config: {}, fingerprint: 'x' } }))
              })
            },
          }}
          items={ITEMS}
        />,
      )
    })

    await click(picks()[1] as HTMLElement)

    expect(picks()[1]?.getAttribute('aria-selected')).toBe('true')
    expect(pending).toHaveLength(2)
  })

  it('serves a previously loaded workspace from cache when re-selected', async () => {
    await mount()
    await click(picks()[0] as HTMLElement)
    await click(picks()[1] as HTMLElement)
    await click(picks()[0] as HTMLElement)

    expect(readsFor('E:/repo-a')).toHaveLength(1)
    expect(localeSelect().value).toBe('zh-CN')
  })
})

describe('config form', () => {
  it('sends the locale change with the selected workspace root', async () => {
    await mount()
    await click(picks()[0] as HTMLElement)
    await selectLocale('en-US')
    await click(buttonByText('workspace.save'))

    const saves = calls.filter(call => call.endpoint === 'card.config.save')
    expect(saves).toHaveLength(1)
    expect(saves[0]?.payload['cwd']).toBe('E:/repo-a')
    expect(saves[0]?.payload['changes']).toEqual([{ path: ['locale'], value: 'en-US' }])
  })

  it('confirms a successful save so the locale row does not look like a no-op', async () => {
    await mount()
    await click(picks()[0] as HTMLElement)
    await selectLocale('en-US')
    await click(buttonByText('workspace.save'))

    const status = [...host.querySelectorAll('.f2sPc-formFooter [role="status"]')]
    expect(status.map(node => node.textContent)).toContain('workspace.saved')
  })

  it('explains that the locale field does not change the Harness interface', async () => {
    await mount()
    await click(picks()[0] as HTMLElement)

    const field = localeSelect().closest('.f2sPc-field')
    expect(field?.querySelector('.f2sPc-hint')?.textContent).toBe('field.localeHint')
  })

  it('shows the values of the workspace that is currently selected', async () => {
    await mount()
    await click(picks()[0] as HTMLElement)
    expect(localeSelect().value).toBe('zh-CN')

    await click(picks()[1] as HTMLElement)
    expect(localeSelect().value).toBe('en-US')
  })

  it('saves against the fingerprint of the workspace that is currently selected', async () => {
    await mount()
    await click(picks()[0] as HTMLElement)
    await click(picks()[1] as HTMLElement)
    await selectLocale('zh-CN')
    await click(buttonByText('workspace.save'))

    const saves = calls.filter(call => call.endpoint === 'card.config.save')
    expect(saves).toHaveLength(1)
    expect(saves[0]?.payload['cwd']).toBe('E:/repo-b')
    expect(saves[0]?.payload['fingerprint']).toBe(fingerprintOf(JSON.stringify(CONFIGS['E:/repo-b'])))
  })
})
