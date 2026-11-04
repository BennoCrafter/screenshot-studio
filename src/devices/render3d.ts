// Builds a DeviceModel into a three.js scene and renders it to a transparent canvas,
// tightly cropped, so the 2D slide renderer can drawImage() it like any other bitmap.

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { DEVICE_BY_ID, type DeviceModel, type Disc } from './models'

export interface DevicePose {
  model: string
  finish: string
  yaw: number // degrees
  roll?: number // degrees, spin in the picture plane
  pitch: number // degrees
  fold: number // degrees between the halves, 180 = flat, 0 = closed; foldables only
  x: number // offset of the device center, fraction of slide width
  y: number // offset of the device center, fraction of slide height
  size: number // device width as a fraction of the slide width
  shadow?: boolean // drop shadow on the slide; on unless false
  reflections?: boolean // glossy frame, back and glass; matte when false
}

const { PI } = Math

// Rounded rect, y up, radii [topLeft, topRight, bottomRight, bottomLeft].
function rrect(x0: number, y0: number, x1: number, y1: number, [tl, tr, br, bl]: number[]) {
  // zero-radius arcs would add duplicate points, which break triangulation
  const arc = (cx: number, cy: number, r: number, a: number) => r > 0 && s.absarc(cx, cy, r, a, a + PI / 2, false)
  const s = new THREE.Shape()
  s.moveTo(x0 + bl, y0)
  s.lineTo(x1 - br, y0)
  arc(x1 - br, y0 + br, br, -PI / 2)
  s.lineTo(x1, y1 - tr)
  arc(x1 - tr, y1 - tr, tr, 0)
  s.lineTo(x0 + tl, y1)
  arc(x0 + tl, y1 - tl, tl, PI / 2)
  s.lineTo(x0, y0 + bl)
  arc(x0 + bl, y0 + bl, bl, PI)
  return s
}

// Corner radii for a panel spanning [x0, x1]: outer edges get `r`, a hinge side gets `h`.
function corners(x0: number, x1: number, W: number, r: number, h: number) {
  const left = x0 <= -W / 2 + 1e-6 ? r : h
  const right = x1 >= W / 2 - 1e-6 ? r : h
  return [left, right, right, left]
}

interface Built {
  root: THREE.Group
  halves: THREE.Object3D[] // foldables: [left, right], each swings half the fold
  base: THREE.Object3D | null // laptops: the keyboard half, hinged at the lid's bottom edge
  frame: THREE.MeshPhysicalMaterial
  back: THREE.MeshPhysicalMaterial
  screen: THREE.MeshBasicMaterial
  outerScreen: THREE.MeshBasicMaterial
  glossy: THREE.MeshPhysicalMaterial[] // the materials reflections can be turned off on
}

