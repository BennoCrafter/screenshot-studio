import { useEffect, useRef, useState } from 'react'
import { isDesktop, openLink, saveFile, saveFiles } from './native'
import { languageName, languagesOf, PROJECT_FILE, projectToFile, type Project } from './project'
import { labelOf } from './elements'
import { localize, PLATFORMS, renderSlide, sizeOf } from './render'
import { useStored } from './prefs'
import { loadCustom, saveCustom, shareTemplate, toData, type Template } from './templates'

const THUMB_H = 180 // every platform's thumbnails the same height

/** How exported PNGs are sorted into subfolders. */
const FOLDERS = { none: 'All in one folder', 'lang-device': 'Language › Device', 'device-lang': 'Device › Language' }
type Folders = keyof typeof FOLDERS

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`)
const dataUrl = (blob: Blob) => new Promise<string>((done) => {
  const r = new FileReader()
  r.onload = () => done(r.result as string)
  r.readAsDataURL(blob)
})

/** One self-contained page showing every rendered slide, grouped by language and platform, with device and language
 *  filters and a click-to-enlarge view (arrow keys step through). */
async function websiteOf(title: string, groups: { lang: string; platform: string; shots: { alt: string; blob: Blob }[] }[]) {
  const langs = [...new Set(groups.map((g) => g.lang))]
  const platforms = [...new Set(groups.map((g) => g.platform))]
  const chips = (k: string, vs: string[]) => vs.length < 2 ? '' : `<div class="chips">${vs.map((v) => `<button data-k="${k}${esc(v)}" aria-pressed="true">${esc(v)}</button>`).join('')}</div>`
  let body = ''
  for (const g of groups) {
    const imgs = await Promise.all(g.shots.map(async (s) => `<button><img src="${await dataUrl(s.blob)}" alt="${esc(s.alt)}" loading="lazy"></button>`))
    body += `<section data-p="p${esc(g.platform)}" data-l="l${esc(g.lang)}"><h2>${esc(langs.length > 1 ? `${g.platform} · ${g.lang}` : g.platform)}</h2><div class="row">${imgs.join('')}</div></section>`
  }
  const filters = chips('p', platforms) + chips('l', langs)
  return new Blob([`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{color-scheme:light dark;--bg:#f5f5f7;--fg:#1d1d1f;--muted:#6e6e73;--line:#d2d2d7}
@media (prefers-color-scheme:dark){:root{--bg:#111113;--fg:#f5f5f7;--muted:#98989d;--line:#3a3a3c}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
header{padding:64px 24px 24px;text-align:center}h1{margin:0;font-size:clamp(32px,6vw,56px);letter-spacing:-.02em}
nav{position:sticky;top:0;z-index:1;display:flex;flex-wrap:wrap;gap:8px 24px;justify-content:center;padding:12px 24px;background:color-mix(in srgb,var(--bg) 80%,transparent);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
.chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.chips button{font:inherit;font-size:14px;padding:6px 14px;border-radius:999px;border:1px solid var(--line);background:none;color:var(--muted);cursor:pointer}
.chips button[aria-pressed=true]{background:var(--fg);border-color:var(--fg);color:var(--bg)}
section{padding:24px 0 40px}h2{margin:0 24px 16px;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.row{display:flex;gap:20px;overflow-x:auto;padding:8px 24px 24px;scroll-snap-type:x mandatory}
.row button{flex:none;padding:0;border:0;background:none;cursor:zoom-in;scroll-snap-align:center;border-radius:16px}
.row img{display:block;height:min(70vh,640px);width:auto;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.18);transition:transform .2s}
.row button:hover img{transform:translateY(-4px)}
dialog{border:0;padding:0;background:none;max-width:none;max-height:none;cursor:zoom-out}
dialog::backdrop{background:rgba(0,0,0,.85)}
dialog img{display:block;max-width:94vw;max-height:94vh;border-radius:12px}
</style></head><body><header><h1>${esc(title)}</h1></header>${filters && `<nav>${filters}</nav>`}${body}<dialog><img alt=""></dialog><script>
const off = new Set(), d = document.querySelector('dialog'), big = d.querySelector('img')
let cur
for (const b of document.querySelectorAll('.chips button')) b.onclick = () => {
  off.has(b.dataset.k) ? off.delete(b.dataset.k) : off.add(b.dataset.k)
  b.setAttribute('aria-pressed', !off.has(b.dataset.k))
  for (const s of document.querySelectorAll('section')) s.hidden = off.has(s.dataset.p) || off.has(s.dataset.l)
}
const show = (i) => { cur = i; big.src = i.src; big.alt = i.alt; if (!d.open) d.showModal() }
for (const i of document.querySelectorAll('.row img')) i.parentElement.onclick = () => show(i)
d.onclick = () => d.close()
onkeydown = (e) => {
  if (!d.open) return
  const all = [...document.querySelectorAll('section:not([hidden]) .row img')]
  const next = all[all.indexOf(cur) + (e.key === 'ArrowRight') - (e.key === 'ArrowLeft')]
  if (next) show(next)
}
</script></body></html>`], { type: 'text/html' })
}

/** The Export button and its dialog: PNGs of the picked slides, platforms and languages, the project as a template, or as a .ssproj file. */
export function Export({ project }: { project: Project }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [thumbs, setThumbs] = useState<Record<string, string>>({}) // slide id → small preview
  const [kind, setKind] = useStored<'png' | 'web' | 'template' | 'file'>('export-kind', 'png')
  const [skip, setSkip] = useState(new Set<string>()) // slide ids, language codes and (templates) platforms left out
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [author, setAuthor] = useStored<string>('template-author', '')
  const [withShots, setWithShots] = useStored<'on' | 'off'>('template-shots', 'off')
  const shots = withShots === 'on'
  const [share, setShare] = useState(false) // opt in; even then the user submits it on GitHub themselves
  const [done, setDone] = useState<string | null>(null)
  const [folders, pickFolders] = useStored<Folders>('export-folders', 'none')
  const [progress, setProgress] = useState<{ n: number; of: number; what: string } | null>(null) // PNG export under way

  const langs = languagesOf(project)
  const picked = langs.filter((l) => !skip.has(l))
  const chosen = project.targets.map((t) => ({ t, slides: t.slides.filter((s) => !skip.has(s.id)) }))
  const slideCount = chosen.reduce((n, c) => n + c.slides.length, 0)
  const count = slideCount * picked.length
  const tplTargets = project.targets.filter((t) => !skip.has(t.platform))
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
        const [w, h] = sizeOf(t)
        const url = URL.createObjectURL(await renderSlide(localize(s, langs[0]), [w, h], (THUMB_H * 2) / h))
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
      const groups = []
      for (const { t, slides } of chosen) {
        const [w, h] = sizeOf(t)
        for (const l of picked) {
          const group = { lang: languageName(l), platform: PLATFORMS[t.platform].label, shots: [] as { alt: string; blob: Blob }[] }
          if (slides.length) groups.push(group)
          for (const s of slides) {
            const n = t.slides.indexOf(s) + 1
            setProgress({ n: files.length, of: count, what: `${PLATFORMS[t.platform].label} · ${languageName(l)} · slide ${n}` })
            await new Promise(requestAnimationFrame) // let the bar paint before the next slide renders
            const sub = { none: '', 'lang-device': `${l}/${PLATFORMS[t.platform].label}/`, 'device-lang': `${PLATFORMS[t.platform].label}/${l}/` }[folders]
            const blob = await renderSlide(localize(s, l), [w, h])
            files.push({ name: `${sub}${project.name.replace(/[/\\]/g, '-')}-${t.platform}-${l}-${n}-${w}x${h}.png`, blob })
            group.shots.push({ alt: labelOf(s) || `Slide ${n}`, blob })
          }
        }
      }
      setProgress({ n: count, of: count, what: isDesktop ? (kind === 'web' ? 'Pick where to save it' : 'Pick a folder to save them in') : 'Downloading' })
      if (kind === 'web') {
        const page = await websiteOf(project.name, groups)
        const saved = await saveFile(`${project.name}.html`, page, { name: 'Web page', extensions: ['html'] })
        if (!saved) return
        dialog.current!.close()
        // shortcut: the browser opens a blob: copy (and may block the popup), as it can't open the downloaded file
        await openLink(saved === true ? URL.createObjectURL(page) : `file://${saved.startsWith('/') ? '' : '/'}${encodeURI(saved.replace(/\\/g, '/'))}`)
      } else if (await saveFiles(files)) dialog.current!.close()
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const saveTemplate = async () => {
    setBusy(true)
    setDone(null)
    try {
      const t: Template = {
        id: crypto.randomUUID(),
        name: name.trim(),
        author: author.trim() || undefined,
        description: description.trim() || 'Saved from a project.',
        targets: Object.fromEntries(await Promise.all(tplTargets.map(async (t) =>
          [t.platform, { platform: t.platform, size: t.size, landscape: t.landscape, slides: await Promise.all(t.slides.map((s) => toData(s, shots))) }]))),
      }
      await saveCustom([...(await loadCustom()), { ...t, custom: true }])
      setDone(share ? `Saved to your templates. ${await shareTemplate(t)}` : 'Saved to your templates.')
    } catch (e) {
      setDone(`Saved to your templates, but sharing failed: ${e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="primary" onClick={() => { setDone(null); setName((n) => n || project.name); setOpen(true); dialog.current!.showModal() }}>Export</button>
      <dialog ref={dialog} className="tpl-dialog export" onClose={() => setOpen(false)} onClick={(e) => e.target === dialog.current && dialog.current!.close()}>
        <header>
          <h2>Export</h2>
          <nav className="platform-tabs">
            <span className={kind === 'png' ? 'on' : ''}><button onClick={() => setKind('png')}>PNG images</button></span>
            <span className={kind === 'web' ? 'on' : ''}><button onClick={() => setKind('web')}>Website</button></span>
            <span className={kind === 'template' ? 'on' : ''}><button onClick={() => setKind('template')}>Template</button></span>
            <span className={kind === 'file' ? 'on' : ''}><button onClick={() => setKind('file')}>Project file</button></span>
          </nav>
          <button onClick={() => dialog.current!.close()}>Close</button>
        </header>

        {kind === 'png' || kind === 'web' ? (
          <>
            <div className="ex-body">
            {chosen.map(({ t, slides }) => {
              const [w, h] = sizeOf(t)
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
                        style={{ height: THUMB_H, aspectRatio: `${w} / ${h}` }}
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
            {isDesktop && kind === 'png' && (
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
            </div>
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
                <small>{kind === 'web' ? 'Saved as one HTML page with every image inside.' : 'Each platform exports at its size from Settings.'}</small>
              </span>
              )}
              <button className="primary" disabled={busy || !count} onClick={exportPngs}>{busy ? 'Exporting…' : kind === 'web' ? 'Save Website…' : `Export ${count} PNG${count === 1 ? '' : 's'}`}</button>
            </footer>
          </>
        ) : kind === 'file' ? (
          <>
            <div className="ex-body">
              <p className="hint">Saves the whole project, screenshots included, as a .ssproj file you can open again or send to someone.</p>
            </div>
            <footer className="ex-foot">
              <span />
              <button className="primary" onClick={async () => saveFile(`${project.name}.ssproj`, await projectToFile(project), PROJECT_FILE)}>Save File…</button>
            </footer>
          </>
        ) : (
          <>
            <div className="ex-body ex-form">
              <p className="hint">A template to start new projects from.</p>
              <div className="ex-pair">
                <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
                <label>Made by<input value={author} placeholder="Your name" onChange={(e) => setAuthor(e.target.value)} /></label>
              </div>
              <label>Description<textarea rows={4} value={description} placeholder="What it looks like, who it's for" onChange={(e) => setDescription(e.target.value)} /></label>
              <div className="ex-field">
                <span>Devices</span>
                <div className="ex-chips">
                  {project.targets.map(({ platform: p }) => (
                    <button key={p} className={skip.has(p) ? 'chip' : 'chip on'} aria-pressed={!skip.has(p)} onClick={() => toggle(p)}>{PLATFORMS[p].label}</button>
                  ))}
                </div>
              </div>
              <label className="ex-switch">
                <span>Include screenshots and images<small>Otherwise only the text, colors, devices and layout are kept.</small></span>
                <input type="checkbox" className="switch" checked={shots} onChange={(e) => setWithShots(e.target.checked ? 'on' : 'off')} />
              </label>
              <label className="ex-switch">
                <span>Share with everyone<small>Opens GitHub in your browser with the template filled in. Nothing is sent until you submit it there{shots ? ', and screenshots become public' : ''}.</small></span>
                <input type="checkbox" className="switch" checked={share} onChange={(e) => setShare(e.target.checked)} />
              </label>
              {done && <p className="status ok">{done}</p>}
            </div>
            <footer className="ex-foot">
              <span />
              <button className="primary" disabled={busy || !name.trim() || !tplTargets.length} onClick={saveTemplate}>
                {busy ? 'Saving…' : share ? 'Save and share…' : 'Save template'}
              </button>
            </footer>
          </>
        )}
      </dialog>
    </>
  )
}
