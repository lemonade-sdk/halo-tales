use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

/// Root of all HaloTales runtime state.
///
/// We deliberately use `~/.cache/halo-tales/` (per the project spec) rather
/// than Tauri's `app_cache_dir`, so that uninstalling the app does not wipe
/// the user's stories or the (large) downloaded lemonade install.
pub fn root() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        home.join(".cache").join("halo-tales")
    } else {
        PathBuf::from(".halo-tales")
    }
}

pub fn stories_root() -> PathBuf {
    root().join("stories")
}

pub fn story_dir(story_id: &str) -> PathBuf {
    stories_root().join(sanitize_id(story_id))
}

pub fn embedded_lemonade_dir() -> PathBuf {
    root().join("embedded-lemonade")
}

pub fn ensure_root<R: Runtime>(_app: &AppHandle<R>) -> std::io::Result<()> {
    fs::create_dir_all(root())?;
    fs::create_dir_all(stories_root())?;
    Ok(())
}

/// Permits only [a-zA-Z0-9_-], so a malicious story_id from the renderer
/// cannot escape the stories directory via traversal.
pub fn sanitize_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

pub fn sanitize_filename(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect()
}

