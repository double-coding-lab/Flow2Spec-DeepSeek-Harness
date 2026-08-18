import type { Context } from '@deepseek-ai/cordis'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { useEffect, useState, type ReactElement } from 'react'

import type { CardStatus, CheckUpdateResult } from '../card/types.js'

export const inject = ['slots', 'locale', 'connection']

const NS = 'settings.flow2spec'
const CHANNEL = '/flow2spec'
const STYLE_ID = 'flow2spec-plugin-card'

const PLUGIN_GITHUB = 'https://github.com/double-coding-lab/Flow2Spec-DeepSeek-Harness'
const PLUGIN_NPM = 'https://www.npmjs.com/package/@double-coding/flow2spec-deepseek-harness'
const CORE_GITHUB = 'https://github.com/double-coding-lab/Flow2Spec'
const CORE_NPM = 'https://www.npmjs.com/package/@double-coding/flow2spec-core'

const zh: Record<string, string> = {
  title: 'Flow2Spec',
  description: '查看已安装版本，并检查是否有新版本。',
  pluginVersion: '插件版本',
  coreVersion: 'Core 版本',
  openGithub: '在 GitHub 打开',
  openNpm: '在 npm 打开',
  checkUpdate: '检查更新',
  checking: '检查中…',
  current: '已是最新',
  available: '发现新版本',
  failed: '检查失败',
  expand: '展开',
  collapse: '收起',
}

const en: Record<string, string> = {
  title: 'Flow2Spec',
  description: 'View installed versions and check for updates.',
  pluginVersion: 'Plugin version',
  coreVersion: 'Core version',
  openGithub: 'Open on GitHub',
  openNpm: 'Open on npm',
  checkUpdate: 'Check for updates',
  checking: 'Checking…',
  current: 'Up to date',
  available: 'Update available',
  failed: 'Check failed',
  expand: 'Expand',
  collapse: 'Collapse',
}

interface RpcResult {
  ok: boolean
  value?: unknown
  error?: { message: string }
}

interface ConnectionRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult>
}

interface LocaleService {
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
}

export function apply(ctx: ClientContext): void {
  ensureStyles()
  const runtime = ctx as ClientContext & Context & { locale: LocaleService; connection: { rpc: ConnectionRpc } }
  runtime.effect(() => runtime.locale.register(NS, { zh, en }))

  runtime.slots.register({
    name: 'settings.plugin.item',
    key: 'flow2spec',
    locale: NS,
    inject: () => ({
      rpc: runtime.connection.rpc,
    }),
  }, Flow2SpecCard)
}

interface WorkspaceList {
  items: readonly { path: string }[]
}

interface CardProps {
  t: (key: string) => string
  rpc: ConnectionRpc
  useWorkspaces?: (selector: (state: WorkspaceList) => string | undefined) => string | undefined
}

function emptyWorkspaces(selector: (state: WorkspaceList) => string | undefined): string | undefined {
  return selector({ items: [] })
}

