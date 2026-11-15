//! Zoggyfin desktop: the Expo web build in a Tauri window. Video plays
//! through libmpv (`mpv`), drawn under the transparent web view; the web app
//! draws the player controls. Menus send commands to the web app.
//! Updates: `update.rs` (signed latest.json, install in place, relaunch of the same bundle).

// wry catches WebKit's Objective-C exceptions by unwinding through Rust frames; a release
// built with panic = "abort" quits there instead. See Cargo.toml.
#[cfg(all(not(debug_assertions), panic = "abort"))]
compile_error!("build the release with panic = \"unwind\" (Cargo.toml [profile.release])");

#[cfg(debug_assertions)]
mod debug;
mod discovery;
mod downloads;
mod iptv;
mod links;
#[cfg(target_os = "macos")]
mod media_macos;
#[cfg(target_os = "macos")]
mod menu;
mod mpv;
mod nearby;
#[cfg(target_os = "macos")]
mod update;

use std::sync::Arc;

use tauri::{Manager, RunEvent, WebviewWindow, WebviewWindowBuilder, WindowEvent};

/// Runs a command in the web app (`src/platform/desktop.ts`). The menus use it (macOS).
#[cfg(target_os = "macos")]
pub(crate) fn send_to_web<R: tauri::Runtime>(window: &WebviewWindow<R>, command: &str) {
    let js = format!(
        "window.__zoggyfinDesktop&&window.__zoggyfinDesktop.menu({})",
        serde_json::json!(command)
    );
    let _ = window.eval(js);
}

#[tauri::command]
fn desktop_toggle_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    let next = !window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(next).map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
fn desktop_is_fullscreen(window: WebviewWindow) -> bool {
    window.is_fullscreen().unwrap_or(false)
}

#[cfg(target_os = "macos")]
use media_macos::{now_playing_clear, now_playing_update};

/// Now Playing exists on macOS only; elsewhere the commands do nothing.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn now_playing_update(info: serde_json::Value) {
    let _ = info;
}
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn now_playing_clear() {}

pub fn run() {
    let builder = tauri::Builder::default()
        // First: a second start of the app (Finder, `open -n`, a terminal) quits at once and
        // brings the running window to the front.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(target_os = "macos")]
    let builder = builder.manage(update::PendingUpdate::default());
    // The Mac menu bar. Windows has no app menu bar: the page handles the same shortcuts
    // (Ctrl+, Ctrl+F, Ctrl+1/2/3 and the others; `src/platform/desktop.ts`).
    // Now Playing for libmpv video (macOS).
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(menu::build)
        .on_menu_event(menu::on_event)
        .manage(media_macos::MediaState::default());
    let app = builder
        .manage(mpv::MpvState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_toggle_fullscreen,
            desktop_is_fullscreen,
            mpv::mpv_command,
            mpv::mpv_set_property,
            mpv::mpv_get_property,
            mpv::mpv_set_video_visible,
            downloads::download_start,
            downloads::download_pause,
            downloads::download_resume,
            downloads::download_stop,
            downloads::download_existing,
            downloads::download_finish,
            downloads::files_ensure_dir,
            downloads::files_remove,
            downloads::files_write_text,
            downloads::files_read_text,
            downloads::files_size,
            downloads::files_list_dirs,
            downloads::files_fetch,
            downloads::files_disk_space,
            iptv::iptv_fetch,
            now_playing_update,
            now_playing_clear,
            links::desktop_take_links,
            nearby::nearby_call,
            nearby::nearby_post,
            discovery::discovery_udp,
            discovery::discovery_interfaces,
            discovery::discovery_lan_probe,
            discovery::discovery_open_settings,
            #[cfg(target_os = "macos")]
            update::update_check,
            #[cfg(target_os = "macos")]
            update::update_download,
            #[cfg(target_os = "macos")]
            update::update_install_and_relaunch,
            #[cfg(debug_assertions)]
            debug::debug_log,
            #[cfg(all(debug_assertions, target_os = "macos"))]
            debug::debug_now_playing,
        ])
        .setup(|app| {
            // A release build that runs from a disk image, App Translocation or ~/Downloads
            // offers to move to Applications first, and then starts from there.
            #[cfg(all(target_os = "macos", not(debug_assertions)))]
            if update::offer_move_to_applications(app.handle()) {
                std::process::exit(0);
            }
            links::setup(app);
            let handle = app.handle();
            let data_dir = handle.path().app_data_dir()?;
            app.manage::<downloads::DownloadsState>(Arc::new(downloads::Downloads::new(data_dir.clone())));
            // Without libmpv the app still runs; video falls back to the web player.
            let with_mpv = match mpv::start(handle) {
                Ok(()) => true,
                Err(e) => {
                    eprintln!("[mpv] {e}");
                    false
                }
            };
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .expect("the main window config")
                .clone();
            let window = WebviewWindowBuilder::from_config(handle, &config)?
                .initialization_script(format!(
                    "window.__ZOGGYFIN_MPV__ = {with_mpv}; window.__ZOGGYFIN_DATA_DIR__ = {}; \
                     window.__ZOGGYFIN_VERSION__ = {}; window.__ZOGGYFIN_AUTO_UPDATE__ = {}; \
                     window.__ZOGGYFIN_PLATFORM__ = {};",
                    serde_json::json!(data_dir.to_string_lossy()),
                    serde_json::json!(handle.package_info().version.to_string()),
                    // Debug builds do not look for updates by themselves (a menu check still works).
                    cfg!(all(target_os = "macos", not(debug_assertions))),
                    // "macos" or "windows": the page draws its own title bar on macOS only.
                    serde_json::json!(std::env::consts::OS)
                ))
                .build()?;
            if with_mpv {
                if let Err(e) = mpv::attach(handle, &window) {
                    eprintln!("[mpv] {e}");
                }
            }
            #[cfg(debug_assertions)]
            debug::start(handle);
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::ScaleFactorChanged { .. } => mpv::scale_changed(window.app_handle()),
            // The video window (Windows) follows the main window.
            WindowEvent::Resized(_) | WindowEvent::Moved(_) => mpv::resized(window.app_handle()),
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("build the Tauri app");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            mpv::shutdown(handle);
        }
    });
}
