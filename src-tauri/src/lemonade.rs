use anyhow::{bail, Context, Result};
use rand::Rng;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};
use tokio::process::{Child, Command};

use crate::download::{download_to_file, extract_archive};
use crate::paths;

/// Default port the standalone Lemonade desktop install listens on.
pub const DEFAULT_LEMONADE_PORT: u16 = 13305;

/// Pinned embeddable release. Bump together when upgrading.
///
/// The release archives are published by the lemonade-sdk team — see
/// https://lemonade-server.ai/docs/embeddable/ for the canonical
/// distribution channel.
const EMBEDDABLE_VERSION: &str = "10.1.0";
const EMBEDDABLE_BASE_URL: &str =
    "https://github.com/lemonade-sdk/lemonade/releases/download";

#[derive(Default)]
pub struct LemonadeState {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    child: Option<Child>,
    endpoint: Option<Endpoint>,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Endpoint {
    pub base_url: String,
    pub api_key: Option<String>,
    pub source: EndpointSource,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EndpointSource {
    System,
    Embedded,
}

impl LemonadeState {
    pub fn get_endpoint(&self) -> Option<Endpoint> {
        self.inner.lock().ok().and_then(|g| g.endpoint.clone())
    }

    pub fn set_endpoint(&self, endpoint: Endpoint) {
        if let Ok(mut g) = self.inner.lock() {
            g.endpoint = Some(endpoint);
        }
    }

    pub fn set_child(&self, child: Child) {
        if let Ok(mut g) = self.inner.lock() {
            g.child = Some(child);
        }
    }

    pub fn take_child(&self) -> Option<Child> {
        self.inner.lock().ok().and_then(|mut g| g.child.take())
    }
}

/// Probe an URL for liveness. Returns Ok(()) if `/api/v1/health` returns 200.
pub async fn probe_with_key(base_url: &str, api_key: Option<&str>) -> Result<()> {
    let url = format!("{base_url}/api/v1/health");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()?;
    let mut req = client.get(&url);
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }
    let resp = req.send().await?;
    if !resp.status().is_success() {
        bail!("health probe returned {}", resp.status());
    }
    Ok(())
}

pub fn embedded_binary_path() -> PathBuf {
    let dir = paths::embedded_lemonade_dir();
    if cfg!(windows) {
        dir.join("lemond.exe")
    } else {
        dir.join("lemond")
    }
}

pub fn embedded_archive_url() -> Result<String> {
    let (target, ext) = if cfg!(target_os = "windows") {
        ("windows-x64", "zip")
    } else if cfg!(target_os = "macos") {
        ("macos-arm64", "tar.gz")
    } else if cfg!(target_os = "linux") {
        ("ubuntu-x64", "tar.gz")
    } else {
        bail!("unsupported platform for embedded lemonade");
    };
    Ok(format!(
        "{EMBEDDABLE_BASE_URL}/v{EMBEDDABLE_VERSION}/lemonade-embeddable-{EMBEDDABLE_VERSION}-{target}.{ext}"
    ))
}

/// Download + extract the embeddable lemonade archive if not already present.
pub async fn ensure_installed<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let bin = embedded_binary_path();
    if bin.exists() {
        return Ok(());
    }
    let url = embedded_archive_url()?;
    let dir = paths::embedded_lemonade_dir();
    std::fs::create_dir_all(&dir).context("create embedded dir")?;
    let archive_name = url.rsplit('/').next().unwrap_or("lemonade-embeddable");
    let archive_path = dir.join(archive_name);
    download_to_file(app, &url, &archive_path, "lemonade://progress").await?;
    extract_archive(&archive_path, &dir)?;
    std::fs::remove_file(&archive_path).ok();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if bin.exists() {
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).ok();
        }
    }
    if !bin.exists() {
        bail!("lemond binary not present after extraction at {:?}", bin);
    }
    Ok(())
}

/// Spawn the embedded lemond binary and wait for `/v1/health` to come back.
pub async fn spawn_embedded<R: Runtime>(app: &AppHandle<R>) -> Result<Endpoint> {
    // If we already have a child running, return its endpoint.
    let state = app.state::<LemonadeState>();
    if let Some(ep) = state.get_endpoint() {
        if probe_with_key(&ep.base_url, ep.api_key.as_deref()).await.is_ok() {
            return Ok(ep);
        }
    }
    let bin = embedded_binary_path();
    let dir = paths::embedded_lemonade_dir();
    let port = pick_free_port();
    let api_key = random_key();
    let mut cmd = Command::new(&bin);
    cmd.arg(".")
        .arg("--port")
        .arg(port.to_string())
        .current_dir(&dir)
        .env("LEMONADE_API_KEY", &api_key)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let child = cmd
        .spawn()
        .with_context(|| format!("spawn lemond at {:?}", bin))?;
    state.set_child(child);

    let base_url = format!("http://127.0.0.1:{port}");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    loop {
        if probe_with_key(&base_url, Some(&api_key)).await.is_ok() {
            let endpoint = Endpoint {
                base_url,
                api_key: Some(api_key),
                source: EndpointSource::Embedded,
            };
            state.set_endpoint(endpoint.clone());
            return Ok(endpoint);
        }
        if std::time::Instant::now() > deadline {
            bail!("embedded lemonade did not become healthy within 60s");
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

pub fn pick_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr().map(|a| a.port()))
        .unwrap_or(DEFAULT_LEMONADE_PORT)
}

fn random_key() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 24] = rng.gen();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}
