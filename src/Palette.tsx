// The editor's left panel parts: what can be added to a slide, and the picked slide's layers.

import { IMAGE_FILES, openFiles } from './native'
import { loadImage } from './project'
import { SHAPES } from './shapes'
import { newItem, partName, restack } from './elements'
import { layersOf, type Item, type Part, type Slide } from './render'
import { Icon } from './ui'

/** Texts with their size and weight set, as the templates use them. */
const TEXT_PRESETS = [
  ['Headline', { size: 0.085, weight: 800 }],
  ['Subtitle', { size: 0.042, weight: 500 }],
  ['Caption', { size: 0.03, weight: 500, opacity: 0.8 }],
] as const satisfies readonly (readonly [string, Partial<Item> & { size: number; weight: number }])[]

/** Buttons that add texts, images, devices, shapes, badges and icons; `insert` gets what to add. */
export function Palette({ insert, onDevice }: {
  insert: (make: () => Item) => void
  onDevice: (at: { x: number; y: number }) => void // opens the device menu there
}) {
  return (
    <>
      <h3>Elements</h3>
      <details className="add-section" open>
        <summary>Text</summary>
        <div className="add-grid">
          <button onClick={() => insert(() => newItem('text'))}><Icon d="M5 6V4h14v2M12 4v16M9 20h6" />Text</button>
          {TEXT_PRESETS.map(([label, preset]) => (
            <button key={label} onClick={() => insert(() => ({ ...newItem('text'), text: label, ...preset }))}>
              <span className="glyph" style={{ fontWeight: preset.weight, fontSize: 10 + preset.size * 100 }}>Aa</span>{label}
            </button>
          ))}
        </div>
      </details>
      <details className="add-section" open>
        <summary>Media</summary>
        <div className="add-grid">
          <button onClick={async () => {
            const [f] = await openFiles(IMAGE_FILES)
            if (f) { const img = await loadImage(f); insert(() => newItem('image', img)) }
          }}><Icon d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01" />Image</button>
          <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onDevice({ x: r.left, y: r.bottom + 4 }) }}><Icon d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2" />Device</button>
        </div>
      </details>
      {(['Shapes', 'Badges', 'Icons'] as const).map((group) => (
        <details key={group} className="add-section">
          <summary>{group}</summary>
          <div className="add-grid">
            {group === 'Shapes' && (
              <>
                <button onClick={() => insert(() => newItem('rect'))}><Icon d="M4 6h16v12H4z" />Rectangle</button>
                <button onClick={() => insert(() => newItem('ellipse'))}><Icon d="M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z" />Ellipse</button>
              </>
            )}
            {Object.entries(SHAPES).filter(([, s]) => s.group === group).map(([name, s]) => (
              <button key={name} onClick={() => insert(() => newItem('shape', undefined, undefined, name))}>
                <svg viewBox={`0 0 ${s.vw} ${s.vh}`} width="20" height="20" aria-hidden
                  {...(s.stroke ? { fill: 'none', stroke: 'currentColor', strokeWidth: s.stroke, strokeLinecap: 'round', strokeLinejoin: 'round' } : { fill: 'currentColor' })}>
                  <path d={s.d} />
                </svg>
                {s.label}
              </button>
            ))}
          </div>
        </details>
      ))}
    </>
  )
}

/** The slide's elements, frontmost first: click to pick (Shift adds), arrows move one up or down the stack. */
export function Layers({ sel, picked, pick, update }: {
  sel: Slide
  picked: Part[]
  pick: (part: Part, additive: boolean) => void
  update: (patch: Partial<Slide>) => void
}) {
  const order = layersOf(sel).toReversed()
  return (
    <ul className="layers">
      {order.map((p, i) => (
        <li key={p} className={picked.includes(p) ? 'on' : ''}>
          <button onClick={(e) => pick(p, e.shiftKey)}>{partName(sel, p)}</button>
          <button title="Bring forward" disabled={i === 0} onClick={() => update(restack(sel, p, (n) => n + 1))}>↑</button>
          <button title="Send backward" disabled={i === order.length - 1} onClick={() => update(restack(sel, p, (n) => n - 1))}>↓</button>
        </li>
      ))}
      <li><button disabled>Background</button></li>
    </ul>
  )
}
