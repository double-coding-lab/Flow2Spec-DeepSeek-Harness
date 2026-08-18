import type { Context } from '@deepseek-ai/cordis'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { useEffect, useState, type ReactElement } from 'react'

import type { CardStatus, CheckUpdateResult } from '../card/types.js'
import {
  emptyWorkspaces,
  WorkspaceSection,
  type ConnectionRpc,
  type WorkspaceList,
} from './workspace.js'

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
  description: '查看已安装版本，检查更新，并编辑各工作区的项目配置。',
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
  'workspace.section': '工作区配置',
  'workspace.search': '搜索工作区',
  'workspace.empty': '还没有注册的工作区。请先在侧边栏添加一个工作区。',
  'workspace.noMatch': '没有匹配的工作区。',
  'workspace.loading': '正在读取配置…',
  'workspace.readFailed': '读取配置失败。',
  'workspace.saveFailed': '保存失败。',
  'workspace.initFailed': '初始化失败。',
  'workspace.uninitialized': '这个工作区还没有 Flow2Spec 项目配置。',
  'workspace.init': '初始化',
  'workspace.initConfirmYes': '确认初始化',
  'workspace.initConfirmNo': '取消',
  'workspace.initRunning': '正在初始化…',
  'workspace.initItemConfig': 'flow2spec.config.json',
  'workspace.initItemKnowledge': '.Knowledge/',
  'workspace.initItemDsh': '.dsh/',
  'workspace.save': '保存',
  'workspace.saving': '保存中…',
  'workspace.saved': '已写入 flow2spec.config.json',
  'workspace.discard': '放弃',
  'workspace.dirty': '有未保存的改动',
  'workspace.reload': '重新加载',
  'workspace.conflict': '文件已被外部修改，请重新加载后再保存。',
  'workspace.switchDirty': '当前工作区有未保存的改动，确定要切换吗？未保存的改动会丢失。',
  'workspace.nextSkillHint': '改动在下次技能执行时生效，不会热更新已经在跑的会话。',
  'group.locale': '输出语言',
  'group.orchestration': '编排',
  'group.tracking': '变更追踪',
  'group.update': '更新检查',
  'group.collaboration': '协作',
  'field.locale': '规则与技能语言',
  'field.localeHint': '决定这个项目里 Flow2Spec 生成的规则、技能和文档用哪种语言，不改 Harness 界面语言。',
  'field.subAgent': '允许拆分子 agent',
  'field.switchAgentVerification': '切换 agent 校验',
  'field.intentRecognition': '意图识别',
  'field.changeTrackingFeat': '新能力变更追踪',
  'field.changeTrackingFix': '修复变更追踪',
  'field.changeTrackingImplement': '按方案实现变更追踪',
  'field.updateCheck': '启用知识库更新检查',
  'field.collaborationEnabled': '按开发者隔离任务目录',
  'field.developerId': '开发者 ID',
  'field.developerIdHint': '留空则按 git 邮箱或用户名推断。',
  'field.developerIdRenameWarn': '已有的 .task/<旧 id>/ 目录不会跟着改名。',
  'field.developerIdInvalid': '只能用小写字母、数字和连字符，1–64 个字符，不能以连字符开头或结尾。',
  'locale.zhCN': '简体中文 (zh-CN)',
  'locale.enUS': 'English (en-US)',
}

const en: Record<string, string> = {
  title: 'Flow2Spec',
  description: 'View installed versions, check for updates, and edit each workspace config.',
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
  'workspace.section': 'Workspace config',
  'workspace.search': 'Search workspaces',
  'workspace.empty': 'No registered workspaces yet. Add one from the sidebar first.',
  'workspace.noMatch': 'No matching workspaces.',
  'workspace.loading': 'Loading config…',
  'workspace.readFailed': 'Failed to read config.',
  'workspace.saveFailed': 'Save failed.',
  'workspace.initFailed': 'Initialization failed.',
  'workspace.uninitialized': 'This workspace does not have a Flow2Spec project config yet.',
  'workspace.init': 'Initialize',
  'workspace.initConfirmYes': 'Confirm initialize',
  'workspace.initConfirmNo': 'Cancel',
  'workspace.initRunning': 'Initializing…',
  'workspace.initItemConfig': 'flow2spec.config.json',
  'workspace.initItemKnowledge': '.Knowledge/',
  'workspace.initItemDsh': '.dsh/',
  'workspace.save': 'Save',
  'workspace.saving': 'Saving…',
  'workspace.saved': 'Written to flow2spec.config.json',
  'workspace.discard': 'Discard',
  'workspace.dirty': 'Unsaved changes',
  'workspace.reload': 'Reload',
  'workspace.conflict': 'The file changed on disk. Reload before saving.',
  'workspace.switchDirty': 'This workspace has unsaved changes. Switch anyway and lose them?',
  'workspace.nextSkillHint': 'Changes take effect the next time a skill runs. Running sessions are not hot-reloaded.',
  'group.locale': 'Output language',
  'group.orchestration': 'Orchestration',
  'group.tracking': 'Change tracking',
  'group.update': 'Update check',
  'group.collaboration': 'Collaboration',
  'field.locale': 'Skills and rules language',
  'field.localeHint': 'Sets the language of the rules, skills and docs Flow2Spec generates in this project. It does not change the Harness interface language.',
  'field.subAgent': 'Allow sub-agents',
  'field.switchAgentVerification': 'Switch-agent verification',
  'field.intentRecognition': 'Intent recognition',
  'field.changeTrackingFeat': 'Track new-capability work',
  'field.changeTrackingFix': 'Track fix work',
  'field.changeTrackingImplement': 'Track implement-from-spec work',
  'field.updateCheck': 'Enable knowledge-base update checks',
  'field.collaborationEnabled': 'Isolate task directories per developer',
  'field.developerId': 'Developer ID',
  'field.developerIdHint': 'Leave empty to infer from git email or name.',
  'field.developerIdRenameWarn': 'Existing .task/<old-id>/ directories will not be renamed.',
  'field.developerIdInvalid': 'Use 1–64 characters of [a-z0-9-], with no leading or trailing hyphen.',
  'locale.zhCN': '简体中文 (zh-CN)',
  'locale.enUS': 'English (en-US)',
}

