pub mod cli;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, Sender};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
use tauri::{AppHandle, Emitter};

// ---- MCP bridge -------------------------------------------------------------------
// A local MCP server (streamable HTTP, JSON responses) so any MCP client can drive the app.
// Rust is only the transport: each JSON-RPC request goes to the webview, which owns the
// project state and answers it (src/agent.ts).

// ponytail: fixed port, one app instance; pick a free port and show it if two instances matter
pub const MCP_PORT: u16 = 7457;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
/// Whether other MCP clients (terminal agents, editors) may use the server; the app's own chat always can.
static OTHERS_ALLOWED: AtomicBool = AtomicBool::new(true);

/// A secret made at launch that the app's own chat sends, so it gets through when others are shut out.
fn chat_token() -> &'static str {
    static TOKEN: OnceLock<String> = OnceLock::new();
    TOKEN.get_or_init(|| {
        use std::hash::{BuildHasher, Hasher};
        let h = || std::collections::hash_map::RandomState::new().build_hasher().finish();
        format!("{:016x}{:016x}", h(), h())
    })
}

#[tauri::command]
fn mcp_chat_token() -> String {
    chat_token().into()
}

#[tauri::command]
fn mcp_allow_others(on: bool) {
    OTHERS_ALLOWED.store(on, Ordering::Relaxed);
}
static PENDING: Mutex<Option<HashMap<u64, Sender<String>>>> = Mutex::new(None);

#[derive(Clone, serde::Serialize)]
struct McpRequest {
    id: u64,
    body: String,
}

#[tauri::command]
fn mcp_respond(id: u64, body: String) {
    if let Some(tx) = PENDING.lock().unwrap().as_mut().and_then(|p| p.remove(&id)) {
        let _ = tx.send(body);
    }
}

fn reply(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

fn handle(app: &AppHandle, mut stream: TcpStream) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let mut parts = line.split_whitespace();
    let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));

    let (mut length, mut origin, mut ours) = (0usize, false, false);
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).unwrap_or(0) == 0 || h.trim().is_empty() {
            break;
        }
        let (name, value) = h.split_once(':').unwrap_or((&h, ""));
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => length = value.trim().parse().unwrap_or(0),
            "origin" => origin = true,
            "authorization" => ours = value.trim() == format!("Bearer {}", chat_token()),
            _ => {}
        }
    }

    // Browsers always send Origin; MCP clients don't. Refusing it keeps web pages out.
    if origin {
        return reply(&mut stream, "403 Forbidden", "");
    }
    if !ours && !OTHERS_ALLOWED.load(Ordering::Relaxed) {
        return reply(&mut stream, "403 Forbidden", r#"{"error":"Screenshot Studio is set not to accept other MCP clients (Settings)."}"#);
    }
    if path.split('?').next() != Some("/mcp") {
        return reply(&mut stream, "404 Not Found", "");
    }
    if method != "POST" {
        return reply(&mut stream, "405 Method Not Allowed", "");
    }
    let mut body = vec![0; length.min(64 << 20)];
    if reader.read_exact(&mut body).is_err() {
        return;
    }
    let body = String::from_utf8_lossy(&body).into_owned();

    // notifications and responses carry no id and need no answer
    let is_request = serde_json::from_str::<serde_json::Value>(&body)
        .map(|v| v.get("id").is_some() && v.get("method").is_some())
        .unwrap_or(false);
    if !is_request {
        return reply(&mut stream, "202 Accepted", "");
    }

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = channel();
    PENDING.lock().unwrap().get_or_insert_with(HashMap::new).insert(id, tx);
    let _ = app.emit("mcp-request", McpRequest { id, body });
    // long, since an approval waits for the user
    match rx.recv_timeout(Duration::from_secs(1800)) {
        Ok(answer) => reply(&mut stream, "200 OK", &answer),
        Err(_) => {
            PENDING.lock().unwrap().as_mut().map(|p| p.remove(&id));
            reply(&mut stream, "504 Gateway Timeout", "")
        }
    }
}

fn serve_mcp(app: AppHandle) {
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", MCP_PORT)) {
            Ok(l) => l,
            Err(e) => return log::error!("MCP server not started on port {MCP_PORT}: {e}"),
        };
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || handle(&app, stream));
        }
    });
}

// ---- chat: runs the user's agent CLI, connected to the bridge ---------------------

static CHAT: Mutex<Option<Child>> = Mutex::new(None);

/// A command-line tool the user installed (`claude`, `gh`), started from the home folder. On macOS and
/// Linux it goes through a login shell, so the PATH from their shell config finds it.
#[cfg(unix)]
fn cli(program: &'static str) -> Command {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let mut c = Command::new(shell);
    c.arg("-lic").arg(format!("exec {program} \"$@\"")).arg(program);
    c.current_dir(std::env::var("HOME").unwrap_or_else(|_| "/".into()));
    c
}
#[cfg(windows)]
fn cli(program: &'static str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut c = Command::new(program);
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing up
    if let Ok(home) = std::env::var("USERPROFILE") {
        c.current_dir(home);
    }
    c
}
const NOT_INSTALLED: &str = "Claude Code wasn't found. Install it from https://claude.com/claude-code";

