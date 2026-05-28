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
            #[cfg(target_os = "linux")]
            grant_webkit_media_permissions(&app.handle());
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

/// Reach into the underlying WebKitGTK WebView for the main window and:
///   1. Enable the media-stream / WebRTC settings.
///   2. Auto-allow any permission-request signal (mic, camera, …).
///
/// Without this, `navigator.mediaDevices.getUserMedia({audio:true})` from the
/// renderer fails with `NotAllowedError` because WebKitGTK fires its
/// `permission-request` signal and Tauri/wry has no default handler that
/// answers it. See:
///   - https://github.com/tauri-apps/tauri/discussions/8426
///   - https://github.com/tauri-apps/tauri/issues/12547
#[cfg(target_os = "linux")]
fn grant_webkit_media_permissions(app: &tauri::AppHandle) {
    use tauri::Manager;
    use webkit2gtk::{
        glib::Cast, PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
        WebViewExt,
    };

    let Some(window) = app.get_webview_window("main") else {
        crate::hlog!("warn", "webkit", "main webview not found; skipping media-permission setup");
        return;
    };

    if let Err(e) = window.with_webview(|webview| {
        let wv = webview.inner();
        if let Some(settings) = wv.settings() {
            settings.set_enable_media_stream(true);
            settings.set_enable_mediasource(true);
            settings.set_media_playback_requires_user_gesture(false);
            // webrtc API only exists on webkit2gtk-4.1 (v2_40+); guard via cfg
            // if we ever support older builds.
            settings.set_enable_webrtc(true);
        }
        wv.connect_permission_request(|_wv, request| {
            // Allow every permission request the page makes. We only ship
            // microphone today, but a blanket allow is acceptable because
            // there's no untrusted content in this app.
            if request.dynamic_cast_ref::<UserMediaPermissionRequest>().is_some() {
                crate::hlog!("info", "webkit", "allowing UserMediaPermissionRequest (mic/camera)");
            } else {
                crate::hlog!("info", "webkit", "allowing permission-request {:?}", request);
            }
            request.allow();
            true
        });
        crate::hlog!("info", "webkit", "media-stream settings enabled, permission-request handler installed");
    }) {
        crate::hlog!("error", "webkit", "with_webview failed: {e}");
    }
}
