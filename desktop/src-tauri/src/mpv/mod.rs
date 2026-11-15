//! libmpv playback for the desktop app.

mod ffi;
mod player;
#[cfg(target_os = "macos")]
mod view_macos;
#[cfg(windows)]
mod view_windows;

use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, State, WebviewWindow};

pub use player::Mpv;

#[derive(Default)]
pub struct MpvState {
    mpv: Mutex<Option<Arc<Mpv>>>,
    #[cfg(target_os = "macos")]
    view: Mutex<Option<Arc<view_macos::VideoView>>>,
    #[cfg(windows)]
    view: Mutex<Option<Arc<view_windows::VideoView>>>,
}

impl MpvState {
    fn mpv(&self) -> Result<Arc<Mpv>, String> {
        self.mpv
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "libmpv is not running".to_string())
    }
}

/// Sends one event to the web app (`src/platform/desktop.ts` listens).
fn emit_to_web<R: Runtime>(window: &WebviewWindow<R>, event: &Value) {
    let js = format!("window.__zoggyfinDesktop&&window.__zoggyfinDesktop.mpv({event})");
    let _ = window.eval(js);
}

/// Starts libmpv. The window is made after this, so the page knows at load
/// time whether video plays through libmpv (`window.__ZOGGYFIN_MPV__`).
pub fn start<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let mpv = Mpv::new()?;
    *app.state::<MpvState>().mpv.lock().unwrap() = Some(mpv);
    Ok(())
}

/// Sends libmpv events to the window and puts the video view in it. Main thread.
pub fn attach<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) -> Result<(), String> {
    let state = app.state::<MpvState>();
    let mpv = state.mpv()?;
    #[cfg(target_os = "macos")]
    let view = {
        let ns_window = window.ns_window().map_err(|e| e.to_string())?;
        let view =
            Arc::new(view_macos::VideoView::attach(ns_window, mpv.clone()).ok_or("the video view could not attach")?);
        view.set_visible(false);
        *state.view.lock().unwrap() = Some(view.clone());
        view
    };
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let view = Arc::new(view_windows::VideoView::attach(hwnd.0 as isize, mpv.clone())?);
        view.set_visible(false);
        *state.view.lock().unwrap() = Some(view);
    }
    let target = window.clone();
    mpv.clone().run_events(move |event| {
        // The surface follows libmpv's idle state: black when nothing plays, never an old frame.
        #[cfg(target_os = "macos")]
        if event.get("name").and_then(Value::as_str) == Some("idle-active") {
            if let Some(idle) = event.get("value").and_then(Value::as_bool) {
                view.set_idle(idle);
            }
        }
        emit_to_web(&target, &event);
    });
    Ok(())
}

/// Stops playback when the app quits, so the audio ends with the window.
pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    if let Some(mpv) = app.state::<MpvState>().mpv.lock().unwrap().as_ref() {
        let _ = mpv.command(&["stop".into()]);
    }
}

/// The window moved to a screen with another scale factor.
pub fn scale_changed<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    if let Some(view) = app.state::<MpvState>().view.lock().unwrap().clone() {
        let _ = app.run_on_main_thread(move || view.update_scale());
    }
    #[cfg(windows)]
    resized(app);
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = app;
}

/// The window moved or changed size (also full screen, maximize and minimize): the
/// video window follows it.
pub fn resized<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(windows)]
    if let Some(view) = app.state::<MpvState>().view.lock().unwrap().clone() {
        let _ = app.run_on_main_thread(move || view.fit());
    }
    #[cfg(not(windows))]
    let _ = app;
}

#[tauri::command]
pub fn mpv_command(state: State<'_, MpvState>, args: Vec<String>) -> Result<(), String> {
    #[cfg(debug_assertions)]
    eprintln!(
        "[mpv] command {:?}",
        args.iter()
            .map(|a| a.split("ApiKey=").next().unwrap_or(""))
            .collect::<Vec<_>>()
    );
    state.mpv()?.command(&args)
}

#[tauri::command]
pub fn mpv_set_property(state: State<'_, MpvState>, name: String, value: String) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        // Header values (`http-header-fields`) can hold a token: log the name only.
        let shown = if name.contains("header") {
            "<redacted>"
        } else {
            value.as_str()
        };
        eprintln!("[mpv] set {name} = {shown}");
    }
    state.mpv()?.set(&name, &value)
}

#[tauri::command]
pub fn mpv_get_property(state: State<'_, MpvState>, name: String) -> Result<Option<String>, String> {
    Ok(state.mpv()?.get(&name))
}

/// Shows the video under the web view (the player is open) or hides it.
#[tauri::command]
pub fn mpv_set_video_visible<R: Runtime>(app: AppHandle<R>, visible: bool) -> Result<(), String> {
    #[cfg(any(target_os = "macos", windows))]
    {
        let view = app
            .state::<MpvState>()
            .view
            .lock()
            .unwrap()
            .clone()
            .ok_or("no video view")?;
        app.run_on_main_thread(move || view.set_visible(visible))
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = (app, visible);
    Ok(())
}
