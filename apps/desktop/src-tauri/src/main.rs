// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;
use std::process::ExitCode;

/// Multi-call dispatch: a symlink named `inkra` in the user's PATH points
/// at the Inkra app binary. When invoked through that symlink, argv[0]'s
/// basename is `inkra` and we run the CLI. Invoked as `Inkra` (the usual
/// case, direct from the bundle), we run the Tauri app.
fn main() -> ExitCode {
    // First statement on purpose: this is the zero point every native startup
    // mark is measured from, and it is the only thing that can be compared with
    // the WebView's `performance.timeOrigin`.
    desktop_lib::startup_metrics::init();

    if is_cli_invocation() {
        let argv: Vec<_> = std::env::args_os().collect();
        let cwd = std::env::current_dir().unwrap_or_else(|_| Path::new(".").into());
        return desktop_lib::inkra_cli::run(argv, &cwd, &desktop_lib::inkra_cli::SystemLauncher);
    }
    desktop_lib::run();
    ExitCode::SUCCESS
}

fn is_cli_invocation() -> bool {
    let Some(arg0) = std::env::args_os().next() else {
        return false;
    };
    Path::new(&arg0)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|name| name.eq_ignore_ascii_case("inkra"))
        .unwrap_or(false)
}
