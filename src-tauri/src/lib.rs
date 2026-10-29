use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, Sender};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// ---- MCP bridge -------------------------------------------------------------------
// A local MCP server (streamable HTTP, JSON responses) so Claude Code can drive the app.
// Rust is only the transport: each JSON-RPC request goes to the webview, which owns the
// project state and answers it (src/agent.ts).

// ponytail: fixed port, one app instance; pick a free port and show it if two instances matter
pub const MCP_PORT: u16 = 7457;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
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

    let (mut length, mut origin) = (0usize, false);
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).unwrap_or(0) == 0 || h.trim().is_empty() {
            break;
        }
        let (name, value) = h.split_once(':').unwrap_or((&h, ""));
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => length = value.trim().parse().unwrap_or(0),
            "origin" => origin = true,
            _ => {}
        }
    }

    // Browsers always send Origin; Claude Code doesn't. Refusing it keeps web pages out.
    if origin {
        return reply(&mut stream, "403 Forbidden", "");
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
    match rx.recv_timeout(Duration::from_secs(300)) {
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
            Err(e) => return eprintln!("MCP server not started on port {MCP_PORT}: {e}"),
        };
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || handle(&app, stream));
        }
    });
}

// ---- chat: runs the user's Claude Code, connected to the bridge -------------------

static CHAT: Mutex<Option<Child>> = Mutex::new(None);

/// Runs `claude -p` and streams its stream-json lines as `claude-line` events; resolves when it exits.
#[tauri::command]
async fn claude_chat(app: AppHandle, args: Vec<String>) -> Result<(), String> {
    claude_stop();
    // a login shell, so the PATH from the user's shell config finds `claude`
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .arg("-lic")
        .arg("exec claude \"$@\"")
        .arg("claude")
        .args(args)
        .current_dir(std::env::var("HOME").unwrap_or_else(|_| "/".into()))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
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
            let _ = app.emit("claude-line", line);
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    let status = CHAT.lock().unwrap().take().and_then(|mut c| c.wait().ok());
    let errors = errors.join().unwrap_or_default();
    match status {
        Some(s) if !s.success() => Err(match s.code() {
            Some(127) => "Claude Code wasn't found. Install it from https://claude.com/claude-code".into(),
            _ => errors.lines().filter(|l| !l.contains("job control")).collect::<Vec<_>>().join("\n"),
        }),
        _ => Ok(()),
    }
}

#[tauri::command]
fn claude_stop() {
    if let Some(mut c) = CHAT.lock().unwrap().take() {
        let _ = c.kill();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![mcp_respond, claude_chat, claude_stop])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            serve_mcp(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
