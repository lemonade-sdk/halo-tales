use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::paths::{self, sanitize_filename, sanitize_id};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoryMeta {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub seed_prompt: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default = "default_status")]
    pub status: String, // "active" | "ended"
    #[serde(default)]
    pub thumbnail: Option<String>, // filename relative to story dir
    #[serde(default)]
    pub outcome: Option<String>,
}

fn default_status() -> String {
    "active".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TimelineEntry {
    pub seq: u32,
    pub role: String, // "scene" | "user" | "system"
    pub markdown: String,
    pub image: Option<String>, // filename
    pub audio: Option<String>, // filename
}

fn now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", t)
}

pub fn list_stories() -> Result<Vec<StoryMeta>> {
    let root = paths::stories_root();
    fs::create_dir_all(&root)?;
    let mut metas = Vec::new();
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let meta_path = path.join("meta.json");
        if !meta_path.exists() {
            continue;
        }
        if let Ok(bytes) = fs::read(&meta_path) {
            if let Ok(meta) = serde_json::from_slice::<StoryMeta>(&bytes) {
                metas.push(meta);
            }
        }
    }
    metas.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(metas)
}

pub fn create_story(title: String, seed_prompt: String) -> Result<StoryMeta> {
    let id = uuid::Uuid::new_v4().to_string();
    let dir = paths::story_dir(&id);
    fs::create_dir_all(dir.join("timeline"))?;
    fs::create_dir_all(dir.join("characters"))?;
    fs::write(dir.join("story.md"), "")?;
    let now = now();
    let meta = StoryMeta {
        id: id.clone(),
        title,
        seed_prompt,
        created_at: now.clone(),
        updated_at: now,
        status: "active".into(),
        thumbnail: None,
        outcome: None,
    };
    fs::write(dir.join("meta.json"), serde_json::to_vec_pretty(&meta)?)?;
    Ok(meta)
}

pub fn load_story(story_id: &str) -> Result<StoryMeta> {
    let dir = paths::story_dir(story_id);
    let bytes = fs::read(dir.join("meta.json"))?;
    Ok(serde_json::from_slice(&bytes)?)
}

pub fn delete_story(story_id: &str) -> Result<()> {
    let dir = paths::story_dir(story_id);
    if dir.exists() {
        fs::remove_dir_all(dir)?;
    }
    Ok(())
}

pub fn update_meta(meta: StoryMeta) -> Result<StoryMeta> {
    let dir = paths::story_dir(&meta.id);
    if !dir.exists() {
        bail!("story not found: {}", meta.id);
    }
    let mut next = meta.clone();
    next.updated_at = now();
    fs::write(dir.join("meta.json"), serde_json::to_vec_pretty(&next)?)?;
    Ok(next)
}

fn next_seq(timeline: &PathBuf) -> Result<u32> {
    fs::create_dir_all(timeline)?;
    let mut max = 0u32;
    for entry in fs::read_dir(timeline)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if let Some(prefix) = name.split('-').next() {
            if let Ok(n) = prefix.parse::<u32>() {
                if n > max {
                    max = n;
                }
            }
        }
    }
    Ok(max + 1)
}

fn touch(meta_path: &PathBuf) -> Result<()> {
    if let Ok(bytes) = fs::read(meta_path) {
        if let Ok(mut meta) = serde_json::from_slice::<StoryMeta>(&bytes) {
            meta.updated_at = now();
            fs::write(meta_path, serde_json::to_vec_pretty(&meta)?)?;
        }
    }
    Ok(())
}

pub fn append_turn_text(story_id: &str, role: &str, markdown: &str) -> Result<TimelineEntry> {
    let dir = paths::story_dir(story_id);
    let timeline = dir.join("timeline");
    let seq = next_seq(&timeline)?;
    let filename = format!("{:04}-{}.md", seq, sanitize_filename(role));
    fs::write(timeline.join(&filename), markdown)?;
    touch(&dir.join("meta.json"))?;
    Ok(TimelineEntry {
        seq,
        role: role.into(),
        markdown: markdown.into(),
        image: None,
        audio: None,
    })
}

pub fn append_turn_image(story_id: &str, seq: u32, png_b64: &str) -> Result<String> {
    let dir = paths::story_dir(story_id);
    let timeline = dir.join("timeline");
    fs::create_dir_all(&timeline)?;
    let bytes = base64_decode(png_b64).context("decode image base64")?;
    let filename = format!("{:04}-scene.png", seq);
    fs::write(timeline.join(&filename), bytes)?;
    touch(&dir.join("meta.json"))?;
    Ok(filename)
}

