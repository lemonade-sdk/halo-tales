mod commands;
mod download;
mod lemonade;
mod logging;
mod paths;
mod story_fs;

use tauri::Manager;

pub fn run() {
    crate::hlog!("info", "boot", "halo-tales starting; log file: {}", logging::log_file_path().display());
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .manage(lemonade::LemonadeState::default())
        .invoke_handler(tauri::generate_handler![
            logging::log_event,
            commands::probe_lemonade,
            commands::ensure_embedded_lemonade,
            commands::start_embedded_lemonade,
            commands::stop_embedded_lemonade,
            commands::get_lemonade_endpoint,
            commands::list_stories,
            commands::create_story,
            commands::load_story,
            commands::delete_story,
            commands::update_story_meta,
            commands::append_turn_text,
            commands::append_turn_image,
            commands::append_turn_audio,
            commands::list_timeline,
            commands::read_timeline_entry,
            commands::write_timeline_entry,
            commands::delete_timeline_entry,
            commands::read_story_summary,
            commands::write_story_summary,
            commands::list_characters,
            commands::read_character,
            commands::upsert_character,
            commands::delete_character,
            commands::write_thumbnail,
            commands::read_artifact_b64,
            commands::resolve_artifact_url,
        ])
        .setup(|app| {
            paths::ensure_root(&app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            app_handle.state::<lemonade::LemonadeState>().stop_embedded();
        }
    });
}
