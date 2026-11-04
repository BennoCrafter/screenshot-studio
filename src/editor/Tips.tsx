import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { clamp } from '../model/render'
import { getConfig, setConfig } from '../settings/prefs'

// at: the element the tip points to
const TIPS = [
  { at: '.slide-wrap', title: 'Your slides', text: 'Drop a screenshot file onto a device to place it. Drag things to move them, double-click text to edit it.' },
  { at: '.tools', title: 'Add elements', text: 'Text, images, devices and shapes go onto the selected slides. Slides are listed below, drag them to reorder.' },
  { at: '.side', title: 'Inspector', text: 'Edits whatever is selected: texts, fonts, device, colors and layout.' },
  { at: '[data-tip=languages]', title: 'Languages', text: 'Add App Store languages here. Each has its own texts and can have its own screenshots.' },
  { at: '.topbar > .primary', title: 'Export', text: 'PNGs in App Store sizes when you\'re done. Hold ⌘ (Ctrl on Windows) for a second anytime to see shortcuts.' },
]
const GAP = 12

/** Tips pointing at the editor's main parts: shown the first time a project opens, again after Settings › General › Reset. */
export function Tips() {
  const [i, setI] = useState<number | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<DOMRect>()
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    // after the editor's open animation, so the parts are where they'll stay
    const load = () => getConfig<boolean>('seenEditorTips').then((seen) => { if (!seen) timer = setTimeout(() => setI((cur) => cur ?? 0), 600) })
    load()
    window.addEventListener('config-changed', load)
    return () => { clearTimeout(timer); window.removeEventListener('config-changed', load) }
  }, [])

  const tip = i === null ? undefined : TIPS[i]
  // next to the target, on the side with the most room, kept on screen
  useLayoutEffect(() => {
    if (!tip) return
    const place = () => {
      const r = document.querySelector(tip.at)?.getBoundingClientRect()
      const c = card.current!.getBoundingClientRect()
      if (!r) return setPos({ left: (innerWidth - c.width) / 2, top: (innerHeight - c.height) / 2 })
      setBox(r)
      const room = { right: innerWidth - r.right, left: r.left, below: innerHeight - r.bottom }
      const side = (Object.keys(room) as (keyof typeof room)[]).reduce((a, b) => (room[b] > room[a] ? b : a))
      const x = side === 'right' ? r.right + GAP : side === 'left' ? r.left - GAP - c.width : r.left + r.width / 2 - c.width / 2
      const y = side === 'below' ? r.bottom + GAP : r.top + Math.min(r.height, 240) / 2 - c.height / 2
      setPos({ left: clamp(x, GAP, innerWidth - c.width - GAP), top: clamp(y, GAP, innerHeight - c.height - GAP) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [tip])

  if (!tip) return null
  const done = () => { setI(null); setBox(undefined); setConfig('seenEditorTips', true) }
  const last = i === TIPS.length - 1
  return <>
    {box && <div className="tip-spot" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />}
    <div ref={card} key={i} className="tip" role="dialog" aria-label={tip.title} style={pos}>
      <b>{tip.title}</b>
      <p>{tip.text}</p>
      <footer>
        <small>{i! + 1} of {TIPS.length}</small>
        <span className="spacer" />
        {!last && <button className="link-button" onClick={done}>Skip</button>}
        <button className="primary" autoFocus onClick={() => (last ? done() : setI(i! + 1))}>{last ? 'Done' : 'Next'}</button>
      </footer>
    </div>
  </>
}
