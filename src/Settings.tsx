import { useEffect, useRef, useState } from 'react'
import { MCP_URL } from './agent'
import { isDesktop } from './native'
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
const storedOthers = () => {
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
    } catch { setUpdating('failed') }
  }
  const install = async () => {
    if (!update) return
    setUpdating('installing')
    try { await installUpdate(update) } catch { setUpdating('failed') }
  }

  // check once on launch; a new version shows a small note until dismissed
  useEffect(() => {
    if (isDesktop && !import.meta.env.DEV) findUpdate().then((u) => { setUpdate(u); setNudge(!!u) }, () => {})
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

  return (
    <>
    {nudge && update && (
      <div className="update-note">
        <span>Version {update.version} is available</span>
        <button className="primary" onClick={() => { setNudge(false); install() }}>Install and restart</button>
        <button title="Later" onClick={() => setNudge(false)}>×</button>
      </div>
    )}
    <dialog ref={dialog} tabIndex={-1} className="tpl-dialog settings" onClick={(e) => e.target === dialog.current && dialog.current!.close()}>
      <header>
        <h2>Settings</h2>
        <button onClick={() => dialog.current!.close()}>Done</button>
      </header>

      <h3>Appearance</h3>
      <nav className="platform-tabs">
        {(['system', 'light', 'dark'] as const).map((a) => (
          <span key={a} className={appearance === a ? 'on' : ''}><button onClick={() => pick(a)}>{a[0].toUpperCase() + a.slice(1)}</button></span>
        ))}
      </nav>

      {project && (
        <>
          <h3>Export size</h3>
          <p className="hint">The pixel size this project's PNGs are exported at. The App Store asks for one of these per device class; the first is the one it requires.</p>
          {project.targets.map((t) => (
            <label key={t.platform}>
              {PLATFORMS[t.platform].label}
              <select value={t.size} onChange={(e) => setProject((p) => ({ ...p, targets: p.targets.map((x) => (x.platform === t.platform ? { ...x, size: e.target.value as SizeName } : x)) }))}>
                {PLATFORMS[t.platform].sizes.map((n) => (
                  <option key={n} value={n}>{n} · {SIZES[n][0]}×{SIZES[n][1]}</option>
                ))}
              </select>
            </label>
          ))}
        </>
      )}

      {isDesktop && (
        <>
          <h3>MCP server</h3>
          <label className="switch">
            <input type="checkbox" checked={others} onChange={(e) => allowOthers(e.target.checked)} />
            Let other MCP clients use Screenshot Studio
          </label>
          <p className="hint">
            {others
              ? 'Any MCP client on this Mac that has the server added (Claude Code, Codex, Gemini CLI, Cursor, VS Code…) can see and change your open project.'
              : 'Off: the MCP server only answers the Agent tab in this app. Other clients get refused.'}
          </p>
          {others && (<>
          <nav className="platform-tabs">
            {(Object.keys(CLIENTS) as Client[]).map((c) => (
              <span key={c} className={client === c ? 'on' : ''}><button onClick={() => setClient(c)}>{c}</button></span>
            ))}
          </nav>
          {client === 'Claude Code' && (
            <p className={`status ${linked ? 'ok' : ''}`}>
              {linked === null ? 'Checking…' : linked ? '● Connected: terminal sessions can use Screenshot Studio.' : '○ Not connected to terminal sessions. The Agent tab works either way.'}
            </p>
          )}
          {!(client === 'Claude Code' && linked) && (
            <>
              <p className="hint">{client === 'Other (JSON)' ? 'Add this to your client\'s MCP config (Cursor: ~/.cursor/mcp.json, Windsurf, Zed and others take the same server entry):' : 'Run this once in a terminal to let it see and edit your screenshots while the app is open:'}</p>
              <div className="row">
                <code style={{ whiteSpace: 'pre-wrap' }}>{command}</code>
                <button onClick={() => { navigator.clipboard.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
              {client === 'Claude Code' && <button onClick={() => claudeLinked().then(setLinked)}>Check again</button>}
            </>
          )}
          <p className="hint">Server address: {MCP_URL}</p>
          </>)}
        </>
      )}

      {isDesktop && (
        <>
          <h3>Updates</h3>
          <p className={`status ${update ? 'ok' : ''}`}>
            {update ? `● Version ${update.version} is available.` : !updating ? 'Updates come from the GitHub releases page.' : {
              checking: 'Checking…', latest: `You're on the latest version.`, installing: 'Installing…', failed: `Couldn't check for updates. Are you online?`,
            }[updating]}
          </p>
          <div className="row">
            <button onClick={checkUpdate} disabled={updating === 'checking' || updating === 'installing'}>Check for updates</button>
            {update && <button className="primary" onClick={install} disabled={updating === 'installing'}>{updating === 'installing' ? 'Installing…' : 'Install and restart'}</button>}
          </div>
        </>
      )}

      <h3>Shortcuts</h3>
      <dl className="shortcuts">
        {[['⌘ ,', 'Settings'], ['⌘ Z / ⇧⌘ Z', 'Undo / redo'], ['⌘ C / ⌘ V / ⌘ D', 'Copy / paste / duplicate'], ['⌘ A', 'Select all'], ['⌫', 'Delete selection'], ['⌘ + / ⌘ − / ⌘ 0', 'Zoom in / out / fit'], ['Space-drag', 'Pan the board'], ['Esc', 'Clear selection']].map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>

      <footer className="about">
        <span>Screenshot Studio{version && ` ${version}`}</span>
        <a href={GITHUB} onClick={(e) => { e.preventDefault(); openLink(GITHUB) }}>GitHub</a>
      </footer>
    </dialog>
    </>
  )
}
