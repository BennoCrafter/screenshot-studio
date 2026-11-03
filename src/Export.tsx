import { useEffect, useRef, useState } from 'react'
import { ask, isDesktop, saveFile, saveFiles } from './native'
import { languageName, languagesOf, PROJECT_FILE, projectToFile, type Project } from './project'
import { labelOf } from './elements'
import { localize, PLATFORMS, renderSlide, SIZES } from './render'
import { openLink } from './Settings'
import { useStored } from './prefs'
import { loadCustom, saveCustom, shareTemplate, toData, type Template } from './templates'

const THUMB_W = 132

/** How exported PNGs are sorted into subfolders. */
const FOLDERS = { none: 'All in one folder', 'lang-device': 'Language › Device', 'device-lang': 'Device › Language' }
type Folders = keyof typeof FOLDERS

/** The Export button and its dialog: PNGs of the picked slides, platforms and languages, the project as a template, or as a .ssproj file. */
export function Export({ project }: { project: Project }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [thumbs, setThumbs] = useState<Record<string, string>>({}) // slide id → small preview
  const [kind, setKind] = useStored<'png' | 'template' | 'file'>('export-kind', 'png')
  const [skip, setSkip] = useState(new Set<string>()) // slide ids and language codes left out
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [withShots, setWithShots] = useStored<'on' | 'off'>('export-shots', 'on')
  const shots = withShots === 'on'
  const [share, setShare] = useState(false) // opt in, and confirmed again before anything leaves the machine
  const [done, setDone] = useState<string | null>(null)
  const [folders, pickFolders] = useStored<Folders>('export-folders', 'none')
  const [progress, setProgress] = useState<{ n: number; of: number; what: string } | null>(null) // PNG export under way

  const langs = languagesOf(project)
  const picked = langs.filter((l) => !skip.has(l))
  const chosen = project.targets.map((t) => ({ t, slides: t.slides.filter((s) => !skip.has(s.id)) }))
  const slideCount = chosen.reduce((n, c) => n + c.slides.length, 0)
  const count = slideCount * picked.length
  /** Leaves out `keys` if all are in, else puts them all in. */
  const toggle = (...keys: string[]) => setSkip((s) => {
    const next = new Set(s)
    const allIn = keys.every((k) => !s.has(k))
    for (const k of keys) if (allIn) next.add(k); else next.delete(k)
    return next
  })

  // previews in the primary language, made while the dialog is open
  useEffect(() => {
    if (!open) return
    let live = true
    const urls: string[] = []
    ;(async () => {
      for (const t of project.targets) for (const s of t.slides) {
        const [w, h] = SIZES[t.size]
        const url = URL.createObjectURL(await renderSlide(localize(s, langs[0]), [w, h], (THUMB_W * 2) / w))
        if (!live) return URL.revokeObjectURL(url)
        urls.push(url)
        setThumbs((all) => ({ ...all, [s.id]: url }))
      }
    })()
    return () => {
      live = false
      urls.forEach(URL.revokeObjectURL)
      setThumbs({})
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const exportPngs = async () => {
    setBusy(true)
    try {
      const files = []
      for (const { t, slides } of chosen) {
        const [w, h] = SIZES[t.size]
        for (const l of picked) for (const s of slides) {
          const n = t.slides.indexOf(s) + 1
          setProgress({ n: files.length, of: count, what: `${PLATFORMS[t.platform].label} · ${languageName(l)} · slide ${n}` })
          await new Promise(requestAnimationFrame) // let the bar paint before the next slide renders
          const sub = { none: '', 'lang-device': `${l}/${PLATFORMS[t.platform].label}/`, 'device-lang': `${PLATFORMS[t.platform].label}/${l}/` }[folders]
          files.push({ name: `${sub}${project.name.replace(/[/\\]/g, '-')}-${t.platform}-${l}-${n}-${w}x${h}.png`, blob: await renderSlide(localize(s, l), [w, h]) })
        }
      }
      setProgress({ n: count, of: count, what: isDesktop ? 'Pick a folder to save them in' : 'Downloading' })
      if (await saveFiles(files)) dialog.current!.close()
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const saveTemplate = async () => {
    setBusy(true)
    setDone(null)
    const t: Template = {
      id: crypto.randomUUID(),
      name: name.trim(),
      description: description.trim() || 'Saved from a project.',
      targets: Object.fromEntries(await Promise.all(project.targets.map(async (t) =>
        [t.platform, { platform: t.platform, size: t.size, slides: await Promise.all(t.slides.map((s) => toData(s, shots))) }]))),
    }
    await saveCustom([...(await loadCustom()), { ...t, custom: true }])
    if (!share) setDone('Saved to your templates.')
    else if (!(await ask(`Share "${t.name}" publicly?\n\nThis forks Screenshot Studio on GitHub with your account if needed and opens a public pull request with the template${shots ? ', screenshots included' : ''}. Nothing is sent if you cancel.`))) {
      setDone('Saved to your templates. Not shared.')
    } else {
      setDone('Saved. Opening a pull request…')
      try {
        setDone(await shareTemplate(t))
      } catch (e) {
        setDone(`Saved to your templates, but sharing failed: ${e}`)
      }
    }
    setBusy(false)
  }

  return (
    <>
      <button className="primary" onClick={() => { setDone(null); setName((n) => n || project.name); setOpen(true); dialog.current!.showModal() }}>Export</button>
      <dialog ref={dialog} className="tpl-dialog export" onClose={() => setOpen(false)} onClick={(e) => e.target === dialog.current && dialog.current!.close()}>
        <header>
          <h2>Export</h2>
          <button onClick={() => dialog.current!.close()}>Close</button>
        </header>
        <nav className="platform-tabs">
          <span className={kind === 'png' ? 'on' : ''}><button onClick={() => setKind('png')}>PNG images</button></span>
          <span className={kind === 'template' ? 'on' : ''}><button onClick={() => setKind('template')}>Template</button></span>
          <span className={kind === 'file' ? 'on' : ''}><button onClick={() => setKind('file')}>Project file</button></span>
        </nav>

        {kind === 'png' ? (
          <>
            {chosen.map(({ t, slides }) => {
              const [w, h] = SIZES[t.size]
              const ids = t.slides.map((s) => s.id)
              return (
                <section key={t.platform} className="ex-platform">
                  <header>
                    <strong>{PLATFORMS[t.platform].label}</strong>
                    <span>{w}×{h}</span>
                    <button className="link" onClick={() => toggle(...ids)}>{slides.length === ids.length ? 'Select none' : 'Select all'}</button>
                  </header>
                  <div className="ex-slides">
                    {t.slides.map((s, i) => (
                      <button
                        key={s.id}
                        className={skip.has(s.id) ? 'ex-slide off' : 'ex-slide'}
                        style={{ width: w > h ? THUMB_W * 1.6 : THUMB_W, aspectRatio: `${w} / ${h}` }}
                        aria-pressed={!skip.has(s.id)}
                        title={labelOf(s) || `Slide ${i + 1}`}
                        onClick={() => toggle(s.id)}
                      >
                        {thumbs[s.id] && <img src={thumbs[s.id]} alt="" />}
                        <i>{i + 1}</i>
                        <b aria-hidden>✓</b>
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
            {langs.length > 1 && (
              <section className="ex-platform">
                <header><strong>Languages</strong></header>
                <div className="ex-chips">
                  {langs.map((l) => (
                    <button key={l} className={skip.has(l) ? 'chip' : 'chip on'} aria-pressed={!skip.has(l)} onClick={() => toggle(l)}>{languageName(l)}</button>
                  ))}
                </div>
              </section>
            )}
            {isDesktop && (
              <section className="ex-platform">
                <header><strong>Folders</strong></header>
                <div className="ex-chips">
                  {(Object.keys(FOLDERS) as Folders[]).map((f) => (
                    <button key={f} className={folders === f ? 'chip on' : 'chip'} aria-pressed={folders === f} onClick={() => pickFolders(f)}>{FOLDERS[f]}</button>
                  ))}
                </div>
                <p className="hint">
                  {{ none: `${project.name}-iphone-${langs[0]}-1-….png`, 'lang-device': `${langs[0]}/iPhone/${project.name}-….png`, 'device-lang': `iPhone/${langs[0]}/${project.name}-….png` }[folders]}
                </p>
              </section>
            )}
            <footer className="ex-foot">
              {progress ? (
                <span className="ex-progress">
                  <span>{progress.n < progress.of ? `Rendering ${progress.n + 1} of ${progress.of}` : 'Rendered'}<small>{progress.what}</small></span>
                  <progress max={progress.of} value={progress.n} />
                </span>
              ) : (
              <span>
                {count
                  ? `${slideCount} slide${slideCount === 1 ? '' : 's'}${picked.length > 1 ? ` × ${picked.length} languages` : ''} = ${count} PNG${count === 1 ? '' : 's'}`
                  : 'Pick at least one slide and language'}
                <small>Each platform exports at its size from Settings.</small>
              </span>
              )}
              <button className="primary" disabled={busy || !count} onClick={exportPngs}>{busy ? 'Exporting…' : `Export ${count} PNG${count === 1 ? '' : 's'}`}</button>
            </footer>
          </>
        ) : kind === 'file' ? (
          <>
            <p className="hint">Saves the whole project, screenshots included, to a .ssproj file you can open again or send to someone.</p>
            <div className="row end">
              <button className="primary" onClick={async () => saveFile(`${project.name}.ssproj`, await projectToFile(project), PROJECT_FILE)}>Save File…</button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">Saves the whole project, every platform, as a template to start new projects from.</p>
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>Description<input value={description} placeholder="What it looks like, who it's for" onChange={(e) => setDescription(e.target.value)} /></label>
            <label><input type="checkbox" checked={shots} onChange={(e) => setWithShots(e.target.checked ? 'on' : 'off')} />Include screenshots and images</label>
            <p className="hint">Turn this off to remove every screenshot and image from the template. The text, colors, devices and layout stay.</p>
            {isDesktop && (
              <>
                <label><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />Share with everyone</label>
                <p className="hint">Opens a pull request on GitHub adding it to Screenshot Studio's templates, using your GitHub CLI login (<code>gh auth login</code>). Everything in it becomes public{shots ? ', screenshots included' : ''}.</p>
              </>
            )}
            {done && (
              <p className="status ok">
                {done.startsWith('https://')
                  ? <>Pull request opened: <a href={done} onClick={(e) => { e.preventDefault(); openLink(done) }}>{done}</a></>
                  : done}
              </p>
            )}
            <div className="row end">
              <button className="primary" disabled={busy || !name.trim()} onClick={saveTemplate}>
                {busy ? 'Saving…' : share ? 'Save and share…' : 'Save template'}
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  )
}
