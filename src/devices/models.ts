// Device catalog. Pure data: the engine (render3d.ts) builds every model from these numbers,
// so adding a device means adding an entry here — no code.
//
// Units are millimetres. Front view: x right, y down from the top edge.
// Back view coordinates (bump, lenses, flash) are measured from the top-left of the BACK,
// i.e. x runs from the phone's right edge as seen from the front.
// iPhone and Duo numbers come from Apple's dimensional drawings / bezels (via open-screenshot-generator);
// iPad camera placement is estimated.

export interface Finish {
  id: string
  label: string
  frame: string
  back: string
}

export interface Disc {
  x: number
  y: number
  d: number
}

/** A hardware button. Like the original's drawings: seen from the front. */
interface Button {
  side: 'left' | 'right' | 'top'
  /** From the top edge to the button's center; on the top edge, from the left edge. */
  center: number
  length: number
  /** Across the edge, front to back. */
  width: number
  /** How far it stands off the frame; 0 is flush (Camera Control). */
  proud: number
  kind?: 'button' | 'control'
}

export interface DeviceModel {
  id: string
  label: string
  family: 'iPhone' | 'iPad' | 'Foldable' | 'Mac'
  width: number
  height: number
  depth: number
  radius: number
  /**
   * Display, centered on the front (shifted up by `y` when the bezel is uneven).
   * Its pixel aspect is what screenshots get cover-fitted to.
   */
  screen: { width: number; height: number; radius: number; y?: number }
  /** Dynamic Island (or a Mac's notch): size and its center's distance from the top edge. */
  island?: { width: number; height: number; center: number; notch?: boolean }
  /** Camera plateau on the back, back-view coords. */
  bump?: { x0: number; y0: number; x1: number; y1: number; radius: number; height: number }
  lenses?: Disc[]
  flash?: Disc
  buttons?: Button[]
  /**
   * Book-style foldable: hinge runs top to bottom down the middle of the open body,
   * the screen spans both halves. `hingeRadius` rounds the halves' corners at the hinge,
   * `spineInset` is how far the spine's ends stop short of the top and bottom.
   */
  fold?: { hingeRadius: number; spineInset: number }
  /**
   * Laptop: the body above is the lid; a keyboard base of this depth (front to back) and
   * thickness hangs off its bottom edge. The pose's `fold` is the angle between lid and base.
   */
  laptop?: { depth: number; thickness: number }
  /**
   * Foldables: the outer display on the left half's back, which faces you when closed
   * (hinge on the left). `hinge` is its distance from the hinge line; it is centered top to bottom.
   * Camera hole: diameter, center in from the free edge and down from the top.
   */
  outer?: {
    width: number; height: number; hinge: number; radius: number; hingeRadius: number
    camera: { d: number; x: number; y: number }
  }
  finishes: Finish[]
}

const PRO_18_FINISHES: Finish[] = [
  { id: 'glacier', label: 'Glacier', frame: '#bccfdc', back: '#cddce6' },
  { id: 'black', label: 'Black', frame: '#3b3b3e', back: '#36363a' },
  { id: 'silver', label: 'Silver', frame: '#dcdddf', back: '#e7e8ea' },
  { id: 'burgundy', label: 'Burgundy', frame: '#4a1a24', back: '#55212b' },
]

const PRO_17_FINISHES: Finish[] = [
  { id: 'deep-blue', label: 'Deep Blue', frame: '#323d55', back: '#3a465f' },
  { id: 'cosmic-orange', label: 'Cosmic Orange', frame: '#e8692b', back: '#ea7a3c' },
  { id: 'silver', label: 'Silver', frame: '#dcdddf', back: '#e8e9eb' },
]

const IPAD_FINISHES: Finish[] = [
  { id: 'space-black', label: 'Space Black', frame: '#3a3a3d', back: '#3a3a3d' },
  { id: 'silver', label: 'Silver', frame: '#d8d9db', back: '#e3e4e6' },
]

const PRO_BUTTONS = (control: number): Button[] => [
  { side: 'left', center: 34.28, length: 6.9, width: 2.66, proud: 0.45 }, // Action
  { side: 'left', center: 48.43, length: 11.2, width: 2.66, proud: 0.45 },
  { side: 'left', center: 62.63, length: 11.2, width: 2.66, proud: 0.45 },
  { side: 'right', center: 55.53, length: 17.7, width: 2.66, proud: 0.45 },
  { side: 'right', center: control, length: 17.1, width: 3.03, proud: 0, kind: 'control' },
]

// Estimated: top button near the right corner, volume on the right edge.
const IPAD_BUTTONS = (width: number): Button[] => [
  { side: 'top', center: width - 22, length: 20, width: 2.4, proud: 0.4 },
  { side: 'right', center: 30, length: 12, width: 2.4, proud: 0.4 },
  { side: 'right', center: 45, length: 12, width: 2.4, proud: 0.4 },
]

const PRO_TRIPLE_LENS = (x: number): Disc[] => [
  { x: 14.37, y: 14.37, d: 16.4 },
  { x: 14.37, y: 33.61, d: 16.4 },
  { x, y: 23.99, d: 16.4 },
]

