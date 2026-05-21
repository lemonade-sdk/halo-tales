use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::paths;

static LOG_LOCK: Mutex<()> = Mutex::new(());

pub fn log_file_path() -> PathBuf {
    paths::root().join("halo-tales.log")
}

fn timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    format!("{:.3}", secs)
}

fn write_line(level: &str, scope: &str, message: &str) {
    let line = format!("[{}] {:<5} {}: {}\n", timestamp(), level, scope, message);
    eprint!("{}", line);
    let _ = std::fs::create_dir_all(paths::root());
    let path = log_file_path();
    let _guard = LOG_LOCK.lock();
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Renderer-side log bridge. JS calls this so messages land in the same file
/// as Rust-side logs, and we get a single source of truth for app events.
#[tauri::command]
pub fn log_event(level: String, scope: String, message: String) {
    write_line(&level, &scope, &message);
}

/// Rust-side convenience used by the rest of the crate. Mirrors eprintln! but
/// also appends to the unified log file.
pub fn rust_log(level: &str, scope: &str, message: &str) {
    write_line(level, scope, message);
}

#[macro_export]
macro_rules! hlog {
    ($level:expr, $scope:expr, $($arg:tt)*) => {
        $crate::logging::rust_log($level, $scope, &format!($($arg)*))
    };
}
