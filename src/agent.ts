// The MCP server's brain. src-tauri forwards each JSON-RPC request from Claude Code (or any
// MCP client) to here; the tools read and change the live project, so edits show up at once.

import { DEVICES, DEVICE_BY_ID } from './devices/models'
import { deleteProject, LANGUAGES, languagesOf, listProjects, loadImage, typeOfName, type Project } from './project'
import { localize, PLATFORMS, renderSlide, SIZES, THEMES, type Item, type Style, type Platform, type Slide, type Target } from './render'
import type { DevicePose } from './devices/render3d'
import { ALL_PLATFORMS, BLANK, BUILT_IN, loadCustom, loadThemes, poseFor, saveTheme, toTarget } from './templates'

export const MCP_URL = 'http://127.0.0.1:7457/mcp'

/** What the app lets the agent do; App.tsx supplies it. */
export interface Host {
  project: () => Project | null
  setProject: (p: Project) => void
  open: (id: string) => Promise<void>
  close: () => void
}

type Json = Record<string, unknown>

/** A tool call Claude wants to make that needs the user's OK; the chat shows it and resolves it. */
export interface Approval { tool: string; input: Json; resolve: (ok: boolean) => void }
let askUser: ((a: Approval) => void) | null = null
export const onApproval = (fn: typeof askUser) => (askUser = fn)
export const APPROVE_TOOL = 'mcp__screenshot-studio__approve'

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

const text = (v: unknown): Content[] => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }]

function current(host: Host) {
  const p = host.project()
  if (!p) throw new Error('No project is open. Use open_project or create_project first.')
  return p
}

function targetOf(p: Project, platform?: string) {
  const t = platform ? p.targets.find((t) => t.platform === platform) : p.targets[0]
  if (!t) throw new Error(`The project has no ${platform} slides. It has: ${p.targets.map((t) => t.platform).join(', ')}`)
  return t
}

/** The project as JSON, screenshots as true/false. */
const describe = (p: Project) => ({
  id: p.id,
  name: p.name,
  languages: languagesOf(p),
  targets: p.targets.map((t) => ({
    ...t,
    slides: t.slides.map((s) => ({
      ...s, image: !!s.image, outerImage: !!s.outerImage,
      items: s.items?.map((i) => (i.kind === 'image' || i.kind === 'device' ? { ...i, image: !!i.image, outerImage: !!i.outerImage } : i)),
    })),
  })),
})

async function reference() {
  return {
    platforms: Object.fromEntries(ALL_PLATFORMS.map((p) => [p, { sizes: Object.fromEntries(PLATFORMS[p].sizes.map((n) => [n, SIZES[n]])) }])),
    devices: DEVICES.map((d) => ({
      id: d.id, label: d.label, family: d.family, finishes: d.finishes.map((f) => f.id),
      ...(d.fold && { foldable: true }), ...(d.laptop && { laptop: true }), ...(d.outer && { outerScreen: true }),
    })),
    themes: await loadThemes(),
    languages: LANGUAGES,
    templates: [...BUILT_IN, ...(await loadCustom())].map((t) => ({ id: t.id, name: t.name, description: t.description, platforms: Object.keys(t.targets) })),
  }
}

/** An image from a local path or a web URL (fetched natively, so other sites' CORS rules don't apply). */
async function imageFrom(path: string) {
  if (/^https?:\/\//.test(path)) {
    const { fetch } = await import('@tauri-apps/plugin-http')
    const res = await fetch(path)
    if (!res.ok) throw new Error(`Couldn't download ${path}: HTTP ${res.status}`)
    return loadImage(await res.blob()).catch(() => { throw new Error(`${path} isn't an image`) })
  }
  const { readFile } = await import('@tauri-apps/plugin-fs')
  return loadImage(new Blob([await readFile(path)], { type: typeOfName(path) }))
}

