// Raises the app version everywhere it's written: `pnpm bump` (patch), `pnpm bump minor|major`, or `pnpm bump 1.2.3`.
import { readFileSync, writeFileSync } from 'node:fs'

const FILES = [
  ['src-tauri/tauri.conf.json', /("version": ")([^"]+)(")/],
  ['src-tauri/Cargo.toml', /^(version = ")([^"]+)(")/m],
  ['package.json', /("version": ")([^"]+)(")/],
  ['src/agent/agent.ts', /(serverInfo: \{ name: 'screenshot-studio', version: ')([^']+)(')/],
]

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const now = read(FILES[0][0]).match(FILES[0][1])[2] // tauri.conf.json is what the updater compares
const arg = process.argv[2] ?? 'patch'
let next
if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg
else {
  const [a, b, c] = now.split('.').map(Number)
  next = { major: `${a + 1}.0.0`, minor: `${a}.${b + 1}.0`, patch: `${a}.${b}.${c + 1}` }[arg]
  if (!next) throw new Error(`Use patch, minor, major or a version like 1.2.3, not "${arg}"`)
}

for (const [f, re] of FILES) {
  const text = read(f)
  if (!re.test(text)) throw new Error(`No version found in ${f}`)
  writeFileSync(new URL(`../${f}`, import.meta.url), text.replace(re, `$1${next}$3`))
}
console.log(`${now} → ${next}\nNext: git commit -am "v${next}" && git tag v${next} && git push origin main v${next}`)