function build(m: DeviceModel): Built {
  const W = m.width, H = m.height, D = m.depth
  const frame = new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.28 })
  const back = new THREE.MeshPhysicalMaterial({ roughness: 0.45, clearcoat: 0.6 })
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.05, clearcoat: 1 })
  const screen = new THREE.MeshBasicMaterial({ toneMapped: false })
  const outerScreen = new THREE.MeshBasicMaterial({ toneMapped: false })
  const lensGlass = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0c, roughness: 0.1, clearcoat: 1 })
  const flashMat = new THREE.MeshPhysicalMaterial({ color: 0xf2eee0, roughness: 0.4 })

  // root turns around the middle of the body; the hinge axis is at the front face (z=0)
  const root = new THREE.Group()
  const inner = new THREE.Group()
  inner.position.z = D / 2
  root.add(inner)
  const right = new THREE.Group()
  const left = m.fold ? new THREE.Group() : right
  inner.add(left, right)
  const panels: [number, number, THREE.Object3D][] = m.fold
    ? [[-W / 2, 0, left], [0, W / 2, right]]
    : [[-W / 2, W / 2, right]]

  const hinge = m.fold?.hingeRadius ?? 0
  const bevel = Math.min(0.8, D * 0.15)
  const sw = m.screen.width, sh = m.screen.height

  for (const [x0, x1, parent] of panels) {
    // body: extruded, front face at z=0, back at z=-D
    const body = new THREE.ExtrudeGeometry(rrect(x0, -H / 2, x1, H / 2, corners(x0, x1, W, m.radius, hinge)), {
      depth: D - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
      bevelOffset: -bevel, bevelSegments: 4, curveSegments: 24,
    })
    body.translate(0, 0, -(D - bevel))
    parent.add(new THREE.Mesh(body, [back, frame])) // groups: 0 = caps, 1 = sides

    // front glass, slightly inside the frame lip
    const g = 0.4
    const gl = new THREE.ShapeGeometry(
      rrect(x0 + (x0 > -W / 2 ? 0 : g), -H / 2 + g, x1 - (x1 < W / 2 ? 0 : g), H / 2 - g,
        corners(x0, x1, W, m.radius - g, hinge)), 24)
    parent.add(new THREE.Mesh(gl, glass).translateZ(0.15))

    // screen, with UVs over the whole display so it spans a hinge seamlessly
    const s0 = Math.max(x0, -sw / 2), s1 = Math.min(x1, sw / 2)
    const sg = new THREE.ShapeGeometry(rrect(s0, -sh / 2, s1, sh / 2, corners(s0, s1, sw, m.screen.radius, 0)), 24)
    const pos = sg.attributes.position, uv = sg.attributes.uv
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + sw / 2) / sw, (pos.getY(i) + sh / 2) / sh)
    parent.add(new THREE.Mesh(sg, screen).translateZ(0.3).translateY(m.screen.y ?? 0))
  }

  if (m.island) {
    const { width: iw, height: ih, center, notch } = m.island
    const y = H / 2 - center
    const r = notch ? [0, 0, 2, 2] : Array(4).fill(ih / 2) // a notch hangs square from the top
    const isl = new THREE.ShapeGeometry(rrect(-iw / 2, y - ih / 2, iw / 2, y + ih / 2, r), 16)
    right.add(new THREE.Mesh(isl, new THREE.MeshBasicMaterial({ color: 0 })).translateZ(0.35))
  }

  // back-view (bx, by) → model (x, y); the back is mirrored left-right
  const toModel = (bx: number, by: number) => [W / 2 - bx, H / 2 - by] as const
  const owner = (x: number) => (x < 0 ? left : right)
  let partZ = -D
  if (m.bump) {
    const b = m.bump
    const [ax, ay] = toModel(b.x1, b.y1), [cx, cy] = toModel(b.x0, b.y0)
    const geo = new THREE.ExtrudeGeometry(rrect(ax, ay, cx, cy, Array(4).fill(b.radius)), {
      depth: b.height, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelOffset: -0.3, curveSegments: 24,
    })
    geo.translate(0, 0, -D - b.height)
    owner(ax).add(new THREE.Mesh(geo, [back, frame]))
    partZ = -D - b.height
  }
  const disc = (d: Disc, height: number, mat: THREE.Material, z: number) => {
    const [x, y] = toModel(d.x, d.y)
    const c = new THREE.Mesh(new THREE.CylinderGeometry(d.d / 2, d.d / 2, height, 40), mat)
    c.rotation.x = PI / 2
    c.position.set(x, y, z - height / 2)
    owner(x).add(c)
  }
  for (const l of m.lenses ?? []) {
    disc(l, 1.6, frame, partZ) // metal ring
    disc({ ...l, d: l.d * 0.8 }, 1.7, lensGlass, partZ)
  }
  if (m.flash) disc(m.flash, 0.2, flashMat, partZ)

  if (m.outer) {
    // Built in back-view coords (x' = -x, hinge at x'=0, free edge at x'=W/2), then turned to face -z.
    const o = m.outer
    const backFace = (geo: THREE.BufferGeometry, mat: THREE.Material, lift: number) => {
      geo.rotateY(PI)
      left.add(new THREE.Mesh(geo, mat).translateZ(-D - lift))
    }
    const g = 0.4
    backFace(new THREE.ShapeGeometry(rrect(0, -H / 2 + g, W / 2 - g, H / 2 - g,
      [hinge, m.radius - g, m.radius - g, hinge]), 24), glass, 0.15)
    const x0 = o.hinge, x1 = o.hinge + o.width
    const og = new THREE.ShapeGeometry(rrect(x0, -o.height / 2, x1, o.height / 2,
      [o.hingeRadius, o.radius, o.radius, o.hingeRadius]), 24)
    const pos = og.attributes.position, uv = og.attributes.uv
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - x0) / o.width, (pos.getY(i) + o.height / 2) / o.height)
    backFace(og, outerScreen, 0.3)
    const cam = new THREE.CircleGeometry(o.camera.d / 2, 32)
    cam.translate(W / 2 - o.camera.x, H / 2 - o.camera.y, 0)
    backFace(cam, new THREE.MeshBasicMaterial({ color: 0 }), 0.35)
  }

  for (const b of m.buttons ?? []) {
    const proud = Math.max(b.proud, 0.15), out = proud + 0.6 // 0.6 sunk into the frame
    const r = Math.min(out, b.width, b.length) * 0.45
    const geo = b.side === 'top'
      ? new RoundedBoxGeometry(b.length, out, b.width, 3, r)
      : new RoundedBoxGeometry(out, b.length, b.width, 3, r)
    const x = b.side === 'top' ? -W / 2 + b.center : b.side === 'left' ? -W / 2 - proud + out / 2 : W / 2 + proud - out / 2
    const y = b.side === 'top' ? H / 2 + proud - out / 2 : H / 2 - b.center
    const mesh = new THREE.Mesh(geo, b.kind === 'control' ? lensGlass : frame)
    mesh.position.set(x, y, -D / 2)
    owner(x).add(mesh)
  }

  if (m.fold) {
    // spine: a half-cylinder round the hinge axis, so the gap behind the halves stays closed
    const len = H - m.fold.spineInset * 2
    inner.add(new THREE.Mesh(new THREE.CylinderGeometry(D, D, len, 32, 1, true, PI / 2, PI), frame))
  }
  let base: THREE.Group | null = null
  if (m.laptop) {
    // Lies along +z from the hinge at the lid's bottom front edge, top face level with it.
    // Rotating it about x opens (fold 90° = flat in front of an upright lid) and closes it.
    const { depth: L, thickness: T } = m.laptop
    base = new THREE.Group()
    base.position.set(0, -H / 2, 0)
    right.add(base)
    const slab = new THREE.ExtrudeGeometry(rrect(-W / 2, 0, W / 2, L, Array(4).fill(m.radius)), {
      depth: T - 1, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.5, bevelOffset: -0.5, curveSegments: 24,
    })
    slab.translate(0, 0, 0.5)
    slab.rotateX(PI / 2) // shape y → +z, extrusion → -y
    base.add(new THREE.Mesh(slab, frame))
    // flat parts on the top face, drawn in xy with y = -z, then laid down facing +y
    const deck = (x0: number, z0: number, x1: number, z1: number, r: number, mat: THREE.Material) => {
      const g = new THREE.ShapeGeometry(rrect(x0, -z1, x1, -z0, Array(4).fill(r)), 16)
      g.rotateX(-PI / 2)
      base!.add(new THREE.Mesh(g, mat).translateY(0.05))
    }
    deck(-W * 0.42, L * 0.06, W * 0.42, L * 0.52, 3, glass) // keyboard
    deck(-W * 0.24, L * 0.57, W * 0.24, L * 0.95, 4, new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.08 })) // trackpad
  }

  const glossy = [frame, back, glass, lensGlass]
  for (const g of glossy) g.userData = { roughness: g.roughness, clearcoat: g.clearcoat }
  return { root, halves: m.fold ? [left, right] : [], base, frame, back, screen, outerScreen, glossy }
}

