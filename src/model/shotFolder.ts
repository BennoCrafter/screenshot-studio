// The screenshot folder (desktop): an automation drops <screenshot id>.png into the project's folder, or any folder
// inside it, and the element with that screenshot ID updates.

import { replaceShots } from './elements'
import { loadImage, type Project } from './project'
import { accepts, IMAGE_FILES, typeOfName } from '../lib/native'

const fs = () => import('@tauri-apps/plugin-fs')

type Stat = { size: number; mtime: Date | null; birthtime: Date | null }
/** A file's identity: a copied-over file has a new size or dates even when it keeps the old name. */
const signature = (i: Stat) => `${i.size}:${i.mtime?.getTime()}:${i.birthtime?.getTime()}`

/** The folder's screenshots, searching every folder inside it; of two with one name, the newer. */
async function scanFolder(p: Project) {
  const { readDir, stat } = await fs()
  const { join } = await import('@tauri-apps/api/path')
  const latest = new Map<string, { path: string; id: string; sig: string; abs: string; at: number }>()
  const scan = async (dir: string, rel: string) => {
    for (const e of await readDir(dir)) {
      if (e.name.startsWith('.')) continue
      const abs = await join(dir, e.name), path = rel + e.name
      if (e.isDirectory) await scan(abs, `${path}/`)
      if (!e.isFile || !accepts(IMAGE_FILES, e.name)) continue
      const info = await stat(abs)
      const f = { path, id: e.name.replace(/\.[^.]+$/, ''), sig: signature(info), abs, at: info.mtime?.getTime() ?? 0 }
      if ((latest.get(f.id)?.at ?? -1) < f.at) latest.set(f.id, f)
    }
  }
  await scan(p.shotFolder!, '')
  return [...latest.values()]
}

// syncs run one at a time, the watcher's and update_screenshots' alike, so no file is applied twice at once
let busy: Promise<unknown> = Promise.resolve()
/** What syncs applied that update_screenshots hasn't reported yet, by project id. */
const unreported = new Map<string, string[]>()

/** Applies the folder's screenshots not applied yet (or, given `id`, the one named so) through `update`. Returns every
 *  screenshot ID with a file, where each applied one went (`done`), and the files no element has the ID of. */
export function syncShotFolder(project: () => Project, update: (fn: (p: Project) => Project) => void, id?: string) {
  const run = busy.then(async () => {
    const p = project(), all = await scanFolder(p)
    const files = all.filter((f) => (id ? f.id === id : p.shotSeen?.[f.path] !== f.sig))
    const loaded = (await Promise.all(files.map((f) => fs()
      .then(({ readFile }) => readFile(f.abs))
      .then((b) => loadImage(new Blob([b], { type: typeOfName(f.abs) })))
      .then((img) => ({ ...f, img }), (e) => { console.warn(`screenshot folder: ${f.path} not loaded`, e); return null })))) // half-written: next change retries
      .filter((f) => !!f)
    const apply = (p: Project) => {
      const r = replaceShots(p, new Map(loaded.map((f) => [f.id, f.img])))
      return { project: { ...r.project, shotSeen: { ...p.shotSeen, ...Object.fromEntries(loaded.map((f) => [f.path, f.sig])) } }, done: r.done }
    }
    if (loaded.length) update((p) => apply(p).project)
    const done = loaded.length ? apply(project()).done : [] // the same, for the summary: React may run the update later
    const used = new Set(done.map((d) => d.split(' → ')[0]))
    if (done.length) unreported.set(p.id, [...(unreported.get(p.id) ?? []), ...done].slice(-1000))
    return { ids: new Set(all.map((f) => f.id)), done, unused: loaded.filter((f) => !used.has(f.id)).map((f) => f.path) }
  })
  busy = run.catch(() => {})
  return run
}

/** What syncs applied to project `id` since this was last asked. */
export function takeReport(id: string) {
  const done = unreported.get(id) ?? []
  unreported.delete(id)
  return done
}

/** Applies the folder's new screenshots now and whenever it changes; returns how to stop, and how to fetch one
 *  screenshot ID's file again (when an element gets that ID). `tell` gets a summary, `found` every ID with a file. */
export function watchShotFolder(project: () => Project, update: (fn: (p: Project) => Project) => void, tell: (msg: string) => void,
  found: (ids: Set<string>) => void) {
  const sync = (id?: string) => syncShotFolder(project, update, id).then(({ ids, done, unused }) => {
    found(ids)
    const shots = new Set(done.map((d) => d.split(' → ')[0]))
    if (done.length || unused.length) tell([done.length && `Updated ${done.length} screenshot${done.length === 1 ? '' : 's'} from the screenshot folder: ${[...shots].join(', ')}`,
      unused.length && `No element has the screenshot ID of ${unused.join(', ')}`].filter(Boolean).join('. '))
  }).catch((e) => console.error('screenshot folder sync failed', e))

  sync()
  const off = fs().then(({ watch }) => watch(project().shotFolder!, () => sync(), { recursive: true, delayMs: 700 }))
    .catch((e) => { console.error('screenshot folder not watched', e); return () => {} })
  return { stop: () => void off.then((f) => f()), fetch: (id: string) => void sync(id) }
}
