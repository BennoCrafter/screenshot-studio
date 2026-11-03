import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MCP_URL } from './agent'
import { APPROVE_TOOL, onApproval, type Approval } from './tools'
import { extOfType } from './project'
import { IMAGE_FILES, openFiles } from './native'
import { claudeLinked, openSettings, storedOthers } from './Settings'
import { effortName, MODES, modelOf, useModels, useStored } from './prefs'

// Chat with an AI agent, run by the desktop app (currently the `claude` CLI) and connected to this
// app's MCP server, so it can change the project while you watch.

type Item = { role: 'user' | 'assistant' | 'tool' | 'error'; text: string; images?: string[]; id?: string; input?: string; result?: string; failed?: boolean }
type Attachment = { blob: Blob; url: string }

const SYSTEM = 'You are the assistant inside Screenshot Studio, a desktop app for App Store screenshots. Use the screenshot-studio tools to look at and change what the user sees: call get_state first, edit with update_project, and check your work with render_slide. To translate, add language codes to the project\'s languages and fill each slide\'s translations; write natural, short store copy rather than word-for-word. Images the user attaches are listed as file paths: look at them with Read, and put them on slides by giving the path as a slide\'s image. You can also find images on the web (WebSearch, WebFetch) and give their URL instead of a path; the app downloads it. The same goes for fonts: add_font takes the path or URL of a font file. Screenshots can differ per language: when the user gives screenshots for a language (say German UI), put them in that slide\'s translations[code].shots.device.image instead of image, which is the primary language\'s and the fallback for every other language. Keep replies short.'

/** `**bold**` and `code` within a line. */
const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((p, i) =>
  p.length > 4 && p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b>
    : p.length > 2 && p.startsWith('`') && p.endsWith('`') ? <code key={i}>{p.slice(1, -1)}</code>
      : p)
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/ // |---|:---:|

/** The agent's text, with Markdown tables drawn as tables. */
function Rich({ text }: { text: string }) {
  const lines = text.split('\n'), out: ReactNode[] = []
  let para: string[] = []
  const flush = () => {
    const t = para.join('\n').replace(/^\n+|\n+$/g, '')
    if (t) out.push(<div key={out.length}>{inline(t)}</div>)
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1] ?? ''
    if (!lines[i].includes('|') || !next.includes('|') || !SEPARATOR.test(next)) {
      para.push(lines[i])
      continue
    }
    flush()
    const head = cells(lines[i])
    const align = cells(next).map((c) => (c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : undefined))
    const rows: string[][] = []
    for (i += 2; i < lines.length && lines[i].includes('|'); i++) rows.push(cells(lines[i]))
    i--
    out.push(
      <div className="md-table" key={out.length}>
        <table>
          <thead><tr>{head.map((h, j) => <th key={j} style={{ textAlign: align[j] }}>{inline(h)}</th>)}</tr></thead>
          <tbody>{rows.map((r, k) => <tr key={k}>{head.map((_, j) => <td key={j} style={{ textAlign: align[j] }}>{inline(r[j] ?? '')}</td>)}</tr>)}</tbody>
        </table>
      </div>,
    )
  }
  flush()
  return out
}

/** What the agent can do here, in the user's words. */
const CAN = [
  ['Build slides', 'Write headlines, pick devices and lay out new slides'],
  ['Restyle', 'Apply a theme, or design and save a new one'],
  ['Translate', 'Add languages and write store copy for each'],
  ['Rearrange', 'Reorder, duplicate or delete slides'],
  ['Use your images', 'Put attached screenshots and SVGs into device frames or on slides'],
  ['Find images on the web', 'Search for icons, logos and pictures, and download them onto slides'],
  ['Check and export', 'Look at each slide as it exports, and write the PNGs'],
]
const EXAMPLES = ['Make three iPhone slides about offline sync', 'Translate everything into German and French', 'Design a dark purple theme and apply it']

/** The interesting bit of a tool call: the command, URL or query, else its input. */
const summary = ({ input }: Approval) => String(input.command ?? input.url ?? input.query ?? input.file_path ?? JSON.stringify(input))