/** Rebuilds the project from the agent's JSON, filling in defaults and loading screenshots from paths. */
async function fromAgent(prev: Project, input: Json): Promise<Project> {
  const old = new Map(prev.targets.flatMap((t) => t.slides).map((s) => [s.id, s]))
  const targets = input.targets as Json[] | undefined
  if (!Array.isArray(targets) || !targets.length) throw new Error('targets must be a non-empty array')
  const image = async (v: unknown, kept: HTMLImageElement | null | undefined) =>
    typeof v === 'string' ? imageFrom(v) : v === false || v === null ? null : kept ?? null
  const languages = input.languages ?? languagesOf(prev)
  if (!Array.isArray(languages) || !languages.length || languages.some((l) => typeof l !== 'string' || !l.trim()))
    throw new Error('languages must be a non-empty array of language codes, such as the App Store ones in get_state')
  return {
    ...prev,
    name: typeof input.name === 'string' ? input.name : prev.name,
    languages,
    targets: await Promise.all(targets.map(async (t): Promise<Target> => {
      const platform = t.platform as Platform
      if (!PLATFORMS[platform]) throw new Error(`Unknown platform ${platform}`)
      const size = (t.size ?? PLATFORMS[platform].sizes[0]) as Target['size']
      if (!PLATFORMS[platform].sizes.includes(size)) throw new Error(`${size} is not a ${platform} size`)
      const slides = t.slides as Json[]
      if (!Array.isArray(slides) || !slides.length) throw new Error(`${platform}: slides must be a non-empty array`)
      return {
        platform,
        size,
        slides: await Promise.all(slides.map(async (s): Promise<Slide> => {
          const was = old.get(s.id as string)
          const device = poseFor(platform, { ...was?.device, ...(s.device as Json) })
          const model = DEVICE_BY_ID[device.model]
          if (!model) throw new Error(`Unknown device ${device.model}`)
          if (!model.finishes.some((f) => f.id === device.finish)) device.finish = model.finishes[0].id
          return {
            ...THEMES.Paper, title: '', subtitle: '', ...was, ...(s as Partial<Slide>),
            id: was?.id ?? crypto.randomUUID(),
            device,
            image: await image(s.image, was?.image),
            outerImage: await image(s.outerImage, was?.outerImage),
            items: Array.isArray(s.items) ? await Promise.all((s.items as Json[]).map(async (i) => ({
              ...(i as unknown as Item),
              id: typeof i.id === 'string' ? i.id : crypto.randomUUID(),
              image: i.kind === 'image' || i.kind === 'device' ? await image(i.image, was?.items?.find((w) => w.id === i.id)?.image) : undefined,
              outerImage: i.kind === 'device' ? await image(i.outerImage, was?.items?.find((w) => w.id === i.id)?.outerImage) : undefined,
              device: i.kind === 'device' ? poseFor(platform, i.device as Partial<DevicePose>) : undefined,
            }))) : was?.items,
          }
        })),
      }
    })),
  }
}

function applyTheme(host: Host, { bg1, bg2, angle, textColor, layout }: Style, platform?: string) {
  const p = current(host)
  if (platform) targetOf(p, platform)
  host.setProject({
    ...p,
    targets: p.targets.map((t) => (platform && t.platform !== platform ? t : { ...t, slides: t.slides.map((s) => ({ ...s, bg1, bg2, angle, textColor, layout })) })),
  })
}

const base64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const languageArg = { type: 'string', description: 'Language code from the project; defaults to its primary (first) language.' }
const platformArg = { type: 'string', enum: ALL_PLATFORMS, description: 'Defaults to the first platform in the project.' }

