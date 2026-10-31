# Screenshot Studio

Make App Store screenshots for iPhone, iPad and Mac. Each slide has a gradient background, a title and subtitle, and your screenshot inside a 3D device frame. What you see in the editor is exactly what gets exported.

It runs in the browser or as a desktop app built with [Tauri](https://tauri.app).

## Features

- **One project, several platforms**: iPhone, iPad and Mac sets side by side. A new platform starts from an existing one's slides.
- **App Store sizes**: iPhone 6.9", 6.3", 6.5"; iPad 13", 11"; Mac 2880×1800 down to 1280×800.
- **3D device frames** with pose, size and finish controls, including foldables with an outer display.
- **Templates**: built-in designs, plus your own saved from any project (Export → Template), with or without its screenshots. Tick **Share with everyone** and the app opens a pull request adding it to `templates/` in this repo, using your GitHub CLI login.
- **Languages**: add App Store localizations (German, English, Japanese and so on) to a project. Each language has its own headline and subtitle. Everything else (screenshots, devices, colours, layout) is shared, so a change shows up in every language.
- **Export** PNGs of the slides and languages you pick. The desktop app writes them all to a folder you pick.
- **Project files** (`.ssproj`): one JSON file with the screenshots inside, for backup or sharing.
- **Autosave**: projects are saved as you edit.
- **Claude built in** (desktop): a chat panel that runs your installed Claude Code. Claude can see and change everything in the open project while you watch. It can also search the web for images (icons, logos, photos) and download them onto slides. Click any tool call in the chat to see what it sent and what came back.
- **Images and SVGs**: PNG, JPEG, WebP and SVG work as screenshots and as images on slides. SVGs stay sharp at any export size.

## Claude and MCP

The desktop app runs an MCP server at `http://127.0.0.1:7457/mcp` while it's open. Its tools work on the live project: `get_state`, `update_project`, `render_slide` (Claude sees the slide as it exports), `export_pngs`, `create_project`, `open_project`, `close_project` and `delete_project`.

- **In the app**: open the **Claude** tab next to the Inspector in the editor sidebar. This needs [Claude Code](https://claude.com/claude-code) installed and logged in, because the panel runs `claude -p` through your login shell.
- **From any Claude Code session**: connect it once, then ask it to work on your screenshots:

  ```sh
  claude mcp add --transport http screenshot-studio http://127.0.0.1:7457/mcp
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

Other scripts: `pnpm build` (type check plus production web build into `dist/`) and `pnpm lint` (oxlint).

## Where data is stored

| | Projects | Saved templates |
|---|---|---|
| Desktop app | `<app data>/projects/<id>/`, which holds `project.json` and one image file per screenshot | `<app data>/templates.json` |
| Browser | IndexedDB (`screenshot-studio`) | localStorage |

`<app data>` is the app's data folder for the identifier `app.screenshotstudio.desktop`:

- macOS: `~/Library/Application Support/app.screenshotstudio.desktop`
- Windows: `%APPDATA%\app.screenshotstudio.desktop`
- Linux: `~/.local/share/app.screenshotstudio.desktop`

## Project layout

```
src/
  App.tsx            start page or editor; autosave
  StartPage.tsx      new project, open file, recent projects
  Editor.tsx         slide editor, platforms, export
  render.ts          the draw function shared by preview and export; platforms and sizes
  devices/           device models and the 3D frame renderer (three.js)
  templates.ts       built-in and saved templates
  project.ts         storage, plus .ssproj import and export
  native.ts          where browser and desktop differ: dialogs, saving and opening files
  agent.ts           MCP tools, answering requests the Rust side forwards
  Chat.tsx           the Claude chat, a tab of the editor sidebar
  motion.ts          animated view transitions
src-tauri/           Tauri desktop shell; src/lib.rs has the MCP HTTP server and runs `claude`
```

## License

[MIT](LICENSE)
