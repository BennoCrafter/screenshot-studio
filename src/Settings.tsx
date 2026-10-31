import { useEffect, useRef, useState } from 'react'
import { MCP_URL } from './agent'
import { isDesktop } from './native'

type Appearance = 'system' | 'light' | 'dark'

export const ADD_COMMAND = `claude mcp add --scope user --transport http screenshot-studio ${MCP_URL}`

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

export const openSettings = () => window.dispatchEvent(new Event('open-settings'))

type Update = import('@tauri-apps/plugin-updater').Update
/** A newer release on GitHub, or null; throws when it can't tell. */
const findUpdate = async () => (await import('@tauri-apps/plugin-updater')).check()
const installUpdate = async (u: Update) => {
  await u.downloadAndInstall()
  await (await import('@tauri-apps/plugin-process')).relaunch()
}

/** App settings, opened with ⌘, or a gear button. */
export function Settings() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [appearance, setAppearance] = useState(stored)
  const [linked, setLinked] = useState<boolean | null>(null)
  const [copied, setCopied] = useState(false)
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
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('open-settings', open) }
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

      {isDesktop && (
        <>
          <h3>Claude Code</h3>
          <p className={`status ${linked ? 'ok' : ''}`}>
            {linked === null ? 'Checking…' : linked ? '● Connected: terminal sessions can use Screenshot Studio.' : '○ Not connected to terminal sessions. The Claude tab works either way.'}
          </p>
          {!linked && (
            <>
              <p className="hint">Run this once in a terminal to let every Claude Code session see and edit your screenshots while the app is open:</p>
              <div className="row">
                <code>{ADD_COMMAND}</code>
                <button onClick={() => { navigator.clipboard.writeText(ADD_COMMAND); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
              <button onClick={() => claudeLinked().then(setLinked)}>Check again</button>
            </>
          )}
          <p className="hint">Server address: {MCP_URL}</p>
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
