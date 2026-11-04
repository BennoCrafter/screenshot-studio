import { useEffect, useRef, useState } from 'react'
import { serveAgent } from './agent/agent'
import { Editor } from './editor/Editor'
import { ImportDialog, type Import } from './start/ImportDialog'
import { animate } from './lib/motion'
import { isDesktop, tell } from './lib/native'
import { listProjects, openProject, projectFromFile, saveProject, thumbnail, type Project } from './model/project'
import { Settings } from './settings/Settings'
import { StartPage } from './start/StartPage'

const save = (p: Project) =>
  saveProject({ ...p, updated: Date.now(), thumb: thumbnail(document.querySelector('canvas[data-slide]')) })

export default function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [importing, setImporting] = useState<Import | null>(null)
  const latest = useRef(project)
  useEffect(() => {
    latest.current = project
  })

  // reopen the project in the URL hash, so a reload lands back in it
  useEffect(() => {
    const id = location.hash.slice(1)
    if (id) openProject(id).then(setProject, () => (location.hash = ''))
  }, [])

  // ponytail: debounced autosave, an edit in the last 400 ms before a reload is lost
  useEffect(() => {
    if (!project) return
    const t = setTimeout(() => save(project), 400)
    return () => clearTimeout(t)
  }, [project])

  const show = (p: Project | null) => {
    latest.current = p
    animate(() => setProject(p))
    history.replaceState(null, '', p ? `#${p.id}` : location.pathname)
  }

  // the MCP server: an MCP client drives the same state the UI shows
  useEffect(() => {
    if (!isDesktop) return
    const off = serveAgent({
      project: () => latest.current,
      setProject: (p) => (p.id === latest.current?.id ? ((latest.current = p), setProject(p)) : show(p)),
      open: async (id) => show(await openProject(id)),
      close: () => {
        if (latest.current) save(latest.current)
        show(null)
      },
    })
    return () => void off.then((f) => f())
  }, [])

  const importFile = async (text: string) => {
    try {
      const file = await projectFromFile(text)
      const existing = (await listProjects()).find((x) => x.id === file.id)
      setImporting((i) => ({ file, existing, n: (i?.n ?? 0) + 1 }))
    } catch {
      await tell('That file isn\'t a Screenshot Studio project.')
    }
  }

  // .ssproj files opened from Finder / Explorer (double-click, Open With)
  useEffect(() => {
    if (!isDesktop) return
    const take = async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      for (const text of await invoke<string[]>('take_opened_files')) await importFile(text)
    }
    take()
    const off = import('@tauri-apps/api/event').then(({ listen }) => listen('files-opened', take))
    return () => void off.then((f) => f())
  }, [])

  return <>
    <Settings project={project} setProject={(fn) => setProject((p) => p && fn(p))} />
    {!project ? (
    <StartPage onOpen={(id) => openProject(id).then(show)} onCreate={show} onImport={importFile} />
  ) : (
    <Editor
      key={project.id}
      project={project}
      setProject={(fn) => setProject((p) => p && fn(p))}
      onClose={async () => {
        await save(project)
        show(null)
      }}
    />
  )}
    {importing && <ImportDialog
      key={importing.n}
      importing={importing}
      onOpen={async (p) => {
        // the open project first, so replacing that same project isn't undone by its save
        if (latest.current) await save(latest.current)
        await saveProject(p)
        show(p)
      }}
    />}
  </>
}
