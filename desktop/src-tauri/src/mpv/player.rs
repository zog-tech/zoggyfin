//! One libmpv instance for the app's life. The web app drives it through
//! Tauri commands; property changes and file events go back to the web app
//! as JSON (see `Event`).

use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::ffi::*;

pub struct Mpv {
    handle: *mut mpv_handle,
}

// SAFETY: the libmpv client API is thread-safe (client.h, "Thread safety").
unsafe impl Send for Mpv {}
unsafe impl Sync for Mpv {}

fn cstring(s: &str) -> Result<CString, String> {
    CString::new(s).map_err(|_| format!("a NUL byte in {s:?}"))
}

fn check(code: i32, what: &str) -> Result<(), String> {
    if code >= 0 {
        return Ok(());
    }
    // SAFETY: mpv_error_string returns a static string for every code.
    let msg = unsafe { CStr::from_ptr(mpv_error_string(code)) }.to_string_lossy();
    Err(format!("{what}: {msg}"))
}

/// Properties the web app follows. The u64 is the reply id in events.
const OBSERVED: &[(&str, i32)] = &[
    ("time-pos", MPV_FORMAT_DOUBLE),
    ("duration", MPV_FORMAT_DOUBLE),
    ("pause", MPV_FORMAT_FLAG),
    ("paused-for-cache", MPV_FORMAT_FLAG),
    ("seeking", MPV_FORMAT_FLAG),
    ("demuxer-cache-time", MPV_FORMAT_DOUBLE),
    ("speed", MPV_FORMAT_DOUBLE),
    ("mute", MPV_FORMAT_FLAG),
    ("volume", MPV_FORMAT_DOUBLE),
    ("aid", MPV_FORMAT_STRING),
    ("sid", MPV_FORMAT_STRING),
    ("track-list", MPV_FORMAT_NONE),
    ("video-codec", MPV_FORMAT_STRING),
    ("hwdec-current", MPV_FORMAT_STRING),
    // True when nothing is loaded: the video surface then shows black, not the last frame.
    ("idle-active", MPV_FORMAT_FLAG),
];

impl Mpv {
    pub fn new() -> Result<Arc<Self>, String> {
        // SAFETY: plain libmpv setup calls on a new handle.
        unsafe {
            let handle = mpv_create();
            if handle.is_null() {
                return Err("libmpv could not start".into());
            }
            let mpv = Mpv { handle };
            let options: &[(&str, &str)] = &[
                // macOS: the render API draws into the layer of `view_macos.rs`. Windows: libmpv
                // draws itself (Direct3D 11) into the child window of `view_windows.rs` (`wid`).
                #[cfg(not(windows))]
                ("vo", "libmpv"),
                #[cfg(windows)]
                ("vo", "gpu-next"),
                // The web page under the mouse owns the cursor and the input, not libmpv's window.
                #[cfg(windows)]
                ("input-cursor", "no"),
                #[cfg(windows)]
                ("cursor-autohide", "no"),
                ("hwdec", "auto-safe"),
                ("config", "no"),
                ("load-scripts", "no"),
                ("ytdl", "no"),
                ("osc", "no"),
                ("input-default-bindings", "no"),
                ("input-vo-keyboard", "no"),
                ("terminal", "no"),
                ("idle", "yes"),
                ("keep-open", "no"),
                ("force-seekable", "yes"),
                ("cache", "yes"),
                ("demuxer-max-bytes", "150MiB"),
                ("demuxer-max-back-bytes", "50MiB"),
                ("audio-client-name", "Zoggyfin"),
                ("user-agent", "Zoggyfin Desktop"),
                ("sub-auto", "no"),
                ("sid", "no"),
                ("sub-font-size", "46"),
                ("sub-border-size", "2.5"),
                ("sub-shadow-offset", "1"),
            ];
            for (k, v) in options {
                let (kc, vc) = (cstring(k)?, cstring(v)?);
                // A build without Lua has no `osc`, `ytdl` or `load-scripts`: those are off anyway.
                if let Err(e) = check(mpv_set_option_string(handle, kc.as_ptr(), vc.as_ptr()), k) {
                    eprintln!("[mpv] {e}");
                }
            }
            check(mpv_initialize(handle), "start libmpv")?;
            for (i, (name, format)) in OBSERVED.iter().enumerate() {
                let n = cstring(name)?;
                check(mpv_observe_property(handle, i as u64, n.as_ptr(), *format), "observe")?;
            }
            Ok(Arc::new(mpv))
        }
    }

    /// For the render API (`view_macos.rs`); Windows uses `wid` instead.
    #[cfg(target_os = "macos")]
    pub fn raw(&self) -> *mut mpv_handle {
        self.handle
    }

    pub fn command(&self, args: &[String]) -> Result<(), String> {
        let owned: Vec<CString> = args.iter().map(|a| cstring(a)).collect::<Result<_, _>>()?;
        let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        // SAFETY: a NULL-terminated array of valid C strings that outlive the call.
        check(
            unsafe { mpv_command(self.handle, ptrs.as_mut_ptr()) },
            args.first().map_or("command", |s| s),
        )
    }

    pub fn set(&self, name: &str, value: &str) -> Result<(), String> {
        let (n, v) = (cstring(name)?, cstring(value)?);
        // SAFETY: valid C strings.
        check(
            unsafe { mpv_set_property_string(self.handle, n.as_ptr(), v.as_ptr()) },
            name,
        )
    }

