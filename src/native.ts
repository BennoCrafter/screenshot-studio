// The few things that differ between the browser and the Tauri desktop app:
// confirmations, and saving / opening files. Tauri modules load only in the desktop app.

export const isDesktop = '__TAURI_INTERNALS__' in window

type Filter = { name: string; extensions: string[] }

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

/** Pick and read a text file; null if cancelled. */
export async function openTextFile(filter: Filter): Promise<string | null> {
  if (isDesktop) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const path = await open({ filters: [filter] })
    if (!path) return null
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    return readTextFile(path)
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = filter.extensions.map((e) => `.${e}`).join(',')
    input.onchange = () => (input.files?.[0] ? input.files[0].text().then(resolve) : resolve(null))
    input.oncancel = () => resolve(null)
    input.click()
  })
}