/** Writes attachments into the app data folder, so the agent can read them by path. */
async function saveAttachments(files: Attachment[]) {
  const { BaseDirectory, mkdir, writeFile } = await import('@tauri-apps/plugin-fs')
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const opt = { baseDir: BaseDirectory.AppData }
  await mkdir('attachments', { ...opt, recursive: true })
  return Promise.all(files.map(async ({ blob }) => {
    const name = `attachments/${crypto.randomUUID()}.${extOfType(blob.type)}`
    await writeFile(name, new Uint8Array(await blob.arrayBuffer()), opt)
    return join(await appDataDir(), name)
  }))
}

/** 950, 12.3k, 1.2M */
const tokens = (n: number) => n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1e6).toFixed(1)}M`

export function Chat({ hidden }: { hidden: boolean }) {
  const [items, setItems] = useState<Item[]>([])
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useStored<keyof typeof MODES>('chat-mode', 'manual')
  const [model, setModel] = useStored<string>('chat-model', '')
  const [effort, setEffort] = useStored<string>('chat-effort', '')
  const models = useModels()
  const picked = modelOf(models, model)
  const efforts = picked?.supportedEffortLevels ?? [] // none: the model doesn't take an effort
  const [asks, setAsks] = useState<Approval[]>([])
  const [picker, setPicker] = useState<{ x: number; y: number; view: 'models' | 'more' | 'effort' } | null>(null) // the model menu, above its button
  const [usage, setUsage] = useState({ input: 0, cached: 0, output: 0, cost: 0 }) // this conversation's, summed over its runs
  const session = useRef<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const add = (it: Item) => setItems((all) => [...all, it])

  useEffect(() => {
    list.current?.scrollTo(0, list.current.scrollHeight)
  }, [items, asks])

  useEffect(() => {
    onApproval((a) => setAsks((all) => [...all, a]))
    return () => { onApproval(null) }
  }, [])

  const attach = (list: Iterable<File | Blob>) => {
    const imgs = [...list].filter((f) => f.type.startsWith('image/'))
    setFiles((all) => [...all, ...imgs.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))])
  }

  const decide = (a: Approval, ok: boolean) => {
    a.resolve(ok)
    setAsks((all) => all.filter((x) => x !== a))
    add({ role: 'tool', text: `${ok ? 'Allowed' : 'Denied'} ${a.tool}: ${summary(a)}` })
  }

  // stream-json lines from the running agent
  useEffect(() => {
    // unlisten once listening has started, even if unmounted before that (StrictMode mounts twice): a leaked listener shows every line twice
    const off = import('@tauri-apps/api/event').then(({ listen }) =>
      listen<string>('agent-line', ({ payload }) => {
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
            if (c.type === 'tool_use') add({ role: 'tool', text: c.name.replace(/^mcp__screenshot-studio__/, '').replaceAll('_', ' '), id: c.id, input: JSON.stringify(c.input, null, 2) })
          }
        }
        // a tool's output arrives as the next user turn: attach it to its call
        if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
          for (const c of ev.message.content) {
            if (c.type !== 'tool_result') continue
            const result = typeof c.content === 'string' ? c.content
              : (c.content ?? []).map((p: { type: string; text?: string }) => p.text ?? `[${p.type}]`).join('\n')
            setItems((all) => all.map((it) => (it.id === c.tool_use_id ? { ...it, result, failed: !!c.is_error } : it)))
          }
        }
        if (ev.type === 'result' && ev.usage) setUsage((u) => ({
          input: u.input + (ev.usage.input_tokens ?? 0) + (ev.usage.cache_creation_input_tokens ?? 0),
          cached: u.cached + (ev.usage.cache_read_input_tokens ?? 0),
          output: u.output + (ev.usage.output_tokens ?? 0),
          cost: u.cost + (ev.total_cost_usd ?? 0),
        }))
        if (ev.type === 'result' && ev.is_error) add({ role: 'error', text: ev.result ?? ev.subtype })
      }),
    )
    return () => void off.then((f) => f())
  }, [])

  const send = async (text = input) => {
    const message = text.trim()
    if ((!message && !files.length) || busy) return
    const sent = files
    setInput('')
    setFiles([])
    add({ role: 'user', text: message, images: sent.map((f) => f.url) })
    setBusy(true)
    try {
      const paths = sent.length ? await saveAttachments(sent) : []
      const prompt = [message || 'Here are some images.', ...(paths.length ? ['', 'Attached images:', ...paths] : [])].join('\n')
      const { invoke } = await import('@tauri-apps/api/core')
      // the launch secret lets this chat in even when other sessions are shut out (Settings)
      const token = await invoke<string>('mcp_chat_token')
      const mcp = JSON.stringify({ mcpServers: { 'screenshot-studio': { type: 'http', url: MCP_URL, headers: { Authorization: `Bearer ${token}` } } } })
      const args = [
        '-p', prompt,
        '--output-format', 'stream-json', '--verbose',
        '--mcp-config', mcp,
        '--allowedTools', 'mcp__screenshot-studio', 'Read', 'Glob', 'WebSearch', 'WebFetch',
        '--permission-mode', mode,
        '--permission-prompt-tool', APPROVE_TOOL,
        '--append-system-prompt', SYSTEM,
        ...(model && model !== 'default' ? ['--model', model] : []),
        ...(effort && efforts.includes(effort) ? ['--effort', effort] : []),
        ...(session.current ? ['--resume', session.current] : []),
      ]
      await invoke('agent_chat', { args })
    } catch (e) {
      add({ role: 'error', text: String(e) || 'The agent stopped.' })
    }
    setBusy(false)
  }

  const stop = async () => {
    asks.forEach((a) => a.resolve(false))
    setAsks([])
    await (await import('@tauri-apps/api/core')).invoke('agent_stop')
  }

  // who else can use the app's MCP server: rechecked when the setting changes or the app comes back to the front
  const [mcp, setMcp] = useState<'off' | 'checking' | 'linked' | 'open'>('checking')
  useEffect(() => {
    const check = async () => setMcp(!storedOthers() ? 'off' : (await claudeLinked()) ? 'linked' : 'open')
    check()
    window.addEventListener('mcp-changed', check)
    window.addEventListener('focus', check)
    return () => {
      window.removeEventListener('mcp-changed', check)
      window.removeEventListener('focus', check)
    }
  }, [])

  return (
    <div
      className={`chat ${over ? 'dropping' : ''}`}
      hidden={hidden}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); attach(e.dataTransfer.files) }}
    >
      <header className="chat-head">
        <button className={`chat-status ${mcp === 'linked' ? 'ok' : mcp}`} onClick={() => openSettings('agent')} title={{
          off: 'Only this app\'s agent can use it. Turn on other MCP clients in Settings.',
          checking: 'Checking…',
          linked: 'Claude Code in the terminal can see and change your project. Other clients connect in Settings.',
          open: 'Any MCP client (Claude Code, Codex, Cursor…) can use this app too. Open Settings to connect one.',
        }[mcp]}>
          <i />{{ off: 'Other MCP clients off', checking: 'Checking…', linked: 'Connected to Claude Code', open: 'Connect other MCP clients' }[mcp]}
        </button>
        {!!(usage.input + usage.output) && (
          <span className="chat-usage" title={`Input ${usage.input.toLocaleString()} · cached input ${usage.cached.toLocaleString()} · output ${usage.output.toLocaleString()}${usage.cost ? ` · about $${usage.cost.toFixed(2)}` : ''}`}>
            {tokens(usage.input + usage.cached + usage.output)} tokens
          </span>
        )}
        <button onClick={() => { session.current = null; setItems([]); setUsage({ input: 0, cached: 0, output: 0, cost: 0 }) }} disabled={busy || !items.length} title="Start a new conversation">New chat</button>
      </header>

      <div className="chat-list" ref={list}>
        {items.length === 0 && (
          <div className="chat-empty">
            <h3>What can the agent do?</h3>
            <ul className="can">
              {CAN.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}
            </ul>
            <h3>Try</h3>
            <div className="examples">
              {EXAMPLES.map((x) => <button key={x} onClick={() => send(x)} disabled={busy}>{x}</button>)}
            </div>
          </div>
        )}
        {items.map((it, i) => it.input ? (
          <details key={i} className={`msg tool ${it.failed ? 'failed' : ''}`}>
            <summary title="Show details">{it.text}</summary>
            <pre>{it.input}</pre>
            {it.result !== undefined && <pre>{it.result || '(no output)'}</pre>}
          </details>
        ) : (
          <div key={i} className={`msg ${it.role}`}>
            {!!it.images?.length && <div className="thumbs">{it.images.map((u) => <img key={u} src={u} alt="" />)}</div>}
            {it.role === 'assistant' ? <Rich text={it.text} /> : it.text}
          </div>
        ))}
        {asks.map((a, i) => (
          <div key={i} className="msg ask">
            <b>The agent wants to use {a.tool}</b>
            <code>{summary(a)}</code>
            <div className="row">
              <button onClick={() => decide(a, false)}>Deny</button>
              <button className="primary" onClick={() => decide(a, true)}>Allow</button>
            </div>
          </div>
        ))}
        {busy && <div className="msg typing"><i /><i /><i /></div>}
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send() }}>
        <div className="composer">
          {!!files.length && (
            <div className="thumbs">
              {files.map((f) => (
                <span key={f.url}>
                  <img src={f.url} alt="" />
                  <button type="button" title="Remove" onClick={() => setFiles((all) => all.filter((x) => x !== f))}>×</button>
                </span>
              ))}
            </div>
          )}
          <textarea
            rows={3}
            value={input}
            placeholder="Message the agent… drop or paste images here"
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
              if (imgs.length) { e.preventDefault(); attach(imgs) }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <div className="composer-bar">
            <button type="button" className="icon" title="Attach images" onClick={async () => attach(await openFiles(IMAGE_FILES, true))}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12.5l-8.5 8.5a5 5 0 0 1-7-7L14 5.5a3.3 3.3 0 0 1 4.7 4.7L10.2 18.7a1.7 1.7 0 0 1-2.4-2.4L15.5 8.6" /></svg>
            </button>
            <button type="button" className="model-pick" disabled={busy} title="Model and effort" onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setPicker({ x: r.left, y: r.top, view: 'models' })
            }}>
              {picked?.displayName ?? (model || 'Default model')}{effort && efforts.includes(effort) && <span>{effortName(effort)}</span>}
            </button>
            <select value={mode} onChange={(e) => setMode(e.target.value as keyof typeof MODES)} disabled={busy} title="What the agent may do without asking">
              {Object.entries(MODES).map(([m, label]) => <option key={m} value={m}>{label}</option>)}
            </select>
            <span className="spacer" />
            {busy
              ? <button type="button" onClick={stop}>Stop</button>
              : <button type="submit" className="primary" disabled={!input.trim() && !files.length}>Send</button>}
          </div>
        </div>
      </form>
      {picker && (
        <div className="menu-backdrop" onPointerDown={() => setPicker(null)}>
          <div className="menu model-menu" ref={(el) => {
            if (!el) return
            const r = el.getBoundingClientRect()
            el.style.left = `${Math.max(8, Math.min(picker.x, innerWidth - r.width - 8))}px`
            el.style.top = `${Math.max(8, picker.y - r.height - 6)}px`
          }} onPointerDown={(e) => e.stopPropagation()}>
            {picker.view === 'effort' ? (
              <>
                <button onClick={() => setPicker({ ...picker, view: 'models' })}>‹ Effort</button>
                <hr />
                {['', ...efforts].map((k) => (
                  <button key={k} onClick={() => { setEffort(k); setPicker(null) }}>{effortName(k)}{k === effort && <i>✓</i>}</button>
                ))}
              </>
            ) : (
              <>
                {picker.view === 'more' && <><button onClick={() => setPicker({ ...picker, view: 'models' })}>‹ More models</button><hr /></>}
                {/* Claude Code's aliases (default, opus, …) up front, pinned versions under More models */}
                {models.filter((m) => m.value.startsWith('claude-') === (picker.view === 'more')).map((m) => (
                  <button key={m.value} onClick={() => { setModel(m.value); setPicker(null) }}>
                    <span>{m.displayName}<small>{m.description}</small></span>{m === picked && <i>✓</i>}
                  </button>
                ))}
                {!models.length && <button disabled>Loading models…</button>}
                {picker.view === 'models' && (
                  <>
                    <hr />
                    {!!efforts.length && <button onClick={() => setPicker({ ...picker, view: 'effort' })}>Effort<small>{effortName(effort)} ›</small></button>}
                    {models.some((m) => m.value.startsWith('claude-')) && <button onClick={() => setPicker({ ...picker, view: 'more' })}>More models<small>›</small></button>}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
