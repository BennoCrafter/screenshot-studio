import { useEffect, useState } from 'react'
import { Editor } from './Editor'
import { openProject, saveProject, thumbnail, type Project } from './project'
import { StartPage } from './StartPage'

const save = (p: Project) =>
  saveProject({ ...p, updated: Date.now(), thumb: thumbnail(document.querySelector('canvas[data-slide]')) })

export default function App() {
  const [project, setProject] = useState<Project | null>(null)

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
    setProject(p)
    history.replaceState(null, '', p ? `#${p.id}` : location.pathname)
  }

  if (!project) return <StartPage onOpen={(id) => openProject(id).then(show)} onCreate={show} />
  return (
    <Editor
      key={project.id}
      project={project}
      setProject={(fn) => setProject((p) => p && fn(p))}
      onClose={async () => {
        await save(project)
        show(null)
      }}
    />
  )
}