const TOOLS: { name: string; description: string; inputSchema: Json; run: (host: Host, a: Json) => Promise<Content[]> }[] = [
  {
    name: 'get_state',
    description: 'The open project (or null), recent projects, and the reference data: platforms and their pixel sizes, device models and finishes, colour themes and templates. Call this first. Screenshots show as true/false.',
    inputSchema: { type: 'object', properties: {} },
    run: async (host) => text({
      openProject: host.project() && describe(host.project()!),
      recentProjects: (await listProjects()).map(({ thumb: _t, ...p }) => p),
      reference: await reference(),
    }),
  },
  {
    name: 'update_project',
    description: `Replace the open project's name and targets with the given JSON, in the shape get_state returns. The app updates live and autosaves.
languages: App Store language codes; the first is the primary. Each target: { platform, size, slides }. Each slide: { id?, title, subtitle, bg1, bg2 (hex), angle (gradient degrees), textColor, layout: "text-top" | "text-bottom", titleBox?, subtitleBox? ({ x, y: offset from the layout spot as a fraction of slide width/height, scale: 1 = default size, rotation?: degrees clockwise }), layers? (what's on the slide, back to front: "title", "subtitle", "device" and item ids; leaving one out deletes it), items? (added objects: { id?, kind: "text" | "rect" | "ellipse" | "image" | "device", x, y: centre as fractions of slide width/height, w, h: fractions of slide width, size?: text font size as a fraction of slide width, text?, rotation?: degrees clockwise (not devices), color?, image?, device? (a device pose like the slide's; its size is a fraction of slide width), outerImage? }; to show one it must also be in layers by id; translations[lang].items maps item ids to translated text), device, image?, outerImage? }.
device: { model, finish, size (device width / slide width, ~0.3-1.2), yaw, pitch, roll (degrees), fold (degrees; 180 flat, 0 closed; foldables and Mac lid), x, y (offset as fraction of slide width/height) }. Omitted fields keep their value for an existing slide id, or get defaults.
Slide title/subtitle are the primary language's text; translations: { "<code>": { title, subtitle } } holds the other languages'. Everything except text is shared by all languages.
image / outerImage: true keeps the current screenshot, false removes it, a string is an absolute path or an http(s) URL of a PNG, JPEG, WebP or SVG to load. Slide order is array order; omit a slide to delete it, omit id to add one.`,
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, languages: { type: 'array', items: { type: 'string' } }, targets: { type: 'array', items: { type: 'object' } } },
      required: ['targets'],
    },
    run: async (host, a) => {
      const p = await fromAgent(current(host), a)
      host.setProject(p)
      return text(describe(p))
    },
  },
  {
    name: 'render_slide',
    description: 'Look at a slide exactly as it exports, as a downscaled PNG. Use it to check your work.',
    inputSchema: { type: 'object', properties: { platform: platformArg, language: languageArg, index: { type: 'integer', description: '0-based slide index' } }, required: ['index'] },
    run: async (host, a) => {
      const t = targetOf(current(host), a.platform as string)
      const s = t.slides[a.index as number]
      if (!s) throw new Error(`No slide ${a.index}; there are ${t.slides.length}`)
      const [w, h] = SIZES[t.size]
      return [{ type: 'image', data: await base64(await renderSlide(localize(s, a.language as string), SIZES[t.size], Math.min(1, 1000 / Math.max(w, h)))), mimeType: 'image/png' }]
    },
  },
  {
    name: 'move_slide',
    description: 'Move a slide to another position on one platform. Indexes are 0-based.',
    inputSchema: { type: 'object', properties: { platform: platformArg, from: { type: 'integer' }, to: { type: 'integer' } }, required: ['from', 'to'] },
    run: async (host, a) => {
      const p = current(host)
      const t = targetOf(p, a.platform as string)
      const [from, to] = [a.from as number, a.to as number]
      if (!t.slides[from] || to < 0 || to >= t.slides.length) throw new Error(`Indexes must be 0 to ${t.slides.length - 1}`)
      const slides = [...t.slides]
      slides.splice(to, 0, ...slides.splice(from, 1))
      const next = { ...p, targets: p.targets.map((x) => (x === t ? { ...t, slides } : x)) }
      host.setProject(next)
      return text(slides.map((s, i) => `${i}: ${s.title}`).join('\n'))
    },
  },
  {
    name: 'delete_slide',
    description: 'Delete a slide from one platform by its 0-based index. A platform keeps at least one slide.',
    inputSchema: { type: 'object', properties: { platform: platformArg, index: { type: 'integer' } }, required: ['index'] },
    run: async (host, a) => {
      const p = current(host)
      const t = targetOf(p, a.platform as string)
      if (!t.slides[a.index as number]) throw new Error(`No slide ${a.index}; there are ${t.slides.length}`)
      if (t.slides.length === 1) throw new Error('This is the only slide; a platform needs at least one.')
      const slides = t.slides.filter((_, i) => i !== a.index)
      host.setProject({ ...p, targets: p.targets.map((x) => (x === t ? { ...t, slides } : x)) })
      return text(slides.map((s, i) => `${i}: ${s.title}`).join('\n'))
    },
  },
  {
    name: 'save_theme',
    description: 'Save a colour theme of your own; it shows in the app\'s Themes dialog and can be applied with apply_theme. Saving under an existing name of your own replaces it.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        bg1: { type: 'string', description: 'Gradient start, hex' },
        bg2: { type: 'string', description: 'Gradient end, hex' },
        angle: { type: 'number', description: 'Gradient direction in degrees; 180 is top to bottom' },
        textColor: { type: 'string', description: 'Hex' },
        layout: { type: 'string', enum: ['text-top', 'text-bottom'] },
        apply: { type: 'boolean', description: 'Also apply it to every slide of the open project. Default false.' },
      },
      required: ['name', 'bg1', 'bg2', 'textColor'],
    },
    run: async (host, a) => {
      const hex = /^#[0-9a-f]{6}$/i
      for (const k of ['bg1', 'bg2', 'textColor']) if (!hex.test(a[k] as string)) throw new Error(`${k} must be a hex colour like #1e3a8a`)
      const t = { name: String(a.name).trim(), bg1: a.bg1 as string, bg2: a.bg2 as string, angle: (a.angle as number) ?? 180, textColor: a.textColor as string, layout: (a.layout ?? 'text-top') as Style['layout'] }
      if (!t.name) throw new Error('name is empty')
      await saveTheme(t)
      if (a.apply) applyTheme(host, t)
      return text(`Saved ${t.name}${a.apply ? ' and applied it' : ''}.`)
    },
  },
  {
    name: 'apply_theme',
    description: 'Apply a theme (built-in or saved, by name from get_state) to every slide of the open project, or of one platform. Changes only colours and text position.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, platform: { ...platformArg, description: 'Omit for all platforms.' } }, required: ['name'] },
    run: async (host, a) => {
      const t = (await loadThemes()).find((t) => t.name.toLowerCase() === String(a.name).toLowerCase())
      if (!t) throw new Error(`No theme ${a.name}. There are: ${(await loadThemes()).map((t) => t.name).join(', ')}`)
      applyTheme(host, t, a.platform as string | undefined)
      return text(`Applied ${t.name}.`)
    },
  },
  {
    name: 'export_pngs',
    description: 'Write every slide in every language at full App Store resolution as PNG files into a folder (created if missing). Returns the file paths.',
    inputSchema: { type: 'object', properties: { dir: { type: 'string', description: 'Absolute folder path' }, platform: { ...platformArg, description: 'Omit to export all platforms.' } }, required: ['dir'] },
    run: async (host, a) => {
      const p = current(host)
      const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs')
      const dir = (a.dir as string).replace(/\/$/, '')
      await mkdir(dir, { recursive: true })
      const written: string[] = []
      for (const t of a.platform ? [targetOf(p, a.platform as string)] : p.targets) {
        const [w, h] = SIZES[t.size]
        for (const l of languagesOf(p)) {
          for (const [i, s] of t.slides.entries()) {
            const path = `${dir}/${p.name}-${t.platform}-${l}-${i + 1}-${w}x${h}.png`
            await writeFile(path, new Uint8Array(await (await renderSlide(localize(s, l), SIZES[t.size])).arrayBuffer()))
            written.push(path)
          }
        }
      }
      return text(written)
    },
  },
  {
    name: 'create_project',
    description: 'Create a project from a template and open it, replacing whatever is open (that one stays saved).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        template: { type: 'string', description: 'Template id from get_state; default "blank".' },
        platforms: { type: 'array', items: { type: 'string', enum: ALL_PLATFORMS }, description: "Default: all the template supports." },
      },
      required: ['name'],
    },
    run: async (host, a) => {
      const tpl = [...BUILT_IN, ...(await loadCustom())].find((t) => t.id === (a.template ?? 'blank')) ?? BLANK
      const platforms = ((a.platforms as Platform[] | undefined) ?? ALL_PLATFORMS).filter((p) => tpl.targets[p])
      if (!platforms.length) throw new Error(`Template ${tpl.id} supports only ${Object.keys(tpl.targets).join(', ')}`)
      const p: Project = { id: crypto.randomUUID(), name: a.name as string, updated: Date.now(), targets: await Promise.all(platforms.map((pl) => toTarget(tpl.targets[pl]!))) }
      host.setProject(p)
      return text(describe(p))
    },
  },
  {
    name: 'open_project',
    description: 'Open a saved project by id (see recentProjects in get_state).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: async (host, a) => {
      await host.open(a.id as string)
      return text(describe(current(host)))
    },
  },
  {
    name: 'close_project',
    description: 'Close the open project and go back to the start page. It stays saved.',
    inputSchema: { type: 'object', properties: {} },
    run: async (host) => {
      host.close()
      return text('Closed.')
    },
  },
  {
    // Claude Code calls this itself (--permission-prompt-tool) before a tool that needs permission.
    name: 'approve',
    description: 'Internal: the app uses this to ask the user for permission. Never call it yourself.',
    inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] },
    run: async (_host, a) => {
      const input = (a.input as Json) ?? {}
      const ok = askUser ? await new Promise<boolean>((resolve) => askUser!({ tool: a.tool_name as string, input, resolve })) : false
      return text(ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user declined this.' })
    },
  },
  {
    name: 'delete_project',
    description: 'Delete a saved project for good. Ask the user first.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: async (host, a) => {
      if (host.project()?.id === a.id) host.close()
      await deleteProject(a.id as string)
      return text('Deleted.')
    },
  },
]

const INSTRUCTIONS = 'Screenshot Studio makes App Store screenshots: projects hold per-platform (iphone, duo, ipad, mac) sets of slides, each a gradient background, headline, subtitle and a screenshot in a 3D device frame. Call get_state first, change things with update_project, and check results with render_slide. Projects can have several languages: to translate, add codes to languages and write each slide\'s translations[code] (title, subtitle, items), then check with render_slide\'s language.'

async function answer(host: Host, req: { id: unknown; method: string; params?: Json }) {
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: req.id, result })
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
      if (!tool) return { jsonrpc: '2.0', id: req.id, error: { code: -32602, message: `Unknown tool ${req.params?.name}` } }
      try {
        return ok({ content: await tool.run(host, (req.params?.arguments as Json) ?? {}) })
      } catch (e) {
        return ok({ content: text(e instanceof Error ? e.message : String(e)), isError: true })
      }
    }
    default:
      return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } }
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