pub fn append_turn_audio(
    story_id: &str,
    seq: u32,
    audio_b64: &str,
    mime: &str,
) -> Result<String> {
    let dir = paths::story_dir(story_id);
    let timeline = dir.join("timeline");
    fs::create_dir_all(&timeline)?;
    let bytes = base64_decode(audio_b64).context("decode audio base64")?;
    let ext = match mime {
        m if m.contains("mpeg") || m.contains("mp3") => "mp3",
        m if m.contains("wav") => "wav",
        m if m.contains("ogg") => "ogg",
        _ => "bin",
    };
    let filename = format!("{:04}-scene.{}", seq, ext);
    fs::write(timeline.join(&filename), bytes)?;
    touch(&dir.join("meta.json"))?;
    Ok(filename)
}

pub fn list_timeline(story_id: &str) -> Result<Vec<TimelineEntry>> {
    let dir = paths::story_dir(story_id);
    let timeline = dir.join("timeline");
    if !timeline.exists() {
        return Ok(Vec::new());
    }
    let mut by_seq: std::collections::BTreeMap<u32, TimelineEntry> =
        std::collections::BTreeMap::new();
    for entry in fs::read_dir(&timeline)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let mut parts = name.splitn(2, '-');
        let Some(seq_str) = parts.next() else { continue };
        let Some(rest) = parts.next() else { continue };
        let Ok(seq) = seq_str.parse::<u32>() else { continue };
        let (kind, ext) = match rest.rsplit_once('.') {
            Some((k, e)) => (k.to_string(), e.to_string()),
            None => continue,
        };
        let slot = by_seq.entry(seq).or_insert(TimelineEntry {
            seq,
            role: kind.clone(),
            markdown: String::new(),
            image: None,
            audio: None,
        });
        if slot.role.is_empty() {
            slot.role = kind.clone();
        }
        match ext.as_str() {
            "md" => {
                slot.role = kind;
                slot.markdown = fs::read_to_string(timeline.join(&name)).unwrap_or_default();
            }
            "png" | "jpg" | "jpeg" | "webp" => {
                slot.image = Some(name.clone());
            }
            "mp3" | "wav" | "ogg" => {
                slot.audio = Some(name.clone());
            }
            _ => {}
        }
    }
    Ok(by_seq.into_values().collect())
}

pub fn read_timeline_entry(story_id: &str, seq: u32) -> Result<TimelineEntry> {
    let all = list_timeline(story_id)?;
    all.into_iter()
        .find(|e| e.seq == seq)
        .ok_or_else(|| anyhow::anyhow!("no timeline entry with seq {seq}"))
}

pub fn write_timeline_entry(story_id: &str, seq: u32, markdown: &str) -> Result<()> {
    let dir = paths::story_dir(story_id);
    let timeline = dir.join("timeline");
    // Find the existing .md file for this seq; if absent, default to scene.
    let mut existing: Option<String> = None;
    if timeline.exists() {
        for entry in fs::read_dir(&timeline)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(&format!("{:04}-", seq)) && name.ends_with(".md") {
                existing = Some(name);
                break;
            }
        }
    }
    let filename = existing.unwrap_or_else(|| format!("{:04}-scene.md", seq));
    fs::create_dir_all(&timeline)?;
    fs::write(timeline.join(&filename), markdown)?;
    touch(&dir.join("meta.json"))?;
    Ok(())
}

pub fn delete_timeline_entry(story_id: &str, seq: u32) -> Result<()> {
    let dir = paths::story_dir(story_id);
    let timeline = dir.join("timeline");
    if !timeline.exists() {
        return Ok(());
    }
    let prefix = format!("{:04}-", seq);
    for entry in fs::read_dir(&timeline)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(&prefix) {
            fs::remove_file(timeline.join(name)).ok();
        }
    }
    touch(&dir.join("meta.json"))?;
    Ok(())
}

pub fn read_story_summary(story_id: &str) -> Result<String> {
    let dir = paths::story_dir(story_id);
    let path = dir.join("story.md");
    if !path.exists() {
        return Ok(String::new());
    }
    Ok(fs::read_to_string(path)?)
}

pub fn write_story_summary(story_id: &str, content: &str) -> Result<()> {
    let dir = paths::story_dir(story_id);
    fs::create_dir_all(&dir)?;
    fs::write(dir.join("story.md"), content)?;
    touch(&dir.join("meta.json"))?;
    Ok(())
}

pub fn list_characters(story_id: &str) -> Result<Vec<(String, String)>> {
    let dir = paths::story_dir(story_id).join("characters");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".md") {
            continue;
        }
        let stem = name.trim_end_matches(".md").to_string();
        let body = fs::read_to_string(entry.path()).unwrap_or_default();
        out.push((stem, body));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

