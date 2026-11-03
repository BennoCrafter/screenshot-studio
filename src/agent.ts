// The MCP server's brain. src-tauri forwards each JSON-RPC request from any MCP client
// to here; the tools read and change the live project, so edits show up at once.

import type { Project } from './project'
import { text, TOOLS, type Json } from './tools'

export const MCP_URL = 'http://127.0.0.1:7457/mcp'

/** What the app lets the agent do; App.tsx supplies it. */
export interface Host {
  project: () => Project | null
  setProject: (p: Project) => void
  open: (id: string) => Promise<void>
  close: () => void
}

const INSTRUCTIONS = 'Screenshot Studio makes App Store screenshots: projects hold per-platform (iphone, duo, ipad, mac) sets of slides, each a gradient background, text items (headline, subtitle, …) and a screenshot in a 3D device frame. Call get_state first, change things with update_project, and check results with render_slide. Projects can have several languages: to translate, add codes to languages and write each slide\'s translations[code].items (text by text item id), then check with render_slide\'s language. Texts can use any font: add one to the project with add_font (a path or URL, e.g. from Google Fonts) and set the text item\'s font. Each language can also have its own screenshots (the app\'s UI in that language): set translations[code].shots.device.image (or shots[<device item id>]) to a file path or URL; a language without one shows the primary language\'s, and null goes back to it. Images and devices can carry a shotId; replace_screenshots swaps screenshots everywhere by those IDs.'

async function answer(host: Host, req: { id: unknown; method: string; params?: Json }) {
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: req.id, result })
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: req.id, error: { code, message } })
  switch (req.method) {
    case 'initialize':
      return ok({
        protocolVersion: (req.params?.protocolVersion as string) ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'screenshot-studio', version: '0.1.0' },
        instructions: INSTRUCTIONS,
      })
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: TOOLS.map(({ run: _r, ...t }) => t) })
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === req.params?.name)
      if (!tool) return fail(-32602, `Unknown tool ${req.params?.name}`)
      try {
        return ok({ content: await tool.run(host, (req.params?.arguments as Json) ?? {}) })
      } catch (e) {
        return ok({ content: text(e instanceof Error ? e.message : String(e)), isError: true })
      }
    }
    default:
      return fail(-32601, `Method not found: ${req.method}`)
  }
}

/** Starts answering MCP requests from the Rust side. Desktop only; returns the unsubscribe. */
export async function serveAgent(host: Host) {
  const { listen } = await import('@tauri-apps/api/event')
  const { invoke } = await import('@tauri-apps/api/core')
  return listen<{ id: number; body: string }>('mcp-request', async ({ payload }) => {
    let res
    try {
      res = await answer(host, JSON.parse(payload.body))
    } catch (e) {
      res = { jsonrpc: '2.0', id: null, error: { code: -32700, message: String(e) } }
    }
    await invoke('mcp_respond', { id: payload.id, body: JSON.stringify(res) })
  })
}
