import { useEffect, useRef, useState } from 'react'
import { serveAgent } from './agent'
import { Editor } from './Editor'
import { animate } from './motion'
import { isDesktop, tell } from './native'
import { openProject, projectFromFile, saveProject, thumbnail, type Project } from './project'
import { Settings } from './Settings'
import { StartPage } from './StartPage'

const save = (p: Project) =>
  saveProject({ ...p, updated: Date.now(), thumb: thumbnail(document.querySelector('canvas[data-slide]')) })

export default function App() {
  const [project, setProject] = useState<Project | null>(null)
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

  // .ssproj files opened from Finder / Explorer (double-click, Open With)
  useEffect(() => {
    if (!isDesktop) return
    const take = async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      for (const text of await invoke<string[]>('take_opened_files')) {
        try {
          const p = await projectFromFile(text)
          await saveProject(p)
          if (latest.current) await save(latest.current)
          show(p)
        } catch {
          await tell('That file isn\'t a Screenshot Studio project.')
        }
      }
    }
    take()
    const off = import('@tauri-apps/api/event').then(({ listen }) => listen('files-opened', take))
    return () => void off.then((f) => f())
  }, [])

  return <>
    <Settings project={project} setProject={(fn) => setProject((p) => p && fn(p))} />
    {!project ? (
    <StartPage onOpen={(id) => openProject(id).then(show)} onCreate={show} />
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
  </>
}
