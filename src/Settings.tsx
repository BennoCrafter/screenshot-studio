import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MCP_URL } from './agent'
import { isDesktop } from './native'
import { EFFORTS, MODELS, MODES, useStored } from './prefs'
import type { Project } from './project'
import { PLATFORMS, SIZES, type SizeName } from './render'

type Appearance = 'system' | 'light' | 'dark'

/** How to add the server to each MCP client; any client that speaks streamable HTTP works. */
const CLIENTS = {
  'Claude Code': `claude mcp add --scope user --transport http screenshot-studio ${MCP_URL}`,
  Codex: `codex mcp add screenshot-studio --url ${MCP_URL}`,
  'Gemini CLI': `gemini mcp add --scope user --transport http screenshot-studio ${MCP_URL}`,
  'VS Code': `code --add-mcp '${JSON.stringify({ name: 'screenshot-studio', type: 'http', url: MCP_URL })}'`,
  'Other (JSON)': JSON.stringify({ mcpServers: { 'screenshot-studio': { type: 'http', url: MCP_URL } } }, null, 2),
}
type Client = keyof typeof CLIENTS

const stored = (): Appearance => {
  try { return (localStorage.getItem('appearance') as Appearance) || 'system' } catch { return 'system' }
}

/** Light or dark regardless of the system; on the desktop the window glass follows too. */
export async function applyAppearance(a = stored()) {
  if (a === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = a
  if (isDesktop) await (await import('@tauri-apps/api/window')).getCurrentWindow().setTheme(a === 'system' ? null : a).catch(() => {})
}

/** Whether the terminal Claude Code has this app's MCP server added; null when unknown (the browser). */
export async function claudeLinked() {
  if (!isDesktop) return null
  return (await import('@tauri-apps/api/core')).invoke<boolean>('claude_mcp_added').catch(() => null)
}

const GITHUB = 'https://github.com/BennoCrafter/screenshot-studio'

/** Opens a link in the browser (the desktop webview would otherwise navigate itself away). */
export const openLink = async (url: string) => {
  if (!isDesktop) return void window.open(url, '_blank', 'noopener')
  await (await import('@tauri-apps/api/core')).invoke('open_url', { url })
}

/** Whether other MCP clients (terminal agents, editors) may use the app's MCP server (the app's own chat always can). */
export const storedOthers = () => {
  try { return localStorage.getItem('mcp-others') !== 'off' } catch { return true }
}
export async function applyMcpAccess(on = storedOthers()) {
  if (isDesktop) await (await import('@tauri-apps/api/core')).invoke('mcp_allow_others', { on }).catch(() => {})
}

export const openSettings = () => window.dispatchEvent(new Event('open-settings'))

type Update = import('@tauri-apps/plugin-updater').Update
/** A newer release on GitHub, or null; throws when it can't tell. */
const findUpdate = async () => (await import('@tauri-apps/plugin-updater')).check()
const installUpdate = async (u: Update) => {
  await u.downloadAndInstall()
  await (await import('@tauri-apps/plugin-process')).relaunch()
}

/** App settings, opened with ⌘, or from the app menu; with a project open, its export sizes too. */
export function Settings({ project, setProject }: { project: Project | null; setProject: (fn: (p: Project) => Project) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [appearance, setAppearance] = useState(stored)
  const [linked, setLinked] = useState<boolean | null>(null)
  const [others, setOthers] = useState(storedOthers)
  const allowOthers = (on: boolean) => {
    setOthers(on)
    try { localStorage.setItem('mcp-others', on ? 'on' : 'off') } catch { /* not remembered */ }
    applyMcpAccess(on)
    window.dispatchEvent(new Event('mcp-changed'))
  }
  const [copied, setCopied] = useState(false)
  const [client, setClient] = useState<Client>('Claude Code')
  const command = CLIENTS[client]
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<Update | null>(null)
  const [updating, setUpdating] = useState<'checking' | 'latest' | 'installing' | 'failed' | null>(null)
  const [nudge, setNudge] = useState(false) // the launch check found one

  const checkUpdate = async () => {
    setUpdating('checking')
    try {
      const u = await findUpdate()
      setUpdate(u)
      setUpdating(u ? null : 'latest')
    } catch (e) { console.error('update check failed', e); setUpdating('failed') }
  }
  const install = async () => {
    if (!update) return
    setUpdating('installing')
    try { await installUpdate(update) } catch (e) { console.error('update install failed', e); setUpdating('failed') }
  }

  // check once on launch; a new version shows a small note until dismissed
  useEffect(() => {
    if (isDesktop && !import.meta.env.DEV) findUpdate().then((u) => { setUpdate(u); setNudge(!!u) }, (e) => console.warn('launch update check failed', e))
  }, [])

  useEffect(() => {
    if (isDesktop) import('@tauri-apps/api/app').then((a) => a.getVersion()).then(setVersion, () => {})
  }, [])

  useEffect(() => {
    const open = () => {
      if (dialog.current!.open) return
      claudeLinked().then(setLinked)
      dialog.current!.showModal()
      dialog.current!.focus()
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); open() }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-settings', open)
    const off = isDesktop ? import('@tauri-apps/api/event').then(({ listen }) => listen('open-settings', open)) : null // the app menu's Settings…
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('open-settings', open); off?.then((f) => f()) }
  }, [])

  const pick = (a: Appearance) => {
    setAppearance(a)
    try { localStorage.setItem('appearance', a) } catch { /* not remembered */ }
    applyAppearance(a)
  }
  const [mode, setMode] = useStored<keyof typeof MODES>('chat-mode', 'manual')
  const [model, setModel] = useStored<keyof typeof MODELS>('chat-model', '')
  const [effort, setEffort] = useStored<keyof typeof EFFORTS>('chat-effort', '')
  const [section, setSection] = useState('general')
  const [query, setQuery] = useState('')

  const segmented = <T extends string>(value: T, options: readonly T[], set: (v: T) => void) => (
    <nav className="platform-tabs">
      {options.map((o) => <span key={o} className={value === o ? 'on' : ''}><button onClick={() => set(o)}>{o[0].toUpperCase() + o.slice(1)}</button></span>)}
    </nav>
  )
  const menu = <T extends string>(value: T, options: Record<T, string>, set: (v: T) => void) => (
    <select value={value} onChange={(e) => set(e.target.value as T)}>
      {(Object.entries(options) as [T, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  )
  const updateStatus = update ? `Version ${update.version} is available.` : !updating ? `You have version ${version || '…'}.` : {
    checking: 'Checking…', latest: `You're on the latest version.`, installing: 'Installing…', failed: `Couldn't check for updates. Are you online?`,
  }[updating]

  const sections: Section[] = [
    { id: 'general', label: 'General', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.2 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z', groups: [
      { rows: [{ title: 'Appearance', hint: 'Light, dark, or follow the system.', keys: 'theme dark light mode color', ui: segmented(appearance, ['system', 'light', 'dark'] as const, pick) }] },
    ] },
    ...(project ? [{ id: 'project', label: 'Project', icon: 'M4 5h16v14H4zM4 9h16', groups: [
      { title: `Export size · ${project.name}`, hint: 'The pixel size PNGs are exported at. The App Store asks for one of these per device class; the first is the one it requires.', rows: project.targets.map((t) => ({
        title: PLATFORMS[t.platform].label, keys: 'export size pixels resolution png app store',
        ui: menu(t.size, Object.fromEntries(PLATFORMS[t.platform].sizes.map((n) => [n, `${n} · ${SIZES[n][0]}×${SIZES[n][1]}`])) as Record<SizeName, string>,
          (size) => setProject((p) => ({ ...p, targets: p.targets.map((x) => (x.platform === t.platform ? { ...x, size } : x)) }))),
      })) },
    ] }] : []),
    ...(isDesktop ? [{ id: 'agent', label: 'Agent', icon: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z', groups: [
      { title: 'Agent tab', hint: 'The assistant in the sidebar. The same choices sit under its message field.', rows: [
        { title: 'Model', keys: 'ai claude model fable opus sonnet haiku', ui: menu(model, MODELS, setModel) },
        { title: 'Effort', hint: 'How hard it thinks before answering.', keys: 'ai thinking effort reasoning', ui: menu(effort, EFFORTS, setEffort) },
        { title: 'Permissions', hint: 'What it may do without asking. Anything else asks in the chat.', keys: 'ai permission mode allow ask approve', ui: menu(mode, MODES, setMode) },
      ] },
      { title: 'Other MCP clients', hint: `Terminal agents and editors (Claude Code, Codex, Gemini CLI, Cursor, VS Code…) can drive the app through its MCP server at ${MCP_URL}.`, rows: [
        { title: 'Allow other clients', hint: others ? 'They can see and change your open project.' : 'Only the Agent tab can use the app.', keys: 'mcp server clients claude code codex cursor',
          ui: <input type="checkbox" className="switch" aria-label="Allow other MCP clients" checked={others} onChange={(e) => allowOthers(e.target.checked)} /> },
        ...(others ? [{ title: 'Connect a client', wide: true, keys: 'mcp connect claude code codex gemini vs code json config command terminal', ui: (
          <div className="connect">
            {segmented(client, Object.keys(CLIENTS) as Client[], setClient)}
            {client === 'Claude Code' && (
              <p className={`status ${linked ? 'ok' : ''}`}>
                {linked === null ? 'Checking…' : linked ? '● Connected: terminal sessions can use Screenshot Studio.' : '○ Not connected yet.'}
              </p>
            )}
            {!(client === 'Claude Code' && linked) && (
              <>
                <p className="hint">{client === 'Other (JSON)' ? 'Add this to the client\'s MCP config (Cursor: ~/.cursor/mcp.json; Windsurf, Zed and others take the same entry):' : 'Run this once in a terminal:'}</p>
                <div className="command">
                  <code>{command}</code>
                  <button onClick={() => { navigator.clipboard.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy'}</button>
                </div>
                {client === 'Claude Code' && <button className="link" onClick={() => claudeLinked().then(setLinked)}>Check again</button>}
              </>
            )}
          </div>
        ) }] : []),
      ] },
    ] }] : []),
    ...(isDesktop ? [{ id: 'updates', label: 'Updates', icon: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5', groups: [
      { rows: [{ title: 'Software update', hint: updateStatus, keys: 'update version release install', ui: (
        <span className="actions">
          {update
            ? <button className="primary" onClick={install} disabled={updating === 'installing'}>{updating === 'installing' ? 'Installing…' : 'Install and restart'}</button>
            : <button onClick={checkUpdate} disabled={updating === 'checking' || updating === 'installing'}>Check now</button>}
        </span>
      ) }] },
    ] }] : []),
    { id: 'shortcuts', label: 'Shortcuts', icon: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10', groups: [
      { rows: SHORTCUTS.map(([k, v]) => ({ title: v, keys: `keyboard shortcut ${k}`, ui: <kbd>{k}</kbd> })) },
    ] },
  ]

  // a search shows every matching setting, under its section's name
  const q = query.trim().toLowerCase()
  const hit = (r: Row, s: Section, g: Group) => [r.title, r.hint, r.keys, s.label, g.title].some((t) => t?.toLowerCase().includes(q))
  const shown = q
    ? sections.map((s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, rows: g.rows.filter((r) => hit(r, s, g)) })).filter((g) => g.rows.length) })).filter((s) => s.groups.length)
    : sections.filter((s) => s.id === section).slice(0, 1)
  const visible = shown.length || q ? shown : sections.slice(0, 1)

  return (
    <>
    {nudge && update && (
      <div className="update-note">
        <span>Version {update.version} is available</span>
        <button className="primary" onClick={() => { setNudge(false); install() }}>Install and restart</button>
        <button title="Later" onClick={() => setNudge(false)}>×</button>
      </div>
    )}
    <dialog ref={dialog} tabIndex={-1} className="settings" onClick={(e) => e.target === dialog.current && dialog.current!.close()} onClose={() => setQuery('')}>
      <aside className="settings-side">
        <input type="search" className="settings-search" placeholder="Search" aria-label="Search settings" value={query} onChange={(e) => setQuery(e.target.value)} />
        <nav>
          {sections.map((s) => (
            <button key={s.id} className={!q && visible[0]?.id === s.id ? 'on' : ''} onClick={() => { setQuery(''); setSection(s.id) }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={s.icon} /></svg>
              {s.label}
            </button>
          ))}
        </nav>
        <footer>
          <span>Screenshot Studio{version && ` ${version}`}</span>
          <a href={GITHUB} onClick={(e) => { e.preventDefault(); openLink(GITHUB) }}>GitHub</a>
        </footer>
      </aside>
      <div className="settings-main">
        <header>
          <h2>{q ? 'Search' : visible[0]?.label}</h2>
          <button onClick={() => dialog.current!.close()}>Done</button>
        </header>
        <div className="settings-body">
          {!visible.length && <p className="hint">No settings match “{query.trim()}”.</p>}
          {visible.map((s) => (
            <section key={s.id}>
              {q && <h3>{s.label}</h3>}
              {s.groups.map((g, i) => (
                <div key={i} className="settings-group">
                  {g.title && <h4>{g.title}</h4>}
                  {g.hint && <p className="hint">{g.hint}</p>}
                  <div className="settings-card">
                    {g.rows.map((r) => (
                      <div key={r.title} className={r.wide ? 'settings-row wide' : 'settings-row'}>
                        <div><b>{r.title}</b>{r.hint && <small>{r.hint}</small>}</div>
                        {r.ui}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </dialog>
    </>
  )
}

type Row = { title: string; hint?: string; keys?: string; wide?: boolean; ui: ReactNode }
type Group = { title?: string; hint?: string; rows: Row[] }
type Section = { id: string; label: string; icon: string; groups: Group[] }

const SHORTCUTS = [['⌘ ,', 'Settings'], ['⌘ Z / ⇧⌘ Z', 'Undo / redo'], ['⌘ C / ⌘ V / ⌘ D', 'Copy / paste / duplicate'], ['⌘ A', 'Select all'], ['⌫', 'Delete selection'],
  ['⌘ + / ⌘ − / ⌘ 0', 'Zoom in / out / fit'], ['⌘ + scroll', 'Zoom at the pointer'], ['⇧ + scroll', 'Pan sideways'], ['Space-drag', 'Pan the board'], ['Esc', 'Clear selection']]
