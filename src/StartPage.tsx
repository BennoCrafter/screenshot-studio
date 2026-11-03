import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ask, openTextFile } from './native'
import { deleteProject, listProjects, PROJECT_FILE, withFonts, type Project, type ProjectSummary } from './project'
import { PLATFORMS, type Platform } from './render'
import { TemplateCard, useCustomTemplates } from './TemplateGallery'
import { ALL_PLATFORMS, BUILT_IN, toTarget, type Template } from './templates'

type Tab = 'all' | Platform

const when = (t: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(t)

/** Welcome window (new project, recent projects) and the new-project template chooser. */
export function StartPage({ onOpen, onCreate, onImport }: { onOpen: (id: string) => void; onCreate: (p: Project) => void; onImport: (text: string) => void }) {
  const chooser = useRef<HTMLDialogElement>(null)
  const [recent, setRecent] = useState<ProjectSummary[] | null>(null)
  useEffect(() => {
    listProjects().then(setRecent, () => setRecent([]))
  }, [])

  return (
    <div className="start" data-tauri-drag-region>
      <section className="welcome" data-tauri-drag-region>
        <img className="app-icon" src="/favicon.svg" width="72" height="72" alt="" />
        <h1>Screenshot Studio</h1>
        <p className="hint">App Store screenshots for iPhone, iPad and Mac</p>
        <button className="start-action" onClick={() => { chooser.current!.showModal(); chooser.current!.focus() }}>
          <strong>Create New Project…</strong>
          <small>Start from a template</small>
        </button>
        <button
          className="start-action"
          onClick={async () => {
            const text = await openTextFile(PROJECT_FILE)
            if (text !== null) onImport(text)
          }}
        >
          <strong>Open Project File…</strong>
          <small>A .ssproj file, or an Open Screenshot Generator project</small>
        </button>
      </section>

      <section className="recents" data-tauri-drag-region>
        <h2>Recent projects</h2>
        {recent?.length === 0 && <p className="hint">No projects yet. Create one to get started.</p>}
        <ul>
          {recent?.map((p, i) => (
            <li key={p.id} style={{ '--i': i } as CSSProperties}>
              <button className="recent" onClick={() => onOpen(p.id)}>
                {p.thumb ? <img src={p.thumb} alt="" /> : <span className="thumb-empty" />}
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.platforms.map((x) => PLATFORMS[x].label).join(' · ')} — {when(p.updated)}</small>
                </span>
              </button>
              <button
                className="tpl-delete"
                title="Delete project"
                onClick={async () => {
                  if (!(await ask(`Delete “${p.name}”? This can't be undone.`))) return
                  await deleteProject(p.id)
                  setRecent((r) => r!.filter((x) => x.id !== p.id))
                }}
              >
                {/* an svg, not "×": the glyph sits off-center in the round button */}
                <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l8 8M9 1l-8 8" /></svg>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <dialog ref={chooser} tabIndex={-1} className="chooser" onClick={(e) => e.target === chooser.current && chooser.current!.close()}>
        <Chooser onCancel={() => chooser.current!.close()} onCreate={onCreate} />
      </dialog>
    </div>
  )
}

function Chooser({ onCancel, onCreate }: { onCancel: () => void; onCreate: (p: Project) => void }) {
  const [custom, store] = useCustomTemplates()
  const [tab, setTab] = useState<Tab>('all')
  const templates = [...BUILT_IN, ...custom].filter((t) => tab === 'all' || t.targets[tab])
  const [picked, setPicked] = useState<Template>(BUILT_IN[1])
  const [name, setName] = useState('My App')
  const available = ALL_PLATFORMS.filter((p) => picked.targets[p])
  const defaults = (t: Template, tb: Tab) => ALL_PLATFORMS.filter((p) => t.targets[p] && (tb === 'all' || tb === p))
  const [chosen, setChosen] = useState<Platform[]>(defaults(picked, tab))

  const pick = (t: Template, tb = tab) => {
    setPicked(t)
    setChosen(defaults(t, tb))
  }
  const create = async () =>
    onCreate(await withFonts({
      id: crypto.randomUUID(),
      name: name.trim() || 'Untitled',
      updated: Date.now(),
      targets: await Promise.all(chosen.map((p) => toTarget(picked.targets[p]!))),
      fonts: picked.fonts,
    }))

  return (
    <>
      <h2>Choose a template for your new project</h2>
      <nav className="platform-tabs big">
        {(['all', ...ALL_PLATFORMS] as Tab[]).map((t) => (
          <span key={t} className={tab === t ? 'on' : ''}>
            <button
              onClick={() => {
                setTab(t)
                const first = [...BUILT_IN, ...custom].find((x) => x.id === picked.id && (t === 'all' || x.targets[t]))
                  ?? [...BUILT_IN, ...custom].find((x) => t === 'all' || x.targets[t])!
                pick(first, t)
              }}
            >
              {t === 'all' ? 'Multiplatform' : PLATFORMS[t].label}
            </button>
          </span>
        ))}
      </nav>

      <div className="tpl-grid chooser-grid">
        {templates.map((t) => (
          <TemplateCard
            key={t.id}
            t={t}
            platform={tab === 'all' ? undefined : tab}
            selected={t.id === picked.id}
            onPick={() => pick(t)}
            onDelete={t.custom ? () => store(custom.filter((c) => c.id !== t.id)) : undefined}
          />
        ))}
      </div>
      <p className="hint">{picked.description}</p>

      <form
        className="chooser-footer"
        onSubmit={(e) => {
          e.preventDefault()
          if (chosen.length) create()
        }}
      >
        <label>
          Project name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <fieldset>
          <legend>Platforms</legend>
          {ALL_PLATFORMS.map((p) => (
            <label key={p}>
              <input
                type="checkbox"
                disabled={!available.includes(p)}
                checked={chosen.includes(p)}
                onChange={(e) => setChosen((c) => (e.target.checked ? ALL_PLATFORMS.filter((x) => x === p || c.includes(x)) : c.filter((x) => x !== p)))}
              />
              {PLATFORMS[p].label}
            </label>
          ))}
        </fieldset>
        <span className="spacer" />
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={!chosen.length}>Create</button>
      </form>
    </>
  )
}