export const DEVICES: DeviceModel[] = [
  {
    id: 'iphone-18-pro-max',
    label: 'iPhone 18 Pro Max',
    family: 'iPhone',
    width: 77.98, height: 163.43, depth: 8.75, radius: 12.5,
    screen: { width: 72.86, height: 158.31, radius: 10.2 },
    island: { width: 15.68, height: 6.07, center: 7.91 },
    bump: { x0: 5.12, y0: 5.12, x1: 77.98 - 5.12, y1: 42.85, radius: 9, height: 2.78 },
    lenses: PRO_TRIPLE_LENS(32.49),
    flash: { x: 64.16, y: 13.82, d: 6.9 },
    buttons: PRO_BUTTONS(111.82),
    finishes: PRO_18_FINISHES,
  },
  {
    id: 'iphone-17-pro',
    label: 'iPhone 17 Pro',
    family: 'iPhone',
    width: 71.85, height: 150.01, depth: 8.75, radius: 12.5,
    screen: { width: 66.57, height: 144.73, radius: 10.2 },
    island: { width: 20.76, height: 6.07, center: 7.99 },
    bump: { x0: 5.09, y0: 5.09, x1: 71.85 - 5.09, y1: 42.89, radius: 9, height: 2.55 },
    lenses: PRO_TRIPLE_LENS(32.36),
    flash: { x: 58.03, y: 13.82, d: 6.8 },
    buttons: PRO_BUTTONS(98.4),
    finishes: PRO_17_FINISHES,
  },
  {
    // Display 2064×2752 @ 264 ppi.
    id: 'ipad-pro-13',
    label: 'iPad Pro 13"',
    family: 'iPad',
    width: 215.49, height: 281.58, depth: 5.1, radius: 18,
    screen: { width: 198.58, height: 264.77, radius: 11 },
    bump: { x0: 6, y0: 6, x1: 30, y1: 42, radius: 8, height: 1.2 },
    lenses: [{ x: 18, y: 15, d: 10 }, { x: 18, y: 32, d: 8 }],
    flash: { x: 25.5, y: 24, d: 3 },
    buttons: IPAD_BUTTONS(215.49),
    finishes: IPAD_FINISHES,
  },
  {
    // Display 1668×2420 @ 264 ppi.
    id: 'ipad-pro-11',
    label: 'iPad Pro 11"',
    family: 'iPad',
    width: 177.5, height: 249.7, depth: 5.3, radius: 18,
    screen: { width: 160.48, height: 232.84, radius: 11 },
    bump: { x0: 6, y0: 6, x1: 30, y1: 42, radius: 8, height: 1.2 },
    lenses: [{ x: 18, y: 15, d: 10 }, { x: 18, y: 32, d: 8 }],
    flash: { x: 25.5, y: 24, d: 3 },
    buttons: IPAD_BUTTONS(177.5),
    finishes: IPAD_FINISHES,
  },
  {
    // Open, landscape: 164.6 × 117.8 × 5.2 per half. Inner display 2853×2007.
    id: 'iphone-duo',
    label: 'iPhone Duo',
    family: 'Foldable',
    width: 164.6, height: 117.8, depth: 5.2, radius: 10,
    screen: { width: 157.77, height: 110.97, radius: 8 },
    bump: { x0: 4.9, y0: 4.69, x1: 60.39, y1: 25.64, radius: 10.47, height: 1.5 },
    lenses: [{ x: 15.15, y: 15.19, d: 16.14 }, { x: 32.92, y: 15.19, d: 16.14 }],
    flash: { x: 49.59, y: 19.67, d: 3.81 },
    // Volume on the top edge, Touch ID side button and Camera Control on the right.
    buttons: [
      { side: 'top', center: 124.86, length: 10.87, width: 2.2, proud: 0.465 },
      { side: 'top', center: 138.25, length: 10.87, width: 2.2, proud: 0.465 },
      { side: 'right', center: 42.9, length: 18.66, width: 2.5, proud: 0.458 },
      { side: 'right', center: 69.33, length: 17.1, width: 2.2, proud: 0, kind: 'control' },
    ],
    fold: { hingeRadius: 2.5, spineInset: 1.43 },
    // Outer display 1398×2034.
    outer: { width: 77.3, height: 112.47, hinge: 2.34, radius: 7.4, hingeRadius: 1.5, camera: { d: 6.01, x: 10.57, y: 10.59 } },
    finishes: [
      { id: 'star-white', label: 'Star White', frame: '#d9d6cf', back: '#eeede9' },
      { id: 'night-sky', label: 'Night Sky', frame: '#3b4558', back: '#333c4b' },
    ],
  },
]

// MacBook Pro 14": 312.6 × 221.2 × 15.5 mm closed. Display 3024×1964 at 254 ppi.
// Lid height, bezels, notch and the base/lid split are estimated.
DEVICES.push({
  id: 'macbook-pro-14',
  label: 'MacBook Pro 14"',
  family: 'Mac',
  width: 312.6, height: 214, depth: 5.5, radius: 9,
  screen: { width: 302.4, height: 196.4, radius: 4, y: 3.3 },
  island: { width: 31, height: 6.2, center: 7.6, notch: true },
  laptop: { depth: 221.2, thickness: 10 },
  finishes: [
    { id: 'space-black', label: 'Space Black', frame: '#2e2e30', back: '#2e2e30' },
    { id: 'silver', label: 'Silver', frame: '#d6d7d9', back: '#d6d7d9' },
  ],
})

/** The fold a device rests at: a laptop half open, everything else flat. */
export const restFold = (m: DeviceModel | undefined) => (m?.laptop ? 110 : 180)

export const DEVICE_BY_ID = Object.fromEntries(DEVICES.map((d) => [d.id, d]))
