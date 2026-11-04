// Makes the welcome tour's pictures (src/start/tour-images/*.webp) from the README screenshots (assets/screenshots/*.png):
//   pnpm tour-images
// Needs cwebp (brew install webp). Run it again after retaking a screenshot; the tour's zoom spots (Tour.tsx) are in % of these pictures.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

const FROM = 'assets/screenshots'
const TO = 'src/start/tour-images'
// the launcher sits on a white background; cut down to the window itself, inside its round corners (fractions of the picture)
const CROP = { 'launcher-window': { x: 0.042, y: 0.047, w: 0.916, h: 0.869 } }

try { execFileSync('cwebp', ['-version']) } catch { throw new Error('cwebp not found. Install it with: brew install webp') }

for (const file of readdirSync(FROM).filter((f) => f.endsWith('.png'))) {
  const name = file.slice(0, -4)
  const png = readFileSync(`${FROM}/${file}`)
  const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)] // the PNG header's IHDR
  const c = CROP[name]
  const crop = c ? ['-crop', ...[c.x * w, c.y * h, c.w * w, c.h * h].map((n) => String(Math.round(n)))] : []
  // full size: the tour zooms in up to 2.4×, so anything smaller turns blurry
  execFileSync('cwebp', ['-quiet', '-q', '88', ...crop, `${FROM}/${file}`, '-o', `${TO}/${name}.webp`])
  console.log(`${TO}/${name}.webp`)
}