// ---- shared renderer, built lazily -------------------------------------------------

let renderer: THREE.WebGLRenderer
let scene: THREE.Scene
const camera = new THREE.PerspectiveCamera()
const built = new Map<string, Built>()
const textures = new WeakMap<HTMLImageElement, THREE.Texture>()
let placeholder: THREE.Texture

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setClearColor(0, 0)
  scene = new THREE.Scene()
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture
  const key = new THREE.DirectionalLight(0xffffff, 1.2)
  key.position.set(-1, 2, 3)
  scene.add(key)

  const c = document.createElement('canvas')
  c.width = 600
  c.height = 1300
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#2a2a2e'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#8a8a90'
  ctx.font = '500 44px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Drop a screenshot', 300, 650)
  placeholder = new THREE.CanvasTexture(c)
  placeholder.colorSpace = THREE.SRGBColorSpace
}

function textureFor(img: HTMLImageElement | null) {
  if (!img) return placeholder
  let t = textures.get(img)
  if (!t) {
    t = new THREE.Texture(img)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    t.needsUpdate = true
    textures.set(img, t)
  }
  return t
}

// Cover-fit: crop the texture to the screen's aspect. A landscape shot on a portrait screen (or the other way)
// is turned a quarter, upright for a device spun to landscape: clockwise for a negative roll, else counterclockwise.
function cover(t: THREE.Texture, screenAspect: number, roll = 0, turns = true) {
  const img = t.image as { width: number; height: number }
  const a = img.width / img.height
  const turn = turns && a > 1 !== screenAspect > 1
  const s = turn ? 1 / screenAspect : screenAspect
  t.repeat.set(Math.min(1, s / a), Math.min(1, a / s))
  t.center.set(0.5, 0.5)
  t.offset.set(0, 0)
  t.rotation = turn ? (roll > 0 ? -PI / 2 : PI / 2) : 0
}

