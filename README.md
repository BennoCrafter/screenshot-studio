<p align="center">
  <img src="public/favicon.svg" width="160" />
</p>

<h1 align="center">Screenshot Studio</h1>

<p align="center">
  Make App Store screenshots for iPhone, iPad and Mac.
</p>

<p align="center">
  <img src="assets/screenshots/editor-window.png" width="85%" />
</p>

<p align="center">
  <img src="assets/screenshots/launcher-window.png" width="42%" />
  &nbsp;
  <img src="assets/screenshots/new-project-window.png" width="42%" />
</p>

## Features

- **One project, several platforms**: iPhone, iPad and Mac sets side by side. A new platform starts from an existing one's slides.
- **App Store sizes**: iPhone 6.9", 6.3", 6.5"; iPad 13", 11"; Mac 2880×1800 down to 1280×800.
- **3D device frames** with pose, size and finish controls, including foldables with an outer display.
- **Templates**: built-in designs, plus your own saved from any project (Export → Template), with or without its screenshots. Tick **Share with everyone** and the app opens GitHub's web editor with the template filled in, so you can propose it for `templates/` in this repo.
- **Languages**: add App Store localizations (German, English, Japanese and so on) to a project. Each language has its own headline, subtitle and texts, and can have its own screenshots (a language without one shows the primary language's). Everything else (devices, colors, layout) is shared, so a change shows up in every language.
- **Export** PNGs of the slides and languages you pick. The desktop app writes them all to a folder you pick. Or export one web page that shows them all, with platform and language filters and a click-to-enlarge view.
- **Project files** (`.ssproj`): one JSON file with the screenshots inside, for backup or sharing.
- **AI agent built in** (desktop): a chat panel that runs an AI agent connected to the app. It can see and change everything in the open project while you watch. It can also search the web for images (icons, logos, photos) and download them onto slides. Click any tool call in the chat to see what it sent and what came back.
- **Images and SVGs**: PNG, JPEG, WebP and SVG work as screenshots and as images on slides. SVGs stay sharp at any export size.

## MCP

The desktop app runs an MCP server (streamable HTTP) at `http://127.0.0.1:7457/mcp` while it's open, so any MCP client can work on the live project: Claude Code, Codex, Gemini CLI, Cursor, VS Code and others. Its tools: `get_state`, `update_project`, `render_slide` (the agent sees the slide as it exports), `export_pngs`, `save_project_file`, `update_screenshots`, `create_project`, `open_project`, `close_project` and `delete_project`.

- **In the app**: open the **Agent** tab next to the Inspector in the editor sidebar. For now the panel runs [Claude Code](https://claude.com/claude-code) (`claude -p`) through your login shell, so that needs to be installed and logged in.
- **From any MCP client**: connect it once (Settings shows these too), then ask it to work on your screenshots:

  ```sh
  claude mcp add --scope user --transport http screenshot-studio http://127.0.0.1:7457/mcp
  codex mcp add screenshot-studio --url http://127.0.0.1:7457/mcp
  gemini mcp add --scope user --transport http screenshot-studio http://127.0.0.1:7457/mcp
  code --add-mcp '{"name":"screenshot-studio","type":"http","url":"http://127.0.0.1:7457/mcp"}'
  ```

  Clients configured by JSON (Cursor's `~/.cursor/mcp.json`, Windsurf, Zed…) take this entry:

  ```json
  { "mcpServers": { "screenshot-studio": { "type": "http", "url": "http://127.0.0.1:7457/mcp" } } }
  ```

- **From the terminal**: the app itself is a command line for the same tools, for scripts and automations. It starts the app if it isn't running. On macOS, click Install under Settings › General › Command line once (it links the app into `/usr/local/bin`):

  ```sh
  screenshot-studio projects                               # the saved projects
  screenshot-studio export TrackStar --out out --platform iphone   # PNGs; both options optional
  screenshot-studio save TrackStar TrackStar.ssproj        # the project file
  screenshot-studio render TrackStar 1 --platform ipad     # a preview of slide 1, saved as TrackStar-1.png
  screenshot-studio shots TrackStar home=shots/home.png    # replace screenshots by screenshot ID
  screenshot-studio shots                                  # apply every project's screenshot folder; prints what changed
  screenshot-studio call get_state                         # any MCP tool (screenshot-studio tools lists them)
  screenshot-studio uninstall                              # remove it from /usr/local/bin again
  ```

The server only listens on localhost and refuses requests from web pages (any request with an `Origin` header). Its tools can read screenshots from, and export PNGs to, anything under your home folder, `/tmp` and `/Volumes`.

## Getting started

Requirements: Node.js and [pnpm](https://pnpm.io). The desktop app also needs Rust (the stable toolchain is pinned in `src-tauri/rust-toolchain.toml`) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```sh
pnpm install

pnpm dev            # browser version at http://localhost:5173
pnpm desktop        # desktop app in development mode
pnpm desktop:build  # bundled app in src-tauri/target/release/bundle/
```

Other scripts:

```sh
pnpm build          # type check plus production web build into dist/
pnpm preview        # serve that build
pnpm lint           # oxlint
pnpm cli <command>  # the command line (see MCP above), built and run against the running app
pnpm openscrgen <file.json | post link | template name> [out dir]   # an Open Screenshot Generator project as a template and .ssproj
pnpm tour-images    # the welcome tour's pictures from assets/screenshots/ (needs cwebp: brew install webp)
pnpm bump [patch|minor|major|x.y.z]     # raise the version everywhere it's written
pnpm release [patch|minor|major|x.y.z]  # bump, tag and push to main, which starts the Release workflow
```

## Where data is stored

| | Projects | Saved templates | Settings (welcome tour seen) |
|---|---|---|---|
| Desktop app | `<app data>/projects/<id>/`, which holds `project.json` and one image file per screenshot | `<app data>/templates.json` | `<app data>/settings.json` |
| Browser | IndexedDB (`screenshot-studio`) | localStorage | localStorage |

`<app data>` is the app's data folder for the identifier `app.screenshotstudio.desktop`:

- macOS: `~/Library/Application Support/app.screenshotstudio.desktop`
- Windows: `%APPDATA%\app.screenshotstudio.desktop`
- Linux: `~/.local/share/app.screenshotstudio.desktop`

## Project layout

```
src/
  main.tsx, App.tsx    entry; start page or editor, autosave
  start/               start page, template gallery, opening a project file
  editor/              the editor: board, slide canvas, inspector, palette, themes, language dialog, undo history
  export/              export dialog (PNGs, templates) and the exported website
  agent/               MCP tools (tools.ts), answering requests the Rust side forwards (agent.ts), and the agent chat
  settings/            app settings and the MCP setup; prefs.ts: preferences kept in localStorage
  model/               projects and storage, slides and their elements, the draw function shared by preview and
                       export, templates and themes, Open Screenshot Generator import, the screenshot folder
  devices/             device models and the 3D frame renderer (three.js)
  lib/                 where browser and desktop differ (native.ts); animated view transitions (motion.ts)
  builtin/             built-in templates, themes and filler screenshots
src-tauri/             Tauri desktop shell; src/lib.rs has the MCP HTTP server and runs the agent CLI, src/cli.rs the command line
scripts/               bump and release, Apple signing secrets, Open Screenshot Generator conversion
```

## License

[MIT](LICENSE)