    pub fn get(&self, name: &str) -> Option<String> {
        let n = cstring(name).ok()?;
        // SAFETY: the returned string is owned by us and freed with mpv_free.
        unsafe {
            let p = mpv_get_property_string(self.handle, n.as_ptr());
            if p.is_null() {
                return None;
            }
            let s = CStr::from_ptr(p).to_string_lossy().into_owned();
            mpv_free(p as *mut c_void);
            Some(s)
        }
    }

    /// The track list as JSON, read field by field (no mpv_node parsing).
    fn tracks(&self) -> Value {
        let count: usize = self.get("track-list/count").and_then(|c| c.parse().ok()).unwrap_or(0);
        let mut out = Vec::with_capacity(count);
        for i in 0..count {
            let f = |k: &str| self.get(&format!("track-list/{i}/{k}"));
            out.push(json!({
                "id": f("id").and_then(|v| v.parse::<i64>().ok()),
                "type": f("type"),
                "ffIndex": f("ff-index").and_then(|v| v.parse::<i64>().ok()),
                "external": f("external").as_deref() == Some("yes"),
                "title": f("title"),
                "lang": f("lang"),
                "codec": f("codec"),
                "selected": f("selected").as_deref() == Some("yes"),
                "isDefault": f("default").as_deref() == Some("yes"),
                "forced": f("forced").as_deref() == Some("yes"),
            }));
        }
        Value::Array(out)
    }

    /// Reads events until libmpv shuts down. `emit` sends one event to the web app.
    pub fn run_events(self: Arc<Self>, emit: impl Fn(Value) + Send + 'static) {
        std::thread::Builder::new()
            .name("mpv-events".into())
            .spawn(move || {
                let mut last_time = Instant::now() - Duration::from_secs(1);
                let mut last_cache = last_time;
                let position = |mpv: &Mpv| {
                    let v = mpv.get("time-pos").and_then(|t| t.parse::<f64>().ok());
                    json!({ "type": "prop", "name": "time-pos", "value": v })
                };
                loop {
                    // SAFETY: the event stays valid until the next mpv_wait_event call.
                    let ev = unsafe { &*mpv_wait_event(self.handle, -1.0) };
                    match ev.event_id {
                        MPV_EVENT_SHUTDOWN => break,
                        MPV_EVENT_NONE => {}
                        MPV_EVENT_START_FILE => emit(json!({ "type": "start-file" })),
                        MPV_EVENT_FILE_LOADED => {
                            emit(json!({ "type": "file-loaded" }));
                        }
                        MPV_EVENT_PLAYBACK_RESTART => {
                            emit(position(&self));
                            emit(json!({ "type": "playback-restart" }));
                        }
                        MPV_EVENT_SEEK => emit(json!({ "type": "seek" })),
                        MPV_EVENT_END_FILE => {
                            // SAFETY: END_FILE events carry mpv_event_end_file.
                            let end = unsafe { &*(ev.data as *const mpv_event_end_file) };
                            let reason = match end.reason {
                                MPV_END_FILE_REASON_EOF => "eof",
                                MPV_END_FILE_REASON_ERROR => "error",
                                MPV_END_FILE_REASON_QUIT => "quit",
                                MPV_END_FILE_REASON_REDIRECT => "redirect",
                                _ => "stop",
                            };
                            let error = if end.reason == MPV_END_FILE_REASON_ERROR {
                                // SAFETY: static string.
                                Some(
                                    unsafe { CStr::from_ptr(mpv_error_string(end.error)) }
                                        .to_string_lossy()
                                        .into_owned(),
                                )
                            } else {
                                None
                            };
                            emit(json!({ "type": "end-file", "reason": reason, "error": error }));
                        }
                        MPV_EVENT_PROPERTY_CHANGE => {
                            // SAFETY: PROPERTY_CHANGE events carry mpv_event_property.
                            let p = unsafe { &*(ev.data as *const mpv_event_property) };
                            let name = unsafe { CStr::from_ptr(p.name) }.to_string_lossy();
                            if name == "track-list" {
                                emit(json!({ "type": "tracks", "tracks": self.tracks() }));
                                continue;
                            }
                            // SAFETY: data matches the observed format, or is NULL when unavailable.
                            let value = unsafe {
                                if p.data.is_null() {
                                    Value::Null
                                } else {
                                    match p.format {
                                        MPV_FORMAT_DOUBLE => json!(*(p.data as *const f64)),
                                        MPV_FORMAT_FLAG => json!(*(p.data as *const i32) != 0),
                                        MPV_FORMAT_INT64 => json!(*(p.data as *const i64)),
                                        MPV_FORMAT_STRING => {
                                            let s = *(p.data as *const *const c_char);
                                            if s.is_null() {
                                                Value::Null
                                            } else {
                                                json!(CStr::from_ptr(s).to_string_lossy())
                                            }
                                        }
                                        _ => Value::Null,
                                    }
                                }
                            };
                            // The position changes every frame; four updates a second are enough.
                            let every = Duration::from_millis(250);
                            if name == "time-pos" {
                                if last_time.elapsed() < every {
                                    continue;
                                }
                                last_time = Instant::now();
                            } else if name == "demuxer-cache-time" {
                                if last_cache.elapsed() < every {
                                    continue;
                                }
                                last_cache = Instant::now();
                            }
                            let paused = name == "pause" && value == Value::Bool(true);
                            emit(json!({ "type": "prop", "name": name, "value": value }));
                            if paused {
                                emit(position(&self));
                            }
                        }
                        _ => {}
                    }
                }
            })
            .expect("start the mpv event thread");
    }
}
