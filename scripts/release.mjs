// Bumps the version, commits, tags and pushes the current branch to main, which starts the Release workflow.
// `pnpm release` (patch), `pnpm release minor|major`, or `pnpm release 1.2.3`.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const run = (cmd, ...args) => execFileSync(cmd, args, { stdio: 'inherit' })
const out = (cmd, ...args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()

// the release commit must hold only the version change
if (out('git', 'status', '--porcelain')) throw new Error('Commit or stash your changes first.')
run('git', 'fetch', 'origin', 'main')
// main must already be in this branch, so pushing it to main is a fast-forward, never an overwrite
try { out('git', 'merge-base', '--is-ancestor', 'origin/main', 'HEAD') } catch {
  throw new Error('origin/main has commits this branch lacks: merge or rebase onto it first.')
}

run('node', new URL('bump.mjs', import.meta.url).pathname, process.argv[2] ?? 'patch')
run('cargo', 'update', '-w', '--offline', '--manifest-path', 'src-tauri/Cargo.toml') // Cargo.lock's copy of the version
const v = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version
run('git', 'commit', '-am', `v${v}`)
run('git', 'tag', `v${v}`)
run('git', 'push', 'origin', `HEAD:main`, `v${v}`)
const branch = out('git', 'branch', '--show-current')
if (branch !== 'main') run('git', 'push', 'origin', branch)
console.log(`Released v${v}: https://github.com/BennoCrafter/screenshot-studio/actions`)
