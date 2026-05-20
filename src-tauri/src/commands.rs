use crate::lemonade::{self, Endpoint, EndpointSource, LemonadeState, DEFAULT_LEMONADE_PORT};
use crate::paths;
use crate::story_fs::{self, StoryMeta, TimelineEntry};
use tauri::{AppHandle, Manager, Runtime, State};

type Result<T> = std::result::Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------- Lemonade lifecycle ----------

#[tauri::command]
pub async fn probe_lemonade(
    state: State<'_, LemonadeState>,
    base_url: Option<String>,
    api_key: Option<String>,
) -> Result<Option<Endpoint>> {
    let url = base_url.unwrap_or_else(|| format!("http://127.0.0.1:{DEFAULT_LEMONADE_PORT}"));
    match lemonade::probe_with_key(&url, api_key.as_deref()).await {
        Ok(()) => {
            let endpoint = Endpoint {
                base_url: url,
                api_key,
                source: EndpointSource::System,
            };
            state.set_endpoint(endpoint.clone());
            Ok(Some(endpoint))
        }
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn ensure_embedded_lemonade<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    lemonade::ensure_installed(&app).await.map_err(err)
}

#[tauri::command]
pub async fn start_embedded_lemonade<R: Runtime>(app: AppHandle<R>) -> Result<Endpoint> {
    lemonade::spawn_embedded(&app).await.map_err(err)
}

#[tauri::command]
pub async fn stop_embedded_lemonade<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    let state = app.state::<LemonadeState>();
    state.stop_embedded();
    Ok(())
}

#[tauri::command]
pub fn get_lemonade_endpoint(state: State<'_, LemonadeState>) -> Result<Option<Endpoint>> {
    Ok(state.get_endpoint())
}

// ---------- Story repository ----------

#[tauri::command]
pub fn list_stories() -> Result<Vec<StoryMeta>> {
    story_fs::list_stories().map_err(err)
}

#[tauri::command]
pub fn create_story(title: String, seed_prompt: String) -> Result<StoryMeta> {
    story_fs::create_story(title, seed_prompt).map_err(err)
}

#[tauri::command]
pub fn load_story(story_id: String) -> Result<StoryMeta> {
    story_fs::load_story(&story_id).map_err(err)
}

#[tauri::command]
pub fn delete_story(story_id: String) -> Result<()> {
    story_fs::delete_story(&story_id).map_err(err)
}

#[tauri::command]
pub fn update_story_meta(meta: StoryMeta) -> Result<StoryMeta> {
    story_fs::update_meta(meta).map_err(err)
}

#[tauri::command]
pub fn append_turn_text(
    story_id: String,
    role: String,
    markdown: String,
) -> Result<TimelineEntry> {
    story_fs::append_turn_text(&story_id, &role, &markdown).map_err(err)
}

#[tauri::command]
pub fn append_turn_image(story_id: String, seq: u32, png_b64: String) -> Result<String> {
    story_fs::append_turn_image(&story_id, seq, &png_b64).map_err(err)
}

#[tauri::command]
pub fn append_turn_audio(
    story_id: String,
    seq: u32,
    audio_b64: String,
    mime: String,
) -> Result<String> {
    story_fs::append_turn_audio(&story_id, seq, &audio_b64, &mime).map_err(err)
}

#[tauri::command]
pub fn list_timeline(story_id: String) -> Result<Vec<TimelineEntry>> {
    story_fs::list_timeline(&story_id).map_err(err)
}

#[tauri::command]
pub fn read_timeline_entry(story_id: String, seq: u32) -> Result<TimelineEntry> {
    story_fs::read_timeline_entry(&story_id, seq).map_err(err)
}

#[tauri::command]
pub fn write_timeline_entry(story_id: String, seq: u32, markdown: String) -> Result<()> {
    story_fs::write_timeline_entry(&story_id, seq, &markdown).map_err(err)
}

#[tauri::command]
pub fn delete_timeline_entry(story_id: String, seq: u32) -> Result<()> {
    story_fs::delete_timeline_entry(&story_id, seq).map_err(err)
}

#[tauri::command]
pub fn read_story_summary(story_id: String) -> Result<String> {
    story_fs::read_story_summary(&story_id).map_err(err)
}

#[tauri::command]
pub fn write_story_summary(story_id: String, content: String) -> Result<()> {
    story_fs::write_story_summary(&story_id, &content).map_err(err)
}

#[tauri::command]
pub fn list_characters(story_id: String) -> Result<Vec<CharacterEntry>> {
    let entries = story_fs::list_characters(&story_id).map_err(err)?;
    Ok(entries
        .into_iter()
        .map(|(name, content)| CharacterEntry { name, content })
        .collect())
}

#[derive(serde::Serialize)]
pub struct CharacterEntry {
    pub name: String,
    pub content: String,
}

#[tauri::command]
pub fn read_character(story_id: String, name: String) -> Result<String> {
    story_fs::read_character(&story_id, &name).map_err(err)
}

#[tauri::command]
pub fn upsert_character(story_id: String, name: String, content: String) -> Result<String> {
    story_fs::upsert_character(&story_id, &name, &content).map_err(err)
}

#[tauri::command]
pub fn delete_character(story_id: String, name: String) -> Result<()> {
    story_fs::delete_character(&story_id, &name).map_err(err)
}

#[tauri::command]
pub fn write_thumbnail(story_id: String, png_b64: String) -> Result<String> {
    story_fs::write_thumbnail(&story_id, &png_b64).map_err(err)
}

#[tauri::command]
pub fn read_artifact_b64(story_id: String, relative: String) -> Result<String> {
    story_fs::read_artifact_b64(&story_id, &relative).map_err(err)
}

/// Return the absolute filesystem path for an artifact inside a story directory.
/// The renderer pipes this through `convertFileSrc` to obtain an asset:// URL
/// usable in <img>/<audio> tags (protocol-asset is enabled in tauri.conf).
#[tauri::command]
pub fn resolve_artifact_url(story_id: String, relative: String) -> Result<String> {
    let dir = paths::story_dir(&story_id);
    let abs = dir.join(&relative);
    let path_str = abs
        .to_str()
        .ok_or_else(|| "non-utf8 path".to_string())?
        .to_string();
    Ok(path_str)
}
