// ---- command line ---------------------------------------------------------------------
// `app <command> …` drives the app through its MCP server, starting the app first if it isn't
// running; rendering needs the webview, so the command line never draws anything itself.

use base64::Engine;
use serde_json::{json, Value};
use std::io::{IsTerminal, Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

const USAGE: &str = r#"Usage: screenshot-studio <command>
  --version                               the app's version, and whether it's a dev build
  tools                                   list the tools and their arguments
  <tool> [key=value …]                    values are JSON when they parse, else strings
  <tool> '{"…": …}'  or  <tool> -         arguments as one JSON object (- reads stdin)
  export <project name> [dir] [platform]  PNGs of a saved project (default dir: here)
  export <project name> <file.ssproj>     the project as a project file
Text results go to stdout; images are saved as <tool>-<n>.png in the current folder."#;

/// Whether the arguments are a command, not files the OS asks the app to open (or macOS's old -psn_ one).
pub fn wanted(args: &[String]) -> bool {
    args.first().is_some_and(|a| !a.starts_with("-psn") && !a.ends_with(".ssproj"))
}

/// Runs the command; the process exit code.
pub fn main(args: Vec<String>) -> i32 {
    #[cfg(windows)]
    {
        // release builds are GUI apps on Windows, with no console to print to unless they borrow the terminal's
        unsafe extern "system" {
            fn AttachConsole(pid: u32) -> i32;
        }
        unsafe { AttachConsole(u32::MAX) };
    }
    match run(&args) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{} {e}", paint("1;31", "error:", true));
            1
        }
    }
}

fn run(args: &[String]) -> Result<(), String> {
    let (command, rest) = (args[0].as_str(), &args[1..]);
    if matches!(command, "-h" | "--help" | "help") {
        println!("{}", USAGE.replacen("Usage:", &paint("1", "Usage:", false), 1));
        return Ok(());
    }
    if matches!(command, "-v" | "-V" | "--version" | "version") {
        println!("screenshot-studio {}{}", env!("CARGO_PKG_VERSION"), if cfg!(debug_assertions) { " (dev)" } else { "" });
        return Ok(());
    }
    connect()?;
    match command {
        "tools" => {
            let tools = rpc("tools/list", json!({}), None)?["tools"].as_array().cloned().unwrap_or_default();
            let width = tools.iter().filter_map(|t| t["name"].as_str()).map(str::len).max().unwrap_or(0);
            for t in &tools {
                let schema = &t["inputSchema"];
                let required = |p: &str| schema["required"].as_array().is_some_and(|r| r.iter().any(|x| x == p));
                let props: Vec<String> = schema["properties"].as_object().into_iter().flatten()
                    .map(|(p, _)| if required(p) { p.clone() } else { format!("[{p}]") })
                    .collect();
                let description = t["description"].as_str().unwrap_or("").lines().next().unwrap_or("");
                let name = format!("{:width$}", t["name"].as_str().unwrap_or(""));
                println!("{}  {description}", paint("1;36", &name, false));
                if !props.is_empty() {
                    println!("{:width$}  {}", "", paint("2", &props.join(" "), false));
                }
            }
            Ok(())
        }
        "export" => export(rest),
        _ => tool(command, arguments(rest)?, false).map(|_| ()),
    }
}

/// Exports a saved project by name: its PNGs, or the project file.
fn export(rest: &[String]) -> Result<(), String> {
    let (Some(name), dir, platform) = (rest.first(), rest.get(1).map_or(".", String::as_str), rest.get(2)) else {
        return Err("Usage: screenshot-studio export <project name> [dir] [platform]".into());
    };
    let dir = std::path::absolute(dir).map_err(|e| e.to_string())?;
    if dir.extension().is_some_and(|e| e == "ssproj") {
        return tool("save_project_file", json!({ "project": name, "path": dir.to_string_lossy() }), false).map(|_| ());
    }
    let mut a = json!({ "project": name, "dir": dir.to_string_lossy() });
    if let Some(p) = platform {
        a["platform"] = json!(p);
    }
    tool("export_pngs", a, false).map(|_| ())
}

/// The tool's arguments: key=value pairs, one JSON object, or JSON on stdin.
fn arguments(rest: &[String]) -> Result<Value, String> {
    let parse = |s: &str| serde_json::from_str::<Value>(s).map_err(|e| e.to_string());
    match rest.first().map(String::as_str) {
        Some("-") => {
            let mut s = String::new();
            std::io::stdin().read_to_string(&mut s).map_err(|e| e.to_string())?;
            parse(&s)
        }
        Some(a) if a.starts_with('{') => parse(a),
        _ => rest.iter()
            .map(|kv| match kv.split_once('=') {
                Some((k, v)) if !k.is_empty() => Ok((k.to_string(), serde_json::from_str(v).unwrap_or_else(|_| json!(v)))),
                _ => Err(format!("Expected key=value, got {kv}")),
            })
            .collect::<Result<serde_json::Map<_, _>, _>>()
            .map(Value::Object),
    }
}