interface LocaleService {
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
}

export function apply(ctx: ClientContext): void {
  ensureStyles()
  const runtime = ctx as ClientContext & Context & { locale: LocaleService; connection: { rpc: ConnectionRpc } }
  runtime.effect(() => runtime.locale.register(NS, { zh, en }))

  // The slot types `locale` and `t` against the owner's namespace, while the runtime binds
  // whichever namespace an entry passes — that is how this card ships its own dictionary.
  // The cast keeps `register` a method call: the service proxy binds `this.ctx` at call time.
  const slots = runtime.slots as unknown as { register: RegisterCardSlot }
  slots.register({
    name: 'settings.plugin.item',
    key: 'flow2spec',
    locale: NS,
    inject: () => ({
      rpc: runtime.connection.rpc,
    }),
  }, Flow2SpecCard)
}

interface CardProps {
  t: (key: string) => string
  rpc: ConnectionRpc
  useWorkspaces?: <T>(selector: (state: WorkspaceList) => T) => T
}

type RegisterCardSlot = (
  options: {
    name: 'settings.plugin.item'
    key: string
    locale: string
    inject: () => { rpc: ConnectionRpc }
  },
  component: (props: CardProps) => ReactElement,
) => () => void

function Flow2SpecCard(props: CardProps): ReactElement {
  const selectWorkspaces = props.useWorkspaces ?? emptyWorkspaces
  const items = selectWorkspaces(state => state.items)
  const cwd = items[0]?.path
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<CardStatus | undefined>(undefined)
  const [update, setUpdate] = useState<CheckUpdateResult | undefined>(undefined)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const title = props.t('title')

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
          <WorkspaceSection t={props.t} rpc={props.rpc} items={items} />
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

export const CARD_CSS = `
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
.f2sPc-action,.f2sPc-discard{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.f2sPc-action{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.f2sPc-action:hover:not(:disabled){opacity:.92}
.f2sPc-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.f2sPc-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.f2sPc-action:disabled,.f2sPc-discard:disabled{opacity:.4;cursor:default}
.f2sPc-action:focus-visible,.f2sPc-discard:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.f2sPc-workspace{border-top:1px solid var(--dsw-alias-border-l2);padding:12px 0 8px;display:flex;flex-direction:column;gap:10px}
.f2sPc-sectionTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:1.5}
.f2sPc-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.f2sPc-search,.f2sPc-input,.f2sPc-select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}
.f2sPc-search{width:100%}
.f2sPc-input,.f2sPc-select{min-width:160px;max-width:240px}
.f2sPc-search:focus-visible,.f2sPc-input:focus-visible,.f2sPc-select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.f2sPc-inputInvalid{border-color:var(--dsw-alias-label-error)}
.f2sPc-picker{margin:0;padding:0;list-style:none;max-height:180px;overflow:auto;display:flex;flex-direction:column;gap:4px}
.f2sPc-pick{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px}
.f2sPc-pick:hover:not(.f2sPc-pickActive){background:var(--dsw-alias-bg-layer-3)}
.f2sPc-pickActive,.f2sPc-pickActive:hover{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3)}
.f2sPc-pickTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.4}
.f2sPc-pickPath{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.4;word-break:break-all}
.f2sPc-panel,.f2sPc-form{display:flex;flex-direction:column;gap:10px}
.f2sPc-initList{margin:0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.f2sPc-group{margin:0;padding:0;border:0}
.f2sPc-groupTitle{padding:8px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:600;letter-spacing:.02em}
.f2sPc-field{flex-direction:column;gap:6px;padding:10px 0;display:flex;border-top:1px solid var(--dsw-alias-border-l2)}
.f2sPc-fieldHead{align-items:center;justify-content:space-between;gap:12px;display:flex}
.f2sPc-switch{appearance:none;width:36px;height:20px;border:0;border-radius:999px;background:var(--dsw-alias-border-l2);position:relative;cursor:pointer;flex:none}
.f2sPc-switch:checked{background:var(--dsw-alias-brand-primary, var(--dsw-alias-label-primary))}
.f2sPc-switch:before{content:"";width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-3);position:absolute;top:2px;left:2px;transition:left .16s}
.f2sPc-switch:checked:before{left:18px}
.f2sPc-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.f2sPc-formFooter{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex;flex-wrap:wrap}
`
