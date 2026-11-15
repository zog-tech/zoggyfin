//! Test automation for development builds only (not compiled into release).
//!
//! With `ZOGGYFIN_AUTOMATION=<dir>`, the app watches that folder:
//! - `cmd.js`: the app runs the script in the page, then deletes the file.
//!   A script can write lines to `out.log` with
//!   `__TAURI_INTERNALS__.invoke('debug_log', { line })`.
//! - `snap`: the file holds a PNG path; the app saves a picture of its window
//!   there (video and page together), then deletes the file.
//!
//! An app may capture its own windows without the screen recording permission.

use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};

fn dir() -> Option<PathBuf> {
    std::env::var_os("ZOGGYFIN_AUTOMATION").map(PathBuf::from)
}

#[tauri::command]
pub fn debug_log(line: String) {
    if let Some(d) = dir() {
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(d.join("out.log"))
        {
            let _ = writeln!(f, "{line}");
        }
    }
}

/// Writes what MPNowPlayingInfoCenter has to `out.log` (main thread).
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn debug_now_playing<R: Runtime>(app: AppHandle<R>) {
    let _ = app.run_on_main_thread(|| {
        use objc2_media_player::MPNowPlayingInfoCenter;
        // SAFETY: main thread.
        let (info, state) = unsafe {
            let c = MPNowPlayingInfoCenter::defaultCenter();
            (c.nowPlayingInfo(), c.playbackState())
        };
        let text = info.map(|i| format!("{i:?}")).unwrap_or_else(|| "none".into());
        debug_log(format!("now playing (state {}): {}", state.0, text.replace('\n', " ")));
    });
}

pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let Some(d) = dir() else { return };
    let _ = std::fs::create_dir_all(&d);
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(200));
        let Some(window) = app.get_webview_window("main") else {
            continue;
        };
        let cmd = d.join("cmd.js");
        if let Ok(js) = std::fs::read_to_string(&cmd) {
            let _ = std::fs::remove_file(&cmd);
            let _ = window.eval(js);
        }
        let snap = d.join("snap");
        if let Ok(path) = std::fs::read_to_string(&snap) {
            let _ = std::fs::remove_file(&snap);
            #[cfg(target_os = "macos")]
            {
                let path = path.trim().to_string();
                let w = window.clone();
                let _ = app.run_on_main_thread(move || {
                    let result = snapshot(&w, &path);
                    debug_log(format!("snap {path}: {result:?}"));
                });
            }
            #[cfg(not(target_os = "macos"))]
            debug_log(format!("snap {}: window pictures are macOS only", path.trim()));
        }
    });
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn snapshot<R: Runtime>(window: &tauri::WebviewWindow<R>, path: &str) -> Result<(), String> {
    use objc2::AnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWindow};
    use objc2_core_graphics::{CGWindowImageOption, CGWindowListCreateImage, CGWindowListOption};
    use objc2_foundation::{NSDictionary, NSString};

    let ns_window = window.ns_window().map_err(|e| e.to_string())?;
    // SAFETY: a valid NSWindow pointer from Tauri, used on the main thread.
    let ns_window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
    let id = ns_window.windowNumber() as u32;
    let null_rect = objc2_core_foundation::CGRect::new(
        objc2_core_foundation::CGPoint::new(f64::INFINITY, f64::INFINITY),
        objc2_core_foundation::CGSize::new(0.0, 0.0),
    );
    let image = CGWindowListCreateImage(
        null_rect,
        CGWindowListOption::OptionIncludingWindow,
        id,
        CGWindowImageOption::BoundsIgnoreFraming,
    )
    .ok_or("no image")?;
    let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &image);
    // SAFETY: an empty properties dictionary.
    let data = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }
        .ok_or("no PNG")?;
    if data.writeToFile_atomically(&NSString::from_str(path), true) {
        Ok(())
    } else {
        Err("write failed".into())
    }
}
