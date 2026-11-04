import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { isDesktop } from '../lib/native'
import { openSettings } from '../settings/prefs'
import launcher from './tour-images/launcher-window.webp'
import chooser from './tour-images/new-project-window.webp'
import editor from './tour-images/editor-window.webp'

// at: the spot in the picture the step zooms into and clicks, in % of the picture
type Step = { title: string; text: string; image: string; at?: [number, number]; zoom?: number; settings?: string }
const STEPS: Step[] = [
  { title: 'Welcome to Screenshot Studio', text: 'Make App Store screenshots for iPhone, iPad and Mac in one project. Here are the basics in a few short steps.', image: launcher },
  { title: 'Start from a template', text: 'Create New Project shows the templates. Pick one, tick the platforms you ship on and name your app. Projects save themselves as you work.', image: chooser, at: [42.4, 32.5], zoom: 1.5 },
  { title: 'Drop in your screenshots', text: 'Drag a screenshot file onto a device to place it. The Inspector on the right edits texts, devices, colors and layout. Hold ⌘ (Ctrl on Windows) to see shortcuts.', image: editor, at: [24, 57], zoom: 1.8 },
  { title: 'Export', text: 'Export writes PNGs in App Store sizes for the slides, platforms and languages you pick, or a web page to share them.', image: editor, at: [93, 6.5], zoom: 2.4 },
  ...(isDesktop ? [{ title: 'Let an AI agent help', text: 'The Agent tab runs Claude Code on your open project. Any MCP client or the command line can drive the app too.', image: editor, at: [90.7, 17.5], zoom: 2.2, settings: 'agent' } as Step] : []),
]

/** A short tour of the app: shown on first launch, again from the start page's Take the Tour. */
export function Tour({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!open || dialog.current!.open) return
    setI(0)
    dialog.current!.showModal()
    dialog.current!.querySelector<HTMLElement>('.primary')!.focus() // not Skip, the first button
  }, [open])
  const step = STEPS[i]
  const last = i === STEPS.length - 1
  const finish = (then?: () => void) => { dialog.current!.close(); then?.() }
  const at = step.at && { '--x': `${step.at[0]}%`, '--y': `${step.at[1]}%`, '--zoom': step.zoom } as CSSProperties

  return (
    <dialog ref={dialog} className="tour" onClose={onClose} aria-labelledby="tour-title">
      {/* keyed by step, so the zoom, ring and text play again on each one */}
      <div key={i} className="tour-picture" style={at}>
        <img src={step.image} alt="" />
        {at && <>
          <span className="tour-click" />
          {/* a wide dark stroke under a white one: an outline with round corners */}
          <svg className="tour-cursor" width="28" height="28" viewBox="0 0 24 24" aria-hidden fill="#fff" strokeLinejoin="round">
            <path d="M4.5 4.5l14.5 5.6-6.3 2.1-2.1 6.3z" stroke="#111" strokeWidth="5.5" />
            <path d="M4.5 4.5l14.5 5.6-6.3 2.1-2.1 6.3z" stroke="#fff" strokeWidth="2.5" />
          </svg>
        </>}
      </div>
      <div key={`text-${i}`} className="tour-text">
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.text} {step.settings && <button className="link" onClick={() => finish(() => openSettings(step.settings))}>Open Settings</button>}</p>
      </div>
      <footer>
        <div className="tour-dots" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
          {STEPS.map((s, n) => <button key={s.title} className={n === i ? 'on' : ''} aria-label={`Step ${n + 1}`} onClick={() => setI(n)} />)}
        </div>
        <span className="tour-buttons">
          <button className="link-button" onClick={() => finish()}>Skip</button>
          {i > 0 && <button onClick={() => setI(i - 1)}>Back</button>}
          {last
            ? <button className="primary" onClick={() => finish(onCreate)}>Create a Project…</button>
            : <button className="primary" onClick={() => setI(i + 1)}>Next</button>}
        </span>
      </footer>
    </dialog>
  )
}
