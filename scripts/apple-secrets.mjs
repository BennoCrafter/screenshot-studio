// Stores the macOS signing and notarization secrets in this repo's GitHub secrets, for the Release workflow.
// `node scripts/apple-secrets.mjs path/to/cert.p12` (needs `gh auth login` and the cert installed in your keychain)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'

const p12 = process.argv[2]
if (!p12) throw new Error('Usage: node scripts/apple-secrets.mjs path/to/cert.p12')
if (!process.stdin.isTTY) throw new Error('This asks for passwords: run it in a real terminal, not through a pipe or `!`.')

// secret values go through stdin, never the command line, so they stay out of `ps` and shell history
const set = (name, value) => execFileSync('gh', ['secret', 'set', name], { input: value, stdio: ['pipe', 'inherit', 'inherit'] })
// with no input gh asks for the value itself, hidden
const ask = (name) => execFileSync('gh', ['secret', 'set', name], { stdio: 'inherit' })

const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
const identity = identities.match(/"(Developer ID Application: .+ \((\w+)\))"/)
if (!identity) throw new Error('No "Developer ID Application" certificate in your keychain: double-click the .cer first.')
console.log(`Signing identity: ${identity[1]}`)

const rl = createInterface({ input: process.stdin, output: process.stdout })
const appleId = (await rl.question('Apple ID email: ')).trim()
rl.close()

set('APPLE_CERTIFICATE', readFileSync(p12).toString('base64'))
set('APPLE_SIGNING_IDENTITY', identity[1])
set('APPLE_TEAM_ID', identity[2])
set('APPLE_ID', appleId)
console.log('Password of the .p12 file:')
ask('APPLE_CERTIFICATE_PASSWORD')
console.log('App-specific password from appleid.apple.com:')
ask('APPLE_PASSWORD')
console.log('Done. The next release will be signed and notarized.')