pub fn read_character(story_id: &str, name: &str) -> Result<String> {
    let dir = paths::story_dir(story_id).join("characters");
    let filename = format!("{}.md", sanitize_id(name));
    let path = dir.join(filename);
    if !path.exists() {
        return Ok(String::new());
    }
    Ok(fs::read_to_string(path)?)
}

pub fn upsert_character(story_id: &str, name: &str, content: &str) -> Result<String> {
    let dir = paths::story_dir(story_id).join("characters");
    fs::create_dir_all(&dir)?;
    let safe = sanitize_id(name);
    if safe.is_empty() {
        bail!("invalid character name: {}", name);
    }
    let filename = format!("{}.md", safe);
    fs::write(dir.join(&filename), content)?;
    touch(&paths::story_dir(story_id).join("meta.json"))?;
    Ok(safe)
}

pub fn delete_character(story_id: &str, name: &str) -> Result<()> {
    let dir = paths::story_dir(story_id).join("characters");
    let safe = sanitize_id(name);
    let path = dir.join(format!("{}.md", safe));
    if path.exists() {
        fs::remove_file(path)?;
    }
    touch(&paths::story_dir(story_id).join("meta.json"))?;
    Ok(())
}

/// Read an artifact (relative to the story's directory) and return its bytes
/// as standard base64. Used to rehydrate the most recent illustration so the
/// agent's edit_image tool has a source PNG after an app reload.
pub fn read_artifact_b64(story_id: &str, relative: &str) -> Result<String> {
    let dir = paths::story_dir(story_id);
    // Defense-in-depth: reject traversal attempts up front. The renderer
    // already passes sanitized story-relative filenames (e.g. "0003-scene.png"),
    // but a future caller could pass anything.
    if relative.contains("..") || relative.starts_with('/') || relative.contains('\\') {
        bail!("invalid relative path: {relative}");
    }
    let path = dir.join(relative);
    if !path.exists() {
        bail!("artifact not found: {relative}");
    }
    let bytes = fs::read(&path)?;
    Ok(base64_encode(&bytes))
}

fn base64_encode(bytes: &[u8]) -> String {
    const ALPHA: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8) | bytes[i + 2] as u32;
        out.push(ALPHA[((n >> 18) & 63) as usize] as char);
        out.push(ALPHA[((n >> 12) & 63) as usize] as char);
        out.push(ALPHA[((n >> 6) & 63) as usize] as char);
        out.push(ALPHA[(n & 63) as usize] as char);
        i += 3;
    }
    let rem = bytes.len() - i;
    if rem == 1 {
        let n = (bytes[i] as u32) << 16;
        out.push(ALPHA[((n >> 18) & 63) as usize] as char);
        out.push(ALPHA[((n >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rem == 2 {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8);
        out.push(ALPHA[((n >> 18) & 63) as usize] as char);
        out.push(ALPHA[((n >> 12) & 63) as usize] as char);
        out.push(ALPHA[((n >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
}

pub fn write_thumbnail(story_id: &str, png_b64: &str) -> Result<String> {
    let dir = paths::story_dir(story_id);
    fs::create_dir_all(&dir)?;
    let bytes = base64_decode(png_b64).context("decode thumbnail base64")?;
    fs::write(dir.join("thumbnail.png"), bytes)?;
    // Update meta to point at it
    let meta_path = dir.join("meta.json");
    if let Ok(meta_bytes) = fs::read(&meta_path) {
        if let Ok(mut meta) = serde_json::from_slice::<StoryMeta>(&meta_bytes) {
            meta.thumbnail = Some("thumbnail.png".into());
            meta.updated_at = now();
            fs::write(&meta_path, serde_json::to_vec_pretty(&meta)?)?;
        }
    }
    Ok("thumbnail.png".into())
}

fn base64_decode(s: &str) -> Result<Vec<u8>> {
    // tiny portable base64 decoder so we don't pull in another crate.
    const TBL: [i8; 256] = {
        let mut t = [-1i8; 256];
        let mut i = 0u8;
        while i < 26 {
            t[(b'A' + i) as usize] = i as i8;
            t[(b'a' + i) as usize] = (i + 26) as i8;
            i += 1;
        }
        let mut i = 0u8;
        while i < 10 {
            t[(b'0' + i) as usize] = (i + 52) as i8;
            i += 1;
        }
        t[b'+' as usize] = 62;
        t[b'/' as usize] = 63;
        t[b'-' as usize] = 62; // url-safe
        t[b'_' as usize] = 63; // url-safe
        t
    };
    let trimmed: Vec<u8> = s
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();
    let mut out = Vec::with_capacity(trimmed.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for b in trimmed {
        let v = TBL[b as usize];
        if v < 0 {
            bail!("invalid base64 character: {}", b);
        }
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Ok(out)
}