/// Runs the agent (`claude -p` for now) and streams its stream-json lines as `agent-line` events; resolves when it exits.
#[tauri::command]
async fn agent_chat(app: AppHandle, args: Vec<String>) -> Result<(), String> {
    agent_stop();
    let mut child = cli("claude")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { NOT_INSTALLED.into() } else { e.to_string() })?;
    let stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    *CHAT.lock().unwrap() = Some(child);

    let errors = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    tauri::async_runtime::spawn_blocking(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app.emit("agent-line", line);
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    let status = CHAT.lock().unwrap().take().and_then(|mut c| c.wait().ok());
    let errors = errors.join().unwrap_or_default();
    if !errors.is_empty() {
        log::warn!("agent stderr: {errors}");
    }
    match status {
        Some(s) if !s.success() => Err(match s.code() {
            Some(127) => NOT_INSTALLED.into(),
            _ => errors.lines().filter(|l| !l.contains("job control")).collect::<Vec<_>>().join("\n"),
        }),
        _ => Ok(()),
    }
}

/// The models the installed Claude Code offers (name, description, effort levels), from its initialize handshake.
#[tauri::command]
async fn agent_models() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut child = cli("claude")
            .args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { NOT_INSTALLED.into() } else { e.to_string() })?;
        // stdin stays open until the answer is in, or it would start a turn with no prompt
        let mut stdin = child.stdin.take().unwrap();
        writeln!(stdin, r#"{{"type":"control_request","request_id":"models","request":{{"subtype":"initialize"}}}}"#).map_err(|e| e.to_string())?;
        let models = BufReader::new(child.stdout.take().unwrap())
            .lines()
            .map_while(Result::ok)
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(&l).ok())
            .find(|v| v["type"] == "control_response")
            .map(|v| v["response"]["response"]["models"].clone());
        let _ = child.kill();
        let _ = child.wait();
        models.filter(|m| m.is_array()).ok_or_else(|| "Claude Code didn't list its models".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Whether the terminal Claude Code has this app's MCP server added (user scope, so any directory).
#[tauri::command]
async fn claude_mcp_added() -> bool {
    cli("claude")
        .args(["mcp", "get", "screenshot-studio"])
        .stdin(Stdio::null())
        .output()
        .is_ok_and(|o| o.status.success())
}

/// Removes this app's MCP server from the terminal Claude Code: undoes the `claude mcp add` Settings shows.
#[tauri::command]
async fn claude_mcp_remove() -> Result<(), String> {
    let o = cli("claude")
        .args(["mcp", "remove", "screenshot-studio"])
        .stdin(Stdio::null())
        .output()
        .map_err(|_| NOT_INSTALLED.to_string())?;
    if o.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&o.stderr).trim().into()) }
}

/// Opens a web link in the default browser; only https links, so the page can't launch anything else.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // file:// only for pages the app saved, like the exported website
    if !url.starts_with("https://") && !(url.starts_with("file://") && url.ends_with(".html")) {
        return Err("only https links and local .html pages".into());
    }
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(windows)]
    let opener = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let opener = "xdg-open";
    Command::new(opener).arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

const NO_GH: &str = "The GitHub CLI isn't installed. Get it from https://cli.github.com and run `gh auth login`.";

/// Runs the GitHub CLI with `input` on stdin; its output, or why it failed.
#[tauri::command]
async fn gh(args: Vec<String>, input: Option<String>) -> Result<String, String> {
    use std::io::Write;
    let mut child = cli("gh")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { NO_GH.into() } else { e.to_string() })?;
    let mut stdin = child.stdin.take().unwrap();
    std::thread::spawn(move || stdin.write_all(input.unwrap_or_default().as_bytes()));
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    match out.status.code() {
        Some(0) => Ok(String::from_utf8_lossy(&out.stdout).trim().into()),
        Some(127) => Err(NO_GH.into()),
        _ => Err(String::from_utf8_lossy(&out.stderr).lines().filter(|l| !l.contains("job control")).collect::<Vec<_>>().join("\n")),
    }
}

#[tauri::command]
fn agent_stop() {
    if let Some(mut c) = CHAT.lock().unwrap().take() {
        let _ = c.kill();
    }
}

// ---- project files opened from Finder / Explorer ------------------------------------

/// Contents of .ssproj files the OS asked us to open, until the webview takes them.
static OPENED: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn opened(app: &AppHandle, paths: impl IntoIterator<Item = std::path::PathBuf>) {
    let texts = paths.into_iter().filter(|p| p.extension().is_some_and(|e| e == "ssproj")).filter_map(|p| std::fs::read_to_string(p).ok());
    OPENED.lock().unwrap().extend(texts);
    let _ = app.emit("files-opened", ());
}

#[tauri::command]
fn take_opened_files() -> Vec<String> {
    std::mem::take(&mut OPENED.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // stdout + ~/Library/Logs/<identifier>/ (or the platform's log dir); the frontend logs here too
        .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).max_file_size(5_000_000).build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![mcp_respond, agent_chat, agent_models, agent_stop, claude_mcp_added, claude_mcp_remove, open_url, gh, mcp_chat_token, mcp_allow_others, take_opened_files])
        .setup(|app| {
            let menu = Menu::default(app.handle())?;
            if let Some(MenuItemKind::Submenu(first)) = menu.items()?.into_iter().next() {
                first.insert(&PredefinedMenuItem::separator(app)?, 2)?;
                first.insert(&MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?, 2)?;
            }
            app.set_menu(menu)?;
            serve_mcp(app.handle().clone());
            // Windows and Linux pass the opened file as an argument; macOS sends RunEvent::Opened
            opened(app.handle(), std::env::args_os().skip(1).map(Into::into));
            Ok(())
        })
        .on_menu_event(|app, e| {
            if e.id() == "settings" {
                let _ = app.emit("open-settings", ());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _e| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _e {
                opened(_app, urls.into_iter().filter_map(|u| u.to_file_path().ok()));
            }
        });
}
