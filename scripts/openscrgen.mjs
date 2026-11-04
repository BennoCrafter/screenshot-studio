// Converts an Open Screenshot Generator project into a Screenshot Studio template and project file:
//   pnpm openscrgen <file.json | https://editor.openscrgen.app/?post=… | template file name> [out dir]
// Writes <name>.json (a template; put it in templates/ to ship it) and <name>.ssproj, screenshots and fonts embedded.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'

const SITE = 'https://editor.openscrgen.app'
const [input, out = '.'] = process.argv.slice(2)
if (!input) throw new Error('Usage: pnpm openscrgen <file.json | post link | template name> [out dir]')

const json = async (url) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return r.json()
}

/** The OSG file behind the input, and who made it. */
async function source() {
  const post = input.match(/[?&]post=([a-z0-9]+)/)?.[1]
  if (!post) return { data: input.endsWith('.json') ? JSON.parse(readFileSync(input, 'utf8')) : await template(input) }
  const p = (await json(`https://pb.openscrgen.app/api/openscreengen/discover/posts/${post}`)).post
  // a post is pictures of the screens; only one made from a built-in template points at a project
  if (!p.templateProjectId) throw new Error(`Post ${post} holds only pictures; export the project from Open Screenshot Generator instead`)
  return { data: await template(p.templateProjectId.replace(/^template_/, '')), author: p.author?.name }
}

/** A built-in template from their site; posts name it by file or by its own id, which differ for some. */
async function template(name) {
  const base = name.replace(/\.json$/, ''), dashed = base.replaceAll('_', '-')
  for (const f of new Set([base, dashed, `fg-${dashed}`])) {
    const r = await fetch(`${SITE}/data/projects/${f}.json`)
    if (r.ok) return r.json()
  }
  throw new Error(`No template ${name} on ${SITE}`)
}

// The converter runs in the app; here it gets just enough of a browser to load. Nothing it uses draws.
const any = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 1 : any), apply: () => any, construct: () => any })
globalThis.document = globalThis.window = any
globalThis.FileReader = class {
  readAsDataURL(b) {
    b.arrayBuffer().then((ab) => { this.result = `data:${b.type};base64,${Buffer.from(ab).toString('base64')}`; this.onload() })
  }
}
const vite = await createServer({
  server: { middlewareMode: true }, logLevel: 'error',
  // the built-in templates render their devices in WebGL as they load, which Node has none of
  plugins: [{ name: 'no-webgl', transform: (code, id) => id.endsWith('render3d.ts') ? code.replace('export function renderDevice(',
    'export function renderDevice() { return { width: 1, height: 1, flatHeight: 1, canvas: null } }\nfunction unused(') : undefined }],
})
try {
  const { fromOpenScrGen, asTemplate } = await vite.ssrLoadModule('/src/model/openscrgen.ts')
  const { data, author } = await source()
  const project = await fromOpenScrGen(data)

  // screenshots on their site, embedded so both files work offline
  const embed = async (u) => {
    if (!u?.startsWith('http')) return u
    const r = await fetch(u)
    if (!r.ok) return console.warn(`Left out ${u}: ${r.status}`), null
    return `data:${r.headers.get('content-type')};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`
  }
  for (const s of project.targets.flatMap((t) => t.slides)) {
    s.image = await embed(s.image)
    for (const i of s.items) if (i.image) i.image = await embed(i.image)
  }

  const tpl = asTemplate(project, data.description ?? '', author ?? 'Open Screenshot Generator')
  const id = tpl.id.replace(/^openscrgen-/, '')
  mkdirSync(out, { recursive: true })
  writeFileSync(`${out}/${id}.json`, JSON.stringify(tpl, null, 2) + '\n')
  writeFileSync(`${out}/${id}.ssproj`, JSON.stringify({ format: 'screenshot-studio', version: 1, project }))
  console.log(`${out}/${id}.json and ${out}/${id}.ssproj: ${project.targets.map((t) => `${t.slides.length} ${t.size}`).join(', ')} slides, fonts: ${project.fonts.map((f) => f.name).join(', ') || 'none'}`)
} finally {
  await vite.close()
}