/// Calls a tool and prints its result (quiet: only errors and images); images go to <tool>-<n>.png.
fn tool(name: &str, arguments: Value, quiet: bool) -> Result<Value, String> {
    let r = rpc("tools/call", json!({ "name": name, "arguments": arguments }), None)?;
    let failed = r["isError"].as_bool().unwrap_or(false);
    let mut n = 0;
    for c in r["content"].as_array().into_iter().flatten() {
        match c["type"].as_str() {
            Some("text") if failed => eprintln!("{}", paint("31", c["text"].as_str().unwrap_or(""), true)),
            Some("text") if !quiet => println!("{}", pretty(c["text"].as_str().unwrap_or(""))),
            Some("image") => {
                n += 1;
                let file = format!("{name}-{n}.png");
                let png = base64::engine::general_purpose::STANDARD.decode(c["data"].as_str().unwrap_or("")).map_err(|e| e.to_string())?;
                std::fs::write(&file, png).map_err(|e| format!("{file}: {e}"))?;
                println!("{}", paint("32", &file, false));
            }
            _ => {}
        }
    }
    if failed {
        return Err(format!("{name} failed"));
    }
    Ok(r)
}

/// The text wrapped in an ANSI style when it goes to a terminal and NO_COLOR isn't set.
fn paint(style: &str, text: &str, stderr: bool) -> String {
    let tty = if stderr { std::io::stderr().is_terminal() } else { std::io::stdout().is_terminal() };
    if tty && std::env::var_os("NO_COLOR").is_none() { format!("\x1b[{style}m{text}\x1b[0m") } else { text.into() }
}

/// JSON text indented for a terminal; anything else, and anything piped, as it came.
fn pretty(text: &str) -> String {
    match serde_json::from_str::<Value>(text) {
        Ok(v) if std::io::stdout().is_terminal() => serde_json::to_string_pretty(&v).unwrap_or_else(|_| text.into()),
        _ => text.into(),
    }
}

/// One JSON-RPC request to the app's MCP server; its result.
fn rpc(method: &str, params: Value, timeout: Option<Duration>) -> Result<Value, String> {
    let mut s = TcpStream::connect(("127.0.0.1", crate::MCP_PORT)).map_err(|e| e.to_string())?;
    s.set_read_timeout(timeout).map_err(|e| e.to_string())?;
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }).to_string();
    write!(s, "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len())
        .map_err(|e| e.to_string())?;
    let mut res = String::new();
    s.read_to_string(&mut res).map_err(|e| e.to_string())?;
    let (head, body) = res.split_once("\r\n\r\n").unwrap_or((&res, ""));
    if !head.starts_with("HTTP/1.1 200") {
        return Err(format!("{} {body}", head.lines().next().unwrap_or("")).trim().into());
    }
    let v: Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
    match v.get("error") {
        Some(e) => Err(e["message"].as_str().unwrap_or("MCP error").into()),
        None => Ok(v["result"].clone()),
    }
}

/// Starts the app if nothing listens on its port, then waits until its webview answers.
fn connect() -> Result<(), String> {
    if TcpStream::connect(("127.0.0.1", crate::MCP_PORT)).is_err() {
        eprintln!("{}", paint("2", "Starting Screenshot Studio…", true));
        let mut c = std::process::Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
        c.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        #[cfg(unix)]
        std::os::unix::process::CommandExt::process_group(&mut c, 0); // so Ctrl-C here doesn't quit the app
        c.spawn().map_err(|e| e.to_string())?;
    }
    let start = Instant::now();
    loop {
        match rpc("ping", json!({}), Some(Duration::from_secs(2))) {
            Ok(_) => return Ok(()),
            Err(e) if e.starts_with("HTTP/") => return Err(e), // e.g. 403: Settings shut other clients out
            Err(_) if start.elapsed() > Duration::from_secs(60) => return Err(format!("Screenshot Studio didn't answer on port {}", crate::MCP_PORT)),
            Err(_) => std::thread::sleep(Duration::from_millis(500)),
        }
    }
}

// ---- installing it ----------------------------------------------------------------------

const LINK: &str = "/usr/local/bin/screenshot-studio";

/// Whether `screenshot-studio` on the PATH is this app (macOS).
#[tauri::command]
pub fn cli_linked() -> bool {
    std::fs::read_link(LINK).ok().zip(std::env::current_exe().ok()).is_some_and(|(l, e)| l == e)
}

/// The shell command that does what cli_link does, for people who'd rather run it themselves.
#[tauri::command]
pub fn cli_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(format!("sudo mkdir -p /usr/local/bin && sudo ln -sf '{}' {LINK}", exe.to_string_lossy().replace('\'', r"'\''")))
}

/// Links `screenshot-studio` in /usr/local/bin to this app, asking for an admin password when the folder needs one (macOS).
#[tauri::command]
pub fn cli_link() -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Installing the command line is macOS only".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let o = std::process::Command::new("osascript")
        .args(["-e", "on run argv", "-e", &format!(r#"do shell script "mkdir -p /usr/local/bin && ln -sf " & quoted form of item 1 of argv & " {LINK}" with administrator privileges"#), "-e", "end run"])
        .arg(exe)
        .output()
        .map_err(|e| e.to_string())?;
    if o.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&o.stderr).trim().into()) }
}
