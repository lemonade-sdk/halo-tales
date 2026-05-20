use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use std::fs::File;
use std::io::{Cursor, Read, Write};
use std::path::Path;
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub stage: String, // "download" | "extract" | "done"
    pub bytes: u64,
    pub total: u64,
    pub message: String,
}

/// Stream-download `url` to `dest_path`, emitting `progress_event` along the way.
pub async fn download_to_file<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
    dest_path: &Path,
    progress_event: &str,
) -> Result<()> {
    let client = reqwest::Client::builder()
        .user_agent("halo-tales/0.1")
        .build()?;
    let resp = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?;
    if !resp.status().is_success() {
        bail!("HTTP {} fetching {}", resp.status(), url);
    }
    let total = resp.content_length().unwrap_or(0);
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = File::create(dest_path)?;
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed().as_millis() > 250 {
            let _ = app.emit(
                progress_event,
                DownloadProgress {
                    stage: "download".into(),
                    bytes: downloaded,
                    total,
                    message: format!("{} / {}", human(downloaded), human(total)),
                },
            );
            last_emit = std::time::Instant::now();
        }
    }
    file.flush()?;
    let _ = app.emit(
        progress_event,
        DownloadProgress {
            stage: "download".into(),
            bytes: downloaded,
            total,
            message: "download complete".into(),
        },
    );
    Ok(())
}

/// Extract a zip or tar.gz archive into `dest_dir`. Strips a single
/// top-level directory if every entry shares the same prefix — the
/// embeddable lemonade archives use this layout.
pub fn extract_archive(archive_path: &Path, dest_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(dest_dir)?;
    let name = archive_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if name.ends_with(".zip") {
        extract_zip(archive_path, dest_dir)
    } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        extract_tar_gz(archive_path, dest_dir)
    } else {
        bail!("unsupported archive type: {}", name);
    }
}

fn extract_zip(archive_path: &Path, dest_dir: &Path) -> Result<()> {
    let file = File::open(archive_path)?;
    let mut buf = Vec::new();
    let mut reader = std::io::BufReader::new(file);
    reader.read_to_end(&mut buf)?;
    let mut archive = zip::ZipArchive::new(Cursor::new(buf))?;
    let strip = common_prefix_zip(&mut archive);
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let raw = entry.mangled_name();
        let relative = match strip_prefix(&raw, &strip) {
            Some(r) => r,
            None => continue,
        };
        let out_path = dest_dir.join(&relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out_file = File::create(&out_path)?;
        std::io::copy(&mut entry, &mut out_file)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = entry.unix_mode() {
                std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(mode)).ok();
            }
        }
    }
    Ok(())
}

fn extract_tar_gz(archive_path: &Path, dest_dir: &Path) -> Result<()> {
    let file = File::open(archive_path)?;
    let gz = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(gz);
    archive.set_preserve_permissions(true);
    let entries = archive.entries()?;
    // tar entries are streamed — we can't pre-scan for a common prefix
    // without holding all of them in memory. The embeddable archives unpack
    // into a known top-level dir name like `lemonade-embeddable-VERSION/`,
    // so strip the first path component if multiple entries share it.
    let mut common: Option<String> = None;
    let mut pending: Vec<(std::path::PathBuf, Vec<u8>, tar::EntryType, u32)> = Vec::new();
    for entry in entries {
        let mut entry = entry?;
        let path = entry.path()?.to_path_buf();
        let kind = entry.header().entry_type();
        let mode = entry.header().mode().unwrap_or(0o644);
        let mut buf = Vec::new();
        if kind == tar::EntryType::Regular {
            entry.read_to_end(&mut buf)?;
        }
        let first = path
            .components()
            .next()
            .and_then(|c| c.as_os_str().to_str())
            .unwrap_or("")
            .to_string();
        common = match common {
            None => Some(first),
            Some(existing) if existing == first => Some(existing),
            Some(_) => Some(String::new()),
        };
        pending.push((path, buf, kind, mode));
    }
    let strip = common.unwrap_or_default();
    for (path, buf, kind, mode) in pending {
        let relative: std::path::PathBuf = if !strip.is_empty()
            && path.starts_with(&strip)
        {
            path.strip_prefix(&strip)?.to_path_buf()
        } else {
            path
        };
        if relative.as_os_str().is_empty() {
            continue;
        }
        let out_path = dest_dir.join(&relative);
        match kind {
            tar::EntryType::Directory => {
                std::fs::create_dir_all(&out_path)?;
            }
            tar::EntryType::Regular => {
                if let Some(parent) = out_path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let mut f = File::create(&out_path)?;
                f.write_all(&buf)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(mode))
                        .ok();
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn common_prefix_zip<R: Read + std::io::Seek>(archive: &mut zip::ZipArchive<R>) -> String {
    let mut prefix: Option<String> = None;
    for i in 0..archive.len() {
        let Ok(entry) = archive.by_index(i) else {
            continue;
        };
        let name = entry.mangled_name();
        let first = name
            .components()
            .next()
            .and_then(|c| c.as_os_str().to_str())
            .unwrap_or("")
            .to_string();
        prefix = match prefix {
            None => Some(first),
            Some(p) if p == first => Some(p),
            Some(_) => Some(String::new()),
        };
    }
    prefix.unwrap_or_default()
}

fn strip_prefix(p: &std::path::Path, prefix: &str) -> Option<std::path::PathBuf> {
    if prefix.is_empty() {
        return Some(p.to_path_buf());
    }
    let stripped = p.strip_prefix(prefix).ok()?;
    if stripped.as_os_str().is_empty() {
        None
    } else {
        Some(stripped.to_path_buf())
    }
}

fn human(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * 1024;
    const GB: u64 = 1024 * 1024 * 1024;
    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.0} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}
