import { useEffect, useRef, useState } from 'react'
import { languagesOf, languageName, type Project, type ProjectSummary } from './project'
import { PLATFORMS } from './render'

export interface Import { file: Project; existing?: ProjectSummary; n: number }

const when = (t: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(t)

/** Asks how to open a project file: under which name, and whether it replaces the copy already here (never by default). */
export function ImportDialog({ importing, onOpen }: { importing: Import | null; onOpen: (p: Project) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [replace, setReplace] = useState(false)
  useEffect(() => {
    if (!importing) return
    setName(importing.file.name)
    setReplace(false)
    dialog.current!.showModal()
  }, [importing?.n])
  if (!importing) return <dialog ref={dialog} />

  const { file, existing } = importing
  const slides = file.targets.reduce((n, t) => n + t.slides.length, 0)
  return (
    <dialog ref={dialog} className="lang-dialog import-dialog" onClick={(e) => e.target === dialog.current && dialog.current!.close()}>
      <form onSubmit={(e) => {
        e.preventDefault()
        onOpen({ ...file, id: replace ? file.id : crypto.randomUUID(), name: name.trim() || 'Untitled', updated: Date.now() })
        dialog.current!.close()
      }}>
        <h2>Open project file</h2>
        <label>
          Project name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="hint">
          {file.targets.map((t) => PLATFORMS[t.platform].label).join(' · ')} — {slides} {slides === 1 ? 'slide' : 'slides'}
          {' — '}{languagesOf(file).map(languageName).join(', ')}
          {file.updated ? <><br />Saved {when(file.updated)}</> : null}
        </p>
        {existing && (
          <>
            <p className="import-warning">
              You already have “{existing.name}” from this file, last edited {when(existing.updated)}
              {file.updated && existing.updated > file.updated ? ', which is newer than this file.' : '.'}
            </p>
            <label>
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              Replace it (its changes are lost)
            </label>
          </>
        )}
        <footer>
          <button type="button" onClick={() => dialog.current!.close()}>Cancel</button>
          <button type="submit" className="primary">{replace ? 'Replace' : 'Open as New Project'}</button>
        </footer>
      </form>
    </dialog>
  )
}
