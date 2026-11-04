// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if app_lib::cli::wanted(&args) {
        std::process::exit(app_lib::cli::main(args));
    }
    app_lib::run();
}