function Flow2SpecCard(props: CardProps): ReactElement {
  const selectWorkspace = props.useWorkspaces ?? emptyWorkspaces
  const cwd = selectWorkspace(state => state.items[0]?.path)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<CardStatus | undefined>(undefined)
  const [update, setUpdate] = useState<CheckUpdateResult | undefined>(undefined)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const title = props.t('title')
  // cwd is kept for checkUpdate (Core update check needs a workspace), but not shown in the card
  const _ = cwd

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    void props.rpc.call(CHANNEL, 'card.status', cwd === undefined ? {} : { cwd }, controller.signal)
      .then(result => {
        if (cancelled) return
        if (result.ok) setStatus(result.value as CardStatus)
        else setError(result.error?.message ?? 'status failed')
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [props.rpc, cwd])

  const onCheck = (): void => {
    if (checking) return
    setChecking(true)
    setError(undefined)
    void props.rpc.call(CHANNEL, 'card.checkUpdate', cwd === undefined ? {} : { cwd })
      .then(result => {
        if (result.ok) setUpdate(result.value as CheckUpdateResult)
        else setError(result.error?.message ?? 'check failed')
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught))
      })
      .finally(() => setChecking(false))
  }

  const resultText = update === undefined ? undefined : [
    updateLabel(props.t, update),
    update.suggestion,
    update.error,
  ].filter(part => part !== undefined && part !== '').join(' ')

  return (
    <li className={open ? 'f2sPc-card f2sPc-cardOpen' : 'f2sPc-card'}>
      <button
        type="button"
        className="f2sPc-header"
        aria-expanded={open}
        aria-label={`${props.t(open ? 'collapse' : 'expand')}: ${title}`}
        onClick={() => setOpen(current => !current)}
      >
        <span className="f2sPc-headText">
          <span className="f2sPc-name">{title}</span>
          <span className="f2sPc-description">{props.t('description')}</span>
        </span>
        <svg className={open ? 'f2sPc-chevron f2sPc-chevronOpen' : 'f2sPc-chevron'} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path fill="currentColor" d="M3.2 5.2a.7.7 0 0 1 1-.05L7 7.8l2.8-2.65a.7.7 0 1 1 .9 1.06l-3.25 3.1a.7.7 0 0 1-.9 0L3.25 6.2a.7.7 0 0 1-.05-1z" />
        </svg>
      </button>
      {open && (
        <div className="f2sPc-body">
          <dl className="f2sPc-list">
            <Row
              t={props.t}
              label={props.t('pluginVersion')}
              value={status?.pluginVersion ?? '…'}
              github={PLUGIN_GITHUB}
              npm={PLUGIN_NPM}
            />
            <Row
              t={props.t}
              label={props.t('coreVersion')}
              value={status?.coreVersion ?? '…'}
              github={CORE_GITHUB}
              npm={CORE_NPM}
            />
          </dl>
          <div className="f2sPc-footer">
            {(error !== undefined || resultText !== undefined) && (
              <p className={error !== undefined ? 'f2sPc-failed' : 'f2sPc-result'} role="status">
                {error ?? resultText}
              </p>
            )}
            <button type="button" className="f2sPc-action" disabled={checking} onClick={onCheck}>
              {checking ? props.t('checking') : props.t('checkUpdate')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function Row(props: {
  t: (key: string) => string
  label: string
  value: string
  github?: string
  npm?: string
}): ReactElement {
  return (
    <div className="f2sPc-row">
      <dt className="f2sPc-label">{props.label}</dt>
      <dd className="f2sPc-value">
        <span>{props.value}</span>
        {(props.github !== undefined || props.npm !== undefined) && (
          <span className="f2sPc-links">
            {props.github !== undefined && (
              <OutboundLink href={props.github} label={props.t('openGithub')}>
                <GitHubIcon />
              </OutboundLink>
            )}
            {props.npm !== undefined && (
              <OutboundLink href={props.npm} label={props.t('openNpm')}>
                <NpmIcon />
              </OutboundLink>
            )}
          </span>
        )}
      </dd>
    </div>
  )
}

function OutboundLink(props: { href: string; label: string; children: ReactElement }): ReactElement {
  return (
    <a className="f2sPc-iconLink" href={props.href} target="_blank" rel="noreferrer" aria-label={props.label} title={props.label}>
      {props.children}
    </a>
  )
}

function GitHubIcon(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.7 7.7 0 0 1 8 4.77c.64.01 1.28.09 1.88.23 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
    </svg>
  )
}

function NpmIcon(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M0 0h16v16H0V0zm1.3 1.3v13.4h6.7V4.7h3.3v10H14.7V1.3H1.3z" />
    </svg>
  )
}

function updateLabel(t: (key: string) => string, update: CheckUpdateResult): string {
  if (update.status === 'current') return t('current')
  if (update.status === 'available') return t('available')
  return t('failed')
}

function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`)) return
  const tag = document.createElement('style')
  tag.dataset.plugin = '@double-coding/flow2spec-deepseek-harness'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = CARD_CSS
  document.head.appendChild(tag)
}

const CARD_CSS = `
.f2sPc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.f2sPc-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.f2sPc-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.f2sPc-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.f2sPc-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.f2sPc-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.f2sPc-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.f2sPc-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.f2sPc-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
.f2sPc-chevronOpen{transform:rotate(180deg)}
.f2sPc-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.f2sPc-list{margin:0}
.f2sPc-row{align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 0;display:flex}
.f2sPc-row+.f2sPc-row{border-top:1px solid var(--dsw-alias-border-l2)}
.f2sPc-label{color:var(--dsw-alias-label-primary);align-items:center;gap:6px;display:inline-flex;font-size:13px;font-weight:500;line-height:1.5}
.f2sPc-value{margin:0;color:var(--dsw-alias-label-secondary);align-items:center;gap:8px;display:inline-flex;font-size:13px;line-height:1.5}
.f2sPc-links{align-items:center;gap:4px;display:inline-flex}
.f2sPc-iconLink{color:var(--dsw-alias-label-tertiary);border-radius:6px;padding:2px;display:inline-flex}
.f2sPc-iconLink:hover{color:var(--dsw-alias-label-primary)}
.f2sPc-iconLink:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.f2sPc-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}
.f2sPc-result,.f2sPc-failed{min-width:0;flex:1;margin:0;font-size:12px;line-height:1.5}
.f2sPc-result{color:var(--dsw-alias-label-secondary)}
.f2sPc-failed{color:var(--dsw-alias-label-error)}
.f2sPc-action{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.f2sPc-action:hover:not(:disabled){opacity:.92}
.f2sPc-action:disabled{opacity:.4;cursor:default}
.f2sPc-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
`
