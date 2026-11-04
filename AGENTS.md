# Screenshot Studio

A React + TypeScript app (Vite) for making App Store screenshots, shipped as a Tauri desktop app and as a browser version. The desktop app also runs an MCP server and a command line. See README.md for features, data locations and the file layout.

## Commands

```sh
pnpm dev                          # browser version at http://localhost:5173
pnpm desktop                      # desktop app (needs Rust)
pnpm cli tools                    # the command line (src-tauri/src/cli.rs) against the running app
npx tsc -p tsconfig.app.json      # type check (`tsc -p .` checks nothing: the root tsconfig only has references)
pnpm lint                         # oxlint; keep it at zero warnings
pnpm build                        # type check plus production build
(cd src-tauri && cargo check)     # Rust side
```

There are no automated tests. After a change, run the type check, lint and build, and try the change in the app (`pnpm dev`) when it touches the UI.

## Where things go

- `src/` is sorted by feature: `start/`, `editor/`, `export/`, `agent/`, `settings/`. Code with no UI goes in `model/` (projects, slides, rendering, templates), `devices/` or `lib/` (platform helpers). New files go in the folder of the feature they serve; only the entry files sit in `src/` itself.
- `.tsx` files export only components (lint enforces it, for fast refresh). Hooks and helpers live in `.ts` files: `settings/prefs.ts`, `model/templates.ts`, `editor/history.ts` and so on.
- Edits to a slide go through `model/elements.ts`: each function takes a slide and returns a patch (`Partial<Slide>`). Keep that logic out of components.
- Scripts reach into `src/` by path: `scripts/bump.mjs` (`agent/agent.ts`) and `scripts/openscrgen.mjs` (`model/openscrgen.ts`). Update them when moving those files.
- Anything that differs between the browser and the desktop app goes in `lib/native.ts`. Tauri modules are imported dynamically, so the browser build never loads them.
- One draw function (`model/render.ts`) serves the preview, the export and the agent's `render_slide`. Don't add a second path.
- MCP tools are defined in `agent/tools.ts`. `src-tauri/src/lib.rs` only forwards requests to the webview.
- macOS file names are case-insensitive. Don't add a file that differs from an existing one only in case (for example, `Tools.tsx` next to `tools.ts` in the same folder).

## Style

- Match the surrounding code: 2 spaces, single quotes, no semicolons, long lines are fine.
- Comments: a one-line `/** … */` on exported functions and components saying what they are, and `//` only for a why the code can't show. Use plain, American spelling ("color", "center", "canceled") in comments, UI text and tool descriptions.
- When you take a shortcut with a known limit, mark it `// shortcut: <the limit>, <when to upgrade>`.
- Prefer deleting code to adding it. Reuse an existing helper before writing one (`clamp` in `model/render.ts`, `typing` in `lib/native.ts`, `toDataUrl` and `when` in `model/project.ts`).

## Commits and releases

- Commit messages are one plain imperative sentence ("Add …", "Show …"), with a body only when the why isn't obvious.
- `pnpm release [patch|minor|major|x.y.z]` bumps the version in every file that carries it, tags it and pushes to `main`, which starts the Release workflow. Work happens on `dev`.
