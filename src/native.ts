// The few things that differ between the browser and the Tauri desktop app:
// confirmations, and saving / opening files. Tauri modules load only in the desktop app.

export const isDesktop = '__TAURI_INTERNALS__' in window

/** Opens a link in the browser (the desktop webview would otherwise navigate itself away). */
export const openLink = async (url: string) => {
  if (!isDesktop) return void window.open(url, '_blank', 'noopener')
  await (await import('@tauri-apps/api/core')).invoke('open_url', { url })
}

export type Filter = { name: string; extensions: string[] }

/** The files each picker offers (and drops accept). */
export const IMAGE_FILES: Filter = { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }
export const FONT_FILES: Filter = { name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }
export const accepts = (filter: Filter, name: string) => filter.extensions.includes(name.split('.').pop()!.toLowerCase())

/** A file's type from its name: images and fonts. */
export const typeOfName = (name: string) => {
  const e = name.split('.').pop()!.toLowerCase()
  if (FONT_FILES.extensions.includes(e)) return `font/${e}`
  return `image/${{ jpg: 'jpeg', svg: 'svg+xml' }[e] ?? e}`
}

export async function ask(message: string) {
  if (!isDesktop) return confirm(message)
  const { ask } = await import('@tauri-apps/plugin-dialog')
  return ask(message, { title: 'Screenshot Studio', kind: 'warning' })
}

export async function tell(message: string) {
  if (!isDesktop) return alert(message)
  const { message: show } = await import('@tauri-apps/plugin-dialog')
  await show(message, { title: 'Screenshot Studio', kind: 'error' })
}

function download(name: string, blob: Blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

/** Several files at once: the desktop app asks for a folder (names may hold subfolders, `de/iPhone/x.png`), the browser
 *  downloads each. Returns false if cancelled. */
export async function saveFiles(files: { name: string; blob: Blob }[]) {
  if (!isDesktop) {
    files.forEach((f) => download(f.name, f.blob))
    return true
  }
  const { open } = await import('@tauri-apps/plugin-dialog')
  const dir = await open({ directory: true, title: 'Export screenshots to…' })
  if (!dir) return false
  const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs')
  const { dirname, join } = await import('@tauri-apps/api/path')
  for (const f of files) {
    const path = await join(dir, ...f.name.split('/'))
    if (f.name.includes('/')) await mkdir(await dirname(path), { recursive: true })
    await writeFile(path, await bytes(f.blob))
  }
  return true
}

/** One file: a Save dialog on the desktop, a download in the browser. Returns false if cancelled. */
export async function saveFile(name: string, blob: Blob, filter: Filter) {
  if (!isDesktop) {
    download(name, blob)
    return true
  }
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: name, filters: [filter] })
  if (!path) return false
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  await writeFile(path, await bytes(blob))
  return true
}

/** Pick files of `filter`'s types; none if cancelled. The desktop app uses its own Open dialog, which lists only those
 *  (the webview's file input doesn't filter reliably). */
export async function openFiles(filter: Filter, multiple = false): Promise<File[]> {
  if (isDesktop) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ filters: [filter], multiple })
    const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked]
    const { readFile } = await import('@tauri-apps/plugin-fs')
    return Promise.all(paths.map(async (p) => new File([await readFile(p)], p.split(/[\\/]/).pop()!, { type: typeOfName(p) })))
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    input.accept = filter.extensions.map((e) => `.${e}`).join(',')
    input.onchange = () => resolve([...(input.files ?? [])].filter((f) => accepts(filter, f.name)))
    input.oncancel = () => resolve([])
    input.click()
  })
}

/** Pick and read a text file; null if cancelled. */
export const openTextFile = async (filter: Filter) => (await openFiles(filter))[0]?.text() ?? null
