import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'

import {
  DEVELOPER_ID_PATTERN,
  FORM_FIELDS,
  FORM_GROUP_ORDER,
  diffConfigChanges,
  displayValue,
  setAt,
  type FormField,
} from '../card/config-fields.js'
import type { ConfigReadResult, ConfigSaveResult, ProjectInitCardResult } from '../card/types.js'

export interface WorkspaceItem {
  workspaceId: string
  path: string
  title: string
}

export interface WorkspaceList {
  items: readonly WorkspaceItem[]
}

export interface ConnectionRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult>
}

export interface RpcResult {
  ok: boolean
  value?: unknown
  error?: { code?: string; message: string; details?: Record<string, unknown> }
}

const CHANNEL = '/flow2spec'

const INIT_ITEMS = ['workspace.initItemConfig', 'workspace.initItemKnowledge', 'workspace.initItemDsh'] as const

type ConfigEntry =
  | { kind: 'loading' }
  | { kind: 'ready'; read: ConfigReadResult }
  | { kind: 'error'; message?: string }

export function WorkspaceSection(props: {
  t: (key: string) => string
  rpc: ConnectionRpc
  items: readonly WorkspaceItem[]
}): ReactElement {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [dirty, setDirty] = useState(false)
  const [entries, setEntries] = useState<Record<string, ConfigEntry>>({})

  const rpcRef = useRef(props.rpc)
  rpcRef.current = props.rpc
  const entriesRef = useRef(entries)
  const inflight = useRef(new Set<string>())
  const alive = useRef(true)
  useEffect(() => () => {
    alive.current = false
  }, [])

  const commit = useCallback((cwd: string, entry: ConfigEntry): void => {
    entriesRef.current = { ...entriesRef.current, [cwd]: entry }
    if (alive.current) setEntries(entriesRef.current)
  }, [])

  // Reads are cached per workspace so switching back is instant: the click never waits on a round trip.
  const load = useCallback((cwd: string, mode: 'cache' | 'reload'): void => {
    if (inflight.current.has(cwd)) return
    if (mode === 'cache' && entriesRef.current[cwd] !== undefined) return
    inflight.current.add(cwd)
    commit(cwd, { kind: 'loading' })
    void rpcRef.current.call(CHANNEL, 'card.config.read', { cwd })
      .then(result => {
        if (result.ok) commit(cwd, { kind: 'ready', read: result.value as ConfigReadResult })
        else commit(cwd, { kind: 'error', ...(result.error === undefined ? {} : { message: result.error.message }) })
      })
      .catch((caught: unknown) => {
        commit(cwd, { kind: 'error', message: caught instanceof Error ? caught.message : String(caught) })
      })
      .finally(() => {
        inflight.current.delete(cwd)
      })
  }, [commit])

  useEffect(() => {
    for (const item of props.items) load(item.path, 'cache')
  }, [props.items, load])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return props.items
    return props.items.filter(item => {
      return item.title.toLowerCase().includes(needle) || item.path.toLowerCase().includes(needle)
    })
  }, [props.items, query])

  useEffect(() => {
    if (selectedId === undefined) return
    if (props.items.some(item => item.workspaceId === selectedId)) return
    setSelectedId(undefined)
    setDirty(false)
  }, [props.items, selectedId])

  const selected = props.items.find(item => item.workspaceId === selectedId)

  const select = (id: string): void => {
    if (id === selectedId) return
    if (dirty && !window.confirm(props.t('workspace.switchDirty'))) return
    setSelectedId(id)
    setDirty(false)
  }

  return (
    <section className="f2sPc-workspace" aria-label={props.t('workspace.section')}>
      <h3 className="f2sPc-sectionTitle">{props.t('workspace.section')}</h3>
      {props.items.length === 0 ? (
        <p className="f2sPc-hint">{props.t('workspace.empty')}</p>
      ) : (
        <>
          {props.items.length > 5 && (
            <input
              className="f2sPc-search"
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={props.t('workspace.search')}
              aria-label={props.t('workspace.search')}
            />
          )}
          <ul className="f2sPc-picker" role="listbox" aria-label={props.t('workspace.section')}>
            {filtered.map(item => {
              const active = item.workspaceId === selectedId
              return (
                <li key={item.workspaceId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={active ? 'f2sPc-pick f2sPc-pickActive' : 'f2sPc-pick'}
                    onClick={() => select(item.workspaceId)}
                  >
                    <span className="f2sPc-pickTitle">{item.title}</span>
                    <span className="f2sPc-pickPath">{item.path}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {filtered.length === 0 && <p className="f2sPc-hint">{props.t('workspace.noMatch')}</p>}
        </>
      )}
      {selected !== undefined && (
        <WorkspaceEditor
          t={props.t}
          rpc={props.rpc}
          cwd={selected.path}
          entry={entries[selected.path] ?? { kind: 'loading' }}
          onDirtyChange={setDirty}
          onReload={cwd => load(cwd, 'reload')}
          onRead={commit}
        />
      )}
    </section>
  )
}

function WorkspaceEditor(props: {
  t: (key: string) => string
  rpc: ConnectionRpc
  cwd: string
  entry: ConfigEntry
  onDirtyChange: (dirty: boolean) => void
  onReload: (cwd: string) => void
  onRead: (cwd: string, entry: ConfigEntry) => void
}): ReactElement {
  const cwd = props.cwd
  const onRead = props.onRead
  const store = useCallback((read: ConfigReadResult): void => {
    onRead(cwd, { kind: 'ready', read })
  }, [cwd, onRead])

  if (props.entry.kind === 'loading') return <p className="f2sPc-hint">{props.t('workspace.loading')}</p>
  if (props.entry.kind === 'error') {
    return (
      <div className="f2sPc-panel">
        <p className="f2sPc-failed" role="status">{props.entry.message ?? props.t('workspace.readFailed')}</p>
        <button type="button" className="f2sPc-discard" onClick={() => props.onReload(cwd)}>
          {props.t('workspace.reload')}
        </button>
      </div>
    )
  }
  const read = props.entry.read
  if (!read.initialized) {
    return (
      <InitPanel
        key={cwd}
        t={props.t}
        rpc={props.rpc}
        cwd={cwd}
        onInitialized={next => {
          props.onDirtyChange(false)
          store(next)
        }}
      />
    )
  }
  return (
    <ConfigForm
      key={cwd}
      t={props.t}
      rpc={props.rpc}
      cwd={cwd}
      loaded={read.config ?? {}}
      fingerprint={read.fingerprint}
      onDirtyChange={props.onDirtyChange}
      onRead={store}
    />
  )
}

function InitPanel(props: {
  t: (key: string) => string
  rpc: ConnectionRpc
  cwd: string
  onInitialized: (result: ConfigReadResult) => void
}): ReactElement {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'running'>('idle')
  const [error, setError] = useState<string | undefined>(undefined)

  const run = (): void => {
    if (phase === 'running') return
    setPhase('running')
    setError(undefined)
    void props.rpc.call(CHANNEL, 'card.project.init', { cwd: props.cwd })
      .then(result => {
        if (result.ok) {
          props.onInitialized(result.value as ProjectInitCardResult)
          return
        }
        if (result.error?.code === 'already-initialized') {
          const details = result.error.details
          if (details !== undefined && details['initialized'] === true) {
            props.onInitialized(details as unknown as ConfigReadResult)
            return
          }
        }
        setError(result.error?.message ?? props.t('workspace.initFailed'))
        setPhase('confirm')
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught))
        setPhase('confirm')
      })
  }

  return (
    <div className="f2sPc-panel">
      <p className="f2sPc-hint">{props.t('workspace.uninitialized')}</p>
      {phase !== 'idle' && (
        <ul className="f2sPc-initList">
          {INIT_ITEMS.map(key => <li key={key}>{props.t(key)}</li>)}
        </ul>
      )}
      {error !== undefined && <p className="f2sPc-failed" role="status">{error}</p>}
      <div className="f2sPc-formFooter">
        {phase === 'idle' && (
          <button type="button" className="f2sPc-action" onClick={() => setPhase('confirm')}>
            {props.t('workspace.init')}
          </button>
        )}
        {phase === 'confirm' && (
          <>
            <button type="button" className="f2sPc-discard" onClick={() => setPhase('idle')}>
              {props.t('workspace.initConfirmNo')}
            </button>
            <button type="button" className="f2sPc-action" onClick={run}>
              {props.t('workspace.initConfirmYes')}
            </button>
          </>
        )}
        {phase === 'running' && (
          <button type="button" className="f2sPc-action" disabled>
            {props.t('workspace.initRunning')}
          </button>
        )}
      </div>
    </div>
  )
}

function ConfigForm(props: {
  t: (key: string) => string
  rpc: ConnectionRpc
  cwd: string
  loaded: Record<string, unknown>
  fingerprint: string
  onDirtyChange: (dirty: boolean) => void
  onRead: (read: ConfigReadResult) => void
}): ReactElement {
  const [draft, setDraft] = useState(() => ({ ...props.loaded }))
  const [fingerprint, setFingerprint] = useState(props.fingerprint)
  const [loaded, setLoaded] = useState(props.loaded)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'saved' | 'error' | 'conflict' | 'invalid'; text: string } | undefined>(undefined)
  const [developerIdError, setDeveloperIdError] = useState<string | undefined>(undefined)

  const changes = useMemo(() => diffConfigChanges(draft, loaded), [draft, loaded])
  const dirty = changes.length > 0
  const onDirtyChange = props.onDirtyChange

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  const draftId = String(displayValue(draft, developerIdField))
  const loadedId = String(displayValue(loaded, developerIdField))
  const developerIdChanged = draftId !== loadedId

  const patch = (field: FormField, value: string | boolean): void => {
    setDraft(current => setAt(current, field.path, value))
    setMessage(undefined)
    if (field.kind === 'developerId' && typeof value === 'string') {
      const trimmed = value.trim()
      setDeveloperIdError(trimmed === '' || DEVELOPER_ID_PATTERN.test(trimmed) ? undefined : props.t('field.developerIdInvalid'))
    }
  }

  const adopt = (config: Record<string, unknown>, next: string): void => {
    setLoaded(config)
    setDraft({ ...config })
    setFingerprint(next)
    setDeveloperIdError(undefined)
  }

  const save = (): void => {
    if (saving || changes.length === 0) return
    if (developerIdError !== undefined) return
    setSaving(true)
    setMessage(undefined)
    void props.rpc.call(CHANNEL, 'card.config.save', {
      cwd: props.cwd,
      fingerprint,
      changes,
    })
      .then(result => {
        if (result.ok) {
          const saved = result.value as ConfigSaveResult
          adopt(saved.config, saved.fingerprint)
          props.onRead({ initialized: true, config: saved.config, fingerprint: saved.fingerprint })
          setMessage({ kind: 'saved', text: props.t('workspace.saved') })
          return
        }
        const code = result.error?.code
        const text = result.error?.message ?? props.t('workspace.saveFailed')
        if (code === 'config-conflict') setMessage({ kind: 'conflict', text: props.t('workspace.conflict') })
        else if (code === 'config-invalid') setMessage({ kind: 'invalid', text })
        else setMessage({ kind: 'error', text })
      })
      .catch((caught: unknown) => {
        setMessage({ kind: 'error', text: caught instanceof Error ? caught.message : String(caught) })
      })
      .finally(() => setSaving(false))
  }

  const discard = (): void => {
    setDraft({ ...loaded })
    setDeveloperIdError(undefined)
    setMessage(undefined)
  }

  const reload = (): void => {
    void props.rpc.call(CHANNEL, 'card.config.read', { cwd: props.cwd })
      .then(result => {
        if (!result.ok) {
          setMessage({ kind: 'error', text: result.error?.message ?? props.t('workspace.readFailed') })
          return
        }
        const next = result.value as ConfigReadResult
        adopt(next.config ?? {}, next.fingerprint)
        props.onRead(next)
        setMessage(undefined)
      })
      .catch((caught: unknown) => {
        setMessage({ kind: 'error', text: caught instanceof Error ? caught.message : String(caught) })
      })
  }

  return (
    <div className="f2sPc-form">
      {FORM_GROUP_ORDER.map(group => (
        <fieldset key={group} className="f2sPc-group">
          <legend className="f2sPc-groupTitle">{props.t(`group.${group}`)}</legend>
          {FORM_FIELDS.filter(field => field.group === group).map(field => (
            <FieldRow
              key={field.labelKey}
              t={props.t}
              field={field}
              value={displayValue(draft, field)}
              onChange={value => patch(field, value)}
              {...field.kind === 'developerId' && developerIdChanged
                ? { warning: props.t('field.developerIdRenameWarn') }
                : {}}
              {...field.kind === 'developerId' && developerIdError !== undefined
                ? { error: developerIdError }
                : {}}
            />
          ))}
        </fieldset>
      ))}
      <p className="f2sPc-hint">{props.t('workspace.nextSkillHint')}</p>
      {(dirty || message !== undefined) && (
        <div className="f2sPc-formFooter">
          {message !== undefined && (
            <p className={message.kind === 'saved' ? 'f2sPc-result' : 'f2sPc-failed'} role="status">{message.text}</p>
          )}
          {dirty && message === undefined && (
            <p className="f2sPc-result" role="status">{props.t('workspace.dirty')}</p>
          )}
          {message?.kind === 'conflict' && (
            <button type="button" className="f2sPc-discard" onClick={reload}>
              {props.t('workspace.reload')}
            </button>
          )}
          <button type="button" className="f2sPc-discard" disabled={!dirty || saving} onClick={discard}>
            {props.t('workspace.discard')}
          </button>
          <button
            type="button"
            className="f2sPc-action"
            disabled={!dirty || saving || developerIdError !== undefined}
            onClick={save}
          >
            {saving ? props.t('workspace.saving') : props.t('workspace.save')}
          </button>
        </div>
      )}
    </div>
  )
}

const developerIdField = FORM_FIELDS.find(field => field.kind === 'developerId') as FormField

function FieldRow(props: {
  t: (key: string) => string
  field: FormField
  value: string | boolean
  onChange: (value: string | boolean) => void
  warning?: string
  error?: string
}): ReactElement {
  const id = `f2s-${props.field.labelKey.replaceAll('.', '-')}`
  const hintKey = props.field.hintKey
  return (
    <div className="f2sPc-field">
      <div className="f2sPc-fieldHead">
        <label className="f2sPc-label" htmlFor={id}>{props.t(props.field.labelKey)}</label>
        {props.field.kind === 'boolean' && (
          <input
            id={id}
            className="f2sPc-switch"
            type="checkbox"
            checked={Boolean(props.value)}
            onChange={event => props.onChange(event.target.checked)}
          />
        )}
        {props.field.kind === 'locale' && (
          <select
            id={id}
            className="f2sPc-select"
            value={String(props.value)}
            onChange={event => props.onChange(event.target.value)}
          >
            <option value="zh-CN">{props.t('locale.zhCN')}</option>
            <option value="en-US">{props.t('locale.enUS')}</option>
          </select>
        )}
        {props.field.kind === 'developerId' && (
          <input
            id={id}
            className={props.error !== undefined ? 'f2sPc-input f2sPc-inputInvalid' : 'f2sPc-input'}
            type="text"
            value={String(props.value)}
            spellCheck={false}
            autoComplete="off"
            onChange={event => props.onChange(event.target.value)}
          />
        )}
      </div>
      {hintKey !== undefined && <p className="f2sPc-hint">{props.t(hintKey)}</p>}
      {props.warning !== undefined && <p className="f2sPc-hint">{props.warning}</p>}
      {props.error !== undefined && <p className="f2sPc-failed">{props.error}</p>}
    </div>
  )
}

export function emptyWorkspaces<T>(selector: (state: WorkspaceList) => T): T {
  return selector({ items: [] })
}
