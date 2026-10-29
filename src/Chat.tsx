import { useEffect, useRef, useState } from 'react'
import { MCP_URL } from './agent'

// Chat with Claude Code, run as `claude -p` by the desktop app and connected to this app's
// MCP server, so it can change the project while you watch.

type Item = { role: 'user' | 'assistant' | 'tool' | 'error'; text: string }

const SYSTEM = 'You are the assistant inside Screenshot Studio, a desktop app for App Store screenshots. Use the screenshot-studio tools to look at and change what the user sees: call get_state first, edit with update_project, and check your work with render_slide. Keep replies short.'

const ADD_COMMAND = `claude mcp add --transport http screenshot-studio ${MCP_URL}`

export function Chat({ hidden }: { hidden: boolean }) {
  const [items, setItems] = useState<Item[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const session = useRef<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const add = (it: Item) => setItems((all) => [...all, it])

  useEffect(() => {
    list.current?.scrollTo(0, list.current.scrollHeight)
  }, [items])

  // stream-json lines from the running `claude`
  useEffect(() => {
    let off: (() => void) | undefined
    import('@tauri-apps/api/event').then(({ listen }) =>
      listen<string>('claude-line', ({ payload }) => {
        let ev
        try {
          ev = JSON.parse(payload)
        } catch {
          return // shell noise
        }
        if (ev.session_id) session.current = ev.session_id
        if (ev.type === 'assistant') {
          for (const c of ev.message.content) {
            if (c.type === 'text' && c.text.trim()) add({ role: 'assistant', text: c.text })
            if (c.type === 'tool_use') add({ role: 'tool', text: c.name.replace(/^mcp__screenshot-studio__/, '') })
          }
        }
        if (ev.type === 'result' && ev.is_error) add({ role: 'error', text: ev.result ?? ev.subtype })
      }),
    ).then((u) => (off = u))
    return () => off?.()
  }, [])

  const send = async () => {
    const message = input.trim()
    if (!message || busy) return
    setInput('')
    add({ role: 'user', text: message })
    setBusy(true)
    const mcp = JSON.stringify({ mcpServers: { 'screenshot-studio': { type: 'http', url: MCP_URL } } })
    const args = [
      '-p', message,
      '--output-format', 'stream-json', '--verbose',
      '--mcp-config', mcp,
      '--allowedTools', 'mcp__screenshot-studio', 'Read', 'Glob',
      '--append-system-prompt', SYSTEM,
      ...(session.current ? ['--resume', session.current] : []),
    ]
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('claude_chat', { args })
    } catch (e) {
      add({ role: 'error', text: String(e) || 'Claude Code stopped.' })
    }
    setBusy(false)
  }

  const stop = async () => (await import('@tauri-apps/api/core')).invoke('claude_stop')

  return (
    <div className="chat" hidden={hidden}>
      <div className="chat-list" ref={list}>
        {items.length === 0 && (
          <div className="hint">
            <p>Ask Claude to build or change your screenshots: “Make three iPhone slides about offline sync, in the Ocean theme.” Screenshot files can be given as paths.</p>
            <p>Runs your installed Claude Code. To use it from a terminal session instead, connect it once:</p>
            <code onClick={() => navigator.clipboard.writeText(ADD_COMMAND)} title="Click to copy">{ADD_COMMAND}</code>
          </div>
        )}
        {items.map((it, i) => <div key={i} className={`msg ${it.role}`}>{it.text}</div>)}
        {busy && <div className="msg typing"><i /><i /><i /></div>}
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send() }}>
        <textarea
          rows={3}
          value={input}
          placeholder="Message Claude…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="row">
          <button type="button" onClick={() => { session.current = null; setItems([]) }} disabled={busy || !items.length} title="Start a new conversation">New chat</button>
          {busy ? <button type="button" onClick={stop}>Stop</button> : <button type="submit" className="primary" disabled={!input.trim()}>Send</button>}
        </div>
      </form>
    </div>
  )
}