const MAX_PX = 4096

/**
 * Renders the device at `flatWidthPx` = its width when flat and facing front.
 * The canvas is shared: draw it before the next call.
 */
export function renderDevice(
  pose: DevicePose,
  image: HTMLImageElement | null,
  outerImage: HTMLImageElement | null,
  flatWidthPx: number,
) {
  if (!renderer) init()
  const m = DEVICE_BY_ID[pose.model] ?? DEVICE_BY_ID['iphone-18-pro-max']
  let b = built.get(m.id)
  if (!b) built.set(m.id, (b = build(m)))
  for (const other of built.values()) scene.remove(other.root)
  scene.add(b.root)

  const finish = m.finishes.find((f) => f.id === pose.finish) ?? m.finishes[0]
  b.frame.color.set(finish.frame)
  b.back.color.set(finish.back)
  for (const g of b.glossy) {
    g.roughness = pose.reflections === false ? 1 : g.userData.roughness
    g.clearcoat = pose.reflections === false ? 0 : g.userData.clearcoat
  }
  const tex = textureFor(image)
  cover(tex, m.screen.width / m.screen.height, pose.roll, !m.laptop && !!image)
  b.screen.map = tex
  b.screen.needsUpdate = true
  if (m.outer) {
    const t = textureFor(outerImage)
    if (t !== tex) cover(t, m.outer.width / m.outer.height, pose.roll, !!outerImage) // ponytail: same image on both screens shares one crop
    b.outerScreen.map = t
    b.outerScreen.needsUpdate = true
  }
  // Both halves swing by half the fold, and the whole device turns with them as it closes,
  // so open it faces you like a book and closed the outer display faces you.
  const swing = ((180 - pose.fold) * PI) / 360
  let follow = 0
  if (b.halves.length) {
    b.halves[0].rotation.y = swing
    b.halves[1].rotation.y = -swing
    follow = swing * (1 - pose.fold / 180)
  }
  if (b.base) b.base.rotation.x = ((pose.fold - 90) * PI) / 180
  // Spin in the picture plane first, then turn and tilt about the screen's axes, so a spun
  // (e.g. landscape) device still turns the way the pointer drags; `follow` is about its own hinge.
  b.root.quaternion
    .setFromEuler(new THREE.Euler((pose.pitch * PI) / 180, (pose.yaw * PI) / 180, ((pose.roll ?? 0) * PI) / 180, 'XYZ'))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), follow))

  // Camera far back for mild perspective, then an off-center frustum fitted to every vertex.
  const dist = Math.max(m.width, m.height) * 6
  camera.position.set(0, 0, dist)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  b.root.updateMatrixWorld(true)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  const v = new THREE.Vector3()
  b.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const p = o.geometry.attributes.position
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).applyMatrix4(camera.matrixWorldInverse)
      const x = v.x / -v.z, y = v.y / -v.z
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
  })
  const near = dist * 0.5, far = dist * 2
  camera.projectionMatrix.makePerspective(x0 * near, x1 * near, y1 * near, y0 * near, near, far)
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()

  // Constant scale (px per mm from the flat width), so turning or folding never resizes the device.
  const ppm = (flatWidthPx / m.width) * dist
  const k = Math.min(1, MAX_PX / Math.max((x1 - x0) * ppm, (y1 - y0) * ppm)) // render cap
  renderer.setSize(Math.ceil((x1 - x0) * ppm * k), Math.ceil((y1 - y0) * ppm * k), false)
  renderer.render(scene, camera)
  return {
    canvas: renderer.domElement,
    width: (x1 - x0) * ppm,
    height: (y1 - y0) * ppm,
    flatHeight: (m.height / m.width) * flatWidthPx,
    laptop: !!m.laptop,
  }
}
