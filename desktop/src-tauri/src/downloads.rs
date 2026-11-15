//! Downloads for the desktop app. Rust only moves bytes and reports progress;
//! the records and their state rules stay in the web app (`src/downloads/`).
//!
//! Files live in the app data folder (`~/Library/Application Support/<id>/`
//! on macOS), with the same layout as on iPhone: `downloads/<itemId>/...`.
//! A download writes to `<destination>.part` and renames it at the end.
//! The task list is saved to `download-tasks.json`, so paused downloads stay
//! paused and running downloads continue (HTTP Range) after a restart. When
//! the task list lost a task, the web app asks to resume and the partial file
//! continues the same way. A range that does not fit the partial file (another
//! start, another total, a changed file) starts over from 0.
//!
//! Events go to `window.__zoggyfinDesktop.download(event)` as JSON:
//! `begin`, `progress`, `done` and `error`.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::io::AsyncWriteExt;

/// The control flag of a running task.
const RUN: u8 = 0;
const PAUSE: u8 = 1;
const STOP: u8 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskState {
    Downloading,
    Paused,
    Done,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskMeta {
    pub id: String,
    pub url: String,
    pub destination: PathBuf,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub state: TaskState,
    #[serde(default)]
    pub bytes_done: u64,
    #[serde(default)]
    pub bytes_total: u64,
    /// ETag or Last-Modified of the first response, sent as If-Range on a resume.
    #[serde(default)]
    pub validator: Option<String>,
}

struct Task {
    meta: TaskMeta,
    /// Set while a transfer runs.
    flag: Option<Arc<AtomicU8>>,
}

pub struct Downloads {
    root: PathBuf,
    tasks: Mutex<HashMap<String, Task>>,
    client: reqwest::Client,
}

fn part_path(dest: &Path) -> PathBuf {
    let mut s = dest.as_os_str().to_owned();
    s.push(".part");
    PathBuf::from(s)
}

/// A path relative to the data folder, with no `..` and no root.
pub fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative.trim_start_matches('/'));
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("not a relative path: {relative}"));
    }
    Ok(root.join(rel))
}

/// An absolute path that must be inside the data folder.
fn inside(root: &Path, path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() && path.components().all(|c| !matches!(c, Component::ParentDir)) && path.starts_with(root) {
        Ok(path.to_path_buf())
    } else {
        Err("the destination is outside the app data folder".into())
    }
}

impl Downloads {
    pub fn new(root: PathBuf) -> Self {
        let tasks = std::fs::read(root.join("download-tasks.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Vec<TaskMeta>>(&b).ok())
            .unwrap_or_default()
            .into_iter()
            .map(|meta| (meta.id.clone(), Task { meta, flag: None }))
            .collect();
        let client = reqwest::Client::builder()
            .user_agent("Zoggyfin Desktop")
            .connect_timeout(Duration::from_secs(20))
            .read_timeout(Duration::from_secs(60))
            .build()
            .expect("an HTTP client");
        Downloads {
            root,
            tasks: Mutex::new(tasks),
            client,
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn save(&self, tasks: &HashMap<String, Task>) {
        let list: Vec<&TaskMeta> = tasks.values().map(|t| &t.meta).collect();
        let path = self.root.join("download-tasks.json");
        let tmp = self.root.join("download-tasks.json.tmp");
        let _ = std::fs::create_dir_all(&self.root);
        if let Ok(bytes) = serde_json::to_vec(&list) {
            // The file holds the request headers (the access token): only the user can read it.
            if std::fs::write(&tmp, bytes).is_ok() {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
                }
                let _ = std::fs::rename(&tmp, &path);
            }
        }
    }

    fn update(&self, id: &str, f: impl FnOnce(&mut TaskMeta)) {
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(t) = tasks.get_mut(id) {
            f(&mut t.meta);
            self.save(&tasks);
        }
    }

    /// Starts a transfer for a task in the list. `resume` keeps the partial file.
    fn spawn<R: Runtime>(self: &Arc<Self>, app: &AppHandle<R>, id: &str, resume: bool) {
        let flag = Arc::new(AtomicU8::new(RUN));
        let meta = {
            let mut tasks = self.tasks.lock().unwrap();
            let Some(t) = tasks.get_mut(id) else { return };
            if let Some(old) = t.flag.replace(flag.clone()) {
                old.store(STOP, Ordering::Release);
            }
            t.meta.state = TaskState::Downloading;
            let meta = t.meta.clone();
            self.save(&tasks);
            meta
        };
        let this = self.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let result = this.transfer(&app, &meta, resume, &flag).await;
            let state = flag.load(Ordering::Acquire);
            {
                let mut tasks = this.tasks.lock().unwrap();
                let current = tasks.get(&meta.id).and_then(|t| t.flag.clone());
                // A newer transfer for this id took over: it owns the task now.
                if !current.is_some_and(|f| Arc::ptr_eq(&f, &flag)) {
                    return;
                }
                if let Some(t) = tasks.get_mut(&meta.id) {
                    t.flag = None;
                }
                if state == STOP {
                    tasks.remove(&meta.id);
                    this.save(&tasks);
                    drop(tasks);
                    let _ = std::fs::remove_file(part_path(&meta.destination));
                    return;
                }
            }
            match result {
                Ok(Outcome::Paused(done)) => this.update(&meta.id, |m| {
                    m.state = TaskState::Paused;
                    m.bytes_done = done;
                }),
                Ok(Outcome::Done(bytes)) => {
                    this.update(&meta.id, |m| {
                        m.state = TaskState::Done;
                        m.bytes_done = bytes;
                    });
                    emit(&app, json!({ "type": "done", "id": meta.id, "bytes": bytes }));
                }
                Err((message, code)) => {
                    this.update(&meta.id, |m| m.state = TaskState::Failed);
                    emit(
                        &app,
                        json!({ "type": "error", "id": meta.id, "message": message, "code": code }),
                    );
                }
            }
        });
    }

    async fn transfer<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        meta: &TaskMeta,
        resume: bool,
        flag: &AtomicU8,
    ) -> Result<Outcome, (String, u16)> {
        let io = |e: std::io::Error| (e.to_string(), 0u16);
        let part = part_path(&meta.destination);
        if let Some(dir) = part.parent() {
            tokio::fs::create_dir_all(dir).await.map_err(io)?;
        }
        let mut offset = if resume {
            tokio::fs::metadata(&part).await.map(|m| m.len()).unwrap_or(0)
        } else {
            let _ = tokio::fs::remove_file(&part).await;
            0
        };
        let expected = (meta.bytes_total > 0).then_some(meta.bytes_total);
        let (mut resp, ranged) = loop {
            let mut req = self.client.get(&meta.url);
            for (k, v) in &meta.headers {
                req = req.header(k, v);
            }
            if offset > 0 {
                req = req.header(reqwest::header::RANGE, format!("bytes={offset}-"));
                if let Some(tag) = &meta.validator {
                    req = req.header(reqwest::header::IF_RANGE, tag);
                }
            }
            let resp = req.send().await.map_err(|e| (e.to_string(), 0))?;
            let status = resp.status().as_u16();
            if offset == 0 {
                if !resp.status().is_success() {
                    return Err((format!("HTTP {status}"), status));
                }
                break (resp, false);
            }
            match range_fit(
                status,
                header(resp.headers(), reqwest::header::CONTENT_RANGE),
                offset,
                expected,
            ) {
                RangeFit::Complete => {
                    tokio::fs::rename(&part, &meta.destination).await.map_err(io)?;
                    return Ok(Outcome::Done(offset));
                }
                RangeFit::Append => break (resp, true),
                // The whole file again (no Range support, a transcode, or If-Range saw a change).
                RangeFit::Whole => break (resp, false),
                RangeFit::Restart => {
                    // The range does not fit the partial file: ask again for the whole file.
                    let _ = tokio::fs::remove_file(&part).await;
                    offset = 0;
                }
                RangeFit::Failed => return Err((format!("HTTP {status}"), status)),
            }
        };
        if !ranged {
            offset = 0;
        }
        let total = if ranged {
            content_range_total(resp.headers()).or_else(|| resp.content_length().map(|l| l + offset))
        } else {
            resp.content_length()
        }
        .unwrap_or(0);
        let validator = validator_of(resp.headers()).or_else(|| meta.validator.clone());
        if validator != meta.validator || (total > 0 && total != meta.bytes_total) {
            let tag = validator.clone();
            self.update(&meta.id, |m| {
                m.validator = tag;
                if total > 0 {
                    m.bytes_total = total;
                }
            });
        }
        emit(
            app,
            json!({ "type": "begin", "id": meta.id, "expected": total, "validator": validator }),
        );
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(ranged)
            .truncate(!ranged)
            .open(&part)
            .await
            .map_err(io)?;
        let mut done = offset;
        let mut last = Instant::now();
        let mut saved = Instant::now();
        loop {
            match flag.load(Ordering::Acquire) {
                PAUSE => {
                    file.flush().await.map_err(io)?;
                    return Ok(Outcome::Paused(done));
                }
                STOP => return Ok(Outcome::Paused(done)),
                _ => {}
            }
            let chunk = match resp.chunk().await {
                Ok(Some(c)) => c,
                Ok(None) => break,
                Err(e) => {
                    let _ = file.flush().await;
                    return Err((e.to_string(), 0));
                }
            };
            file.write_all(&chunk).await.map_err(io)?;
            done += chunk.len() as u64;
            if last.elapsed() >= Duration::from_millis(500) {
                last = Instant::now();
                emit(
                    app,
                    json!({ "type": "progress", "id": meta.id, "done": done, "total": total }),
                );
            }
            if saved.elapsed() >= Duration::from_secs(5) {
                saved = Instant::now();
                self.update(&meta.id, |m| {
                    m.bytes_done = done;
                    m.bytes_total = total;
                });
            }
        }
        file.flush().await.map_err(io)?;
        drop(file);
        if total > 0 && done < total {
            return Err(("The connection was lost".into(), 0));
        }
        emit(
            app,
            json!({ "type": "progress", "id": meta.id, "done": done, "total": total.max(done) }),
        );
        tokio::fs::rename(&part, &meta.destination).await.map_err(io)?;
        Ok(Outcome::Done(done))
    }
}

enum Outcome {
    Paused(u64),
    Done(u64),
}

/// The full size from `Content-Range: bytes 100-199/1000`.
fn content_range_total(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let v = headers.get(reqwest::header::CONTENT_RANGE)?.to_str().ok()?;
    v.rsplit('/').next()?.trim().parse().ok()
}

fn header(headers: &reqwest::header::HeaderMap, name: reqwest::header::HeaderName) -> Option<&str> {
    headers.get(name)?.to_str().ok()
}

/// A strong ETag, else Last-Modified: the values that If-Range accepts.
fn validator_of(headers: &reqwest::header::HeaderMap) -> Option<String> {
    header(headers, reqwest::header::ETAG)
        .filter(|t| !t.starts_with("W/"))
        .or_else(|| header(headers, reqwest::header::LAST_MODIFIED))
        .map(str::to_owned)
}

/// How a server answered `Range: bytes=<offset>-`.
#[derive(Debug, PartialEq, Eq)]
enum RangeFit {
    /// 206 from the offset, with the known total: append to the partial file.
    Append,
    /// 200: the whole file.
    Whole,
    /// 416 for a partial file that is the whole file.
    Complete,
    /// The range does not fit the partial file: start over from 0.
    Restart,
    /// An HTTP error that a new request does not fix.
    Failed,
}

/// `Content-Range: bytes 100-199/1000` (or `bytes */1000` on a 416) → (start, total).
fn parse_content_range(v: &str) -> Option<(Option<u64>, Option<u64>)> {
    let rest = v.trim().strip_prefix("bytes")?.trim();
    let (range, total) = rest.split_once('/')?;
    let total = total.trim().parse().ok();
    let start = match range.trim() {
        "*" => None,
        r => Some(r.split_once('-')?.0.trim().parse().ok()?),
    };
    Some((start, total))
}

fn range_fit(status: u16, content_range: Option<&str>, offset: u64, expected: Option<u64>) -> RangeFit {
    let parsed = content_range.and_then(parse_content_range);
    match status {
        200 => RangeFit::Whole,
        206 => match parsed {
            Some((Some(start), total))
                if start == offset
                    && total.or(expected).is_some_and(|t| t > offset)
                    && (expected.is_none() || total.is_none() || total == expected) =>
            {
                RangeFit::Append
            }
            _ => RangeFit::Restart,
        },
        416 => match parsed.and_then(|(_, total)| total).or(expected) {
            Some(total) if total == offset => RangeFit::Complete,
            _ => RangeFit::Restart,
        },
        s if (200..300).contains(&s) => RangeFit::Restart,
        _ => RangeFit::Failed,
    }
}

fn emit<R: Runtime>(app: &AppHandle<R>, event: Value) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(format!(
            "window.__zoggyfinDesktop&&window.__zoggyfinDesktop.download&&window.__zoggyfinDesktop.download({event})"
        ));
    }
}

pub type DownloadsState = Arc<Downloads>;

// ---- Engine commands (src/downloads/desktop.ts) ---------------------------------------

#[derive(Deserialize)]
pub struct StartArgs {
    id: String,
    url: String,
    destination: PathBuf,
    #[serde(default)]
    headers: HashMap<String, String>,
    /// Set when the web app wants a partial file of an earlier try to continue.
    #[serde(default)]
    resume: Option<ResumeArgs>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeArgs {
    #[serde(default)]
    expected_bytes: Option<u64>,
    #[serde(default)]
    validator: Option<String>,
}

#[tauri::command]
pub fn download_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DownloadsState>,
    task: StartArgs,
) -> Result<(), String> {
    let destination = inside(state.root(), &task.destination)?;
    let resume = {
        let mut tasks = state.tasks.lock().unwrap();
        let old = tasks.get(&task.id).map(|t| &t.meta);
        // The same item failed before: continue its partial file.
        let failed = old.is_some_and(|m| m.destination == destination && m.state == TaskState::Failed);
        let same = old.filter(|m| m.destination == destination);
        let bytes_total = task
            .resume
            .as_ref()
            .and_then(|r| r.expected_bytes)
            .or_else(|| same.map(|m| m.bytes_total))
            .unwrap_or(0);
        let validator = task
            .resume
            .as_ref()
            .and_then(|r| r.validator.clone())
            .or_else(|| same.and_then(|m| m.validator.clone()));
        let resume = failed || task.resume.is_some();
        if let Some(old) = tasks.get(&task.id).and_then(|t| t.flag.clone()) {
            old.store(STOP, Ordering::Release);
        }
        tasks.insert(
            task.id.clone(),
            Task {
                meta: TaskMeta {
                    id: task.id.clone(),
                    url: task.url,
                    destination,
                    headers: task.headers,
                    state: TaskState::Downloading,
                    bytes_done: 0,
                    bytes_total: if resume { bytes_total } else { 0 },
                    validator: if resume { validator } else { None },
                },
                flag: None,
            },
        );
        resume
    };
    state.inner().spawn(&app, &task.id, resume);
    Ok(())
}

#[tauri::command]
pub fn download_pause(state: State<'_, DownloadsState>, id: String) {
    let mut tasks = state.tasks.lock().unwrap();
    if let Some(t) = tasks.get_mut(&id) {
        if let Some(f) = &t.flag {
            f.store(PAUSE, Ordering::Release);
        } else if t.meta.state == TaskState::Downloading {
            t.meta.state = TaskState::Paused;
            state.save(&tasks);
        }
    }
}

/// Continues a paused task. False when there is no such task: the web app then starts it again.
#[tauri::command]
pub fn download_resume<R: Runtime>(app: AppHandle<R>, state: State<'_, DownloadsState>, id: String) -> bool {
    let (known, run) = {
        let tasks = state.tasks.lock().unwrap();
        match tasks.get(&id) {
            None => (false, false),
            Some(t) => (
                true,
                t.flag.is_none()
                    && matches!(
                        t.meta.state,
                        TaskState::Paused | TaskState::Failed | TaskState::Downloading
                    ),
            ),
        }
    };
    if run {
        state.inner().spawn(&app, &id, true);
    }
    known
}

#[tauri::command]
pub fn download_stop(state: State<'_, DownloadsState>, id: String) {
    let mut tasks = state.tasks.lock().unwrap();
    let Some(t) = tasks.get(&id) else { return };
    if let Some(f) = &t.flag {
        // The transfer removes the task and its partial file when it stops.
        f.store(STOP, Ordering::Release);
        return;
    }
    let part = part_path(&t.meta.destination);
    tasks.remove(&id);
    state.save(&tasks);
    let _ = std::fs::remove_file(part);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingTask {
    id: String,
    state: TaskState,
    bytes_done: u64,
    bytes_total: u64,
}

/// The tasks of the last run. Downloads that ran when the app quit continue now.
#[tauri::command]
pub fn download_existing<R: Runtime>(app: AppHandle<R>, state: State<'_, DownloadsState>) -> Vec<ExistingTask> {
    let mut out = Vec::new();
    let mut restart = Vec::new();
    {
        let tasks = state.tasks.lock().unwrap();
        for t in tasks.values() {
            let part = std::fs::metadata(part_path(&t.meta.destination))
                .map(|m| m.len())
                .unwrap_or(0);
            let done = if t.meta.state == TaskState::Done {
                t.meta.bytes_done
            } else {
                part
            };
            if t.meta.state == TaskState::Downloading && t.flag.is_none() {
                restart.push(t.meta.id.clone());
            }
            out.push(ExistingTask {
                id: t.meta.id.clone(),
                state: t.meta.state,
                bytes_done: done,
                bytes_total: t.meta.bytes_total,
            });
        }
    }
    for id in restart {
        state.inner().spawn(&app, &id, true);
    }
    out
}

/// The web app saved the finished download: forget the task.
#[tauri::command]
pub fn download_finish(state: State<'_, DownloadsState>, id: String) {
    let mut tasks = state.tasks.lock().unwrap();
    if tasks
        .get(&id)
        .is_some_and(|t| t.flag.is_none() && t.meta.state != TaskState::Downloading)
    {
        tasks.remove(&id);
        state.save(&tasks);
    }
}

// ---- File commands (paths relative to the data folder) ---------------------------------

#[tauri::command]
pub fn files_ensure_dir(state: State<'_, DownloadsState>, path: String) -> Result<(), String> {
    std::fs::create_dir_all(safe_join(state.root(), &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn files_remove(state: State<'_, DownloadsState>, path: String) -> Result<(), String> {
    let p = safe_join(state.root(), &path)?;
    if p == state.root() {
        return Err("will not remove the data folder".into());
    }
    let r = if p.is_dir() {
        std::fs::remove_dir_all(&p)
    } else {
        std::fs::remove_file(&p)
    };
    match r {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn files_write_text(state: State<'_, DownloadsState>, path: String, text: String) -> Result<(), String> {
    let p = safe_join(state.root(), &path)?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn files_read_text(state: State<'_, DownloadsState>, path: String) -> Option<String> {
    std::fs::read_to_string(safe_join(state.root(), &path).ok()?).ok()
}

#[tauri::command]
pub fn files_size(state: State<'_, DownloadsState>, path: String) -> u64 {
    safe_join(state.root(), &path)
        .ok()
        .and_then(|p| std::fs::metadata(p).ok())
        .map_or(0, |m| m.len())
}

#[tauri::command]
pub fn files_list_dirs(state: State<'_, DownloadsState>, path: String) -> Vec<String> {
    let Ok(p) = safe_join(state.root(), &path) else {
        return Vec::new();
    };
    std::fs::read_dir(p)
        .map(|rd| {
            rd.filter_map(Result::ok)
                .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Downloads a small file (an image or a subtitle). Returns its size.
#[tauri::command]
pub async fn files_fetch(
    state: State<'_, DownloadsState>,
    url: String,
    path: String,
    headers: Option<HashMap<String, String>>,
) -> Result<u64, String> {
    let p = safe_join(state.root(), &path)?;
    let mut req = state.client.get(&url);
    for (k, v) in headers.unwrap_or_default() {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if let Some(dir) = p.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(|e| e.to_string())?;
    }
    tokio::fs::write(&p, &bytes).await.map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

#[derive(Serialize)]
pub struct DiskSpace {
    free: u64,
    total: u64,
}

#[cfg(windows)]
#[tauri::command]
pub fn files_disk_space(state: State<'_, DownloadsState>) -> Option<DiskSpace> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let _ = std::fs::create_dir_all(state.root());
    let path: Vec<u16> = state.root().as_os_str().encode_wide().chain(Some(0)).collect();
    let (mut free, mut total) = (0u64, 0u64);
    // SAFETY: a NUL-terminated wide string and out pointers to two u64s.
    unsafe { GetDiskFreeSpaceExW(PCWSTR(path.as_ptr()), Some(&mut free), Some(&mut total), None) }.ok()?;
    Some(DiskSpace { free, total })
}

#[cfg(unix)]
#[tauri::command]
pub fn files_disk_space(state: State<'_, DownloadsState>) -> Option<DiskSpace> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(state.root().as_os_str().as_bytes()).ok()?;
    let _ = std::fs::create_dir_all(state.root());
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: a valid C string and an out pointer to a zeroed struct.
    if unsafe { libc::statvfs(path.as_ptr(), &mut s) } != 0 {
        return None;
    }
    let frag = s.f_frsize as u64;
    Some(DiskSpace {
        free: s.f_bavail as u64 * frag,
        total: s.f_blocks as u64 * frag,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_join_keeps_paths_inside() {
        let root = Path::new("/data");
        assert_eq!(
            safe_join(root, "downloads/a/media.mkv").unwrap(),
            PathBuf::from("/data/downloads/a/media.mkv")
        );
        assert_eq!(safe_join(root, "/downloads").unwrap(), PathBuf::from("/data/downloads"));
        assert!(safe_join(root, "downloads/../../etc").is_err());
        assert!(safe_join(root, "./x").is_err());
    }

    /// An absolute path ("/data" has no drive on Windows, so it is not absolute there).
    #[cfg(unix)]
    const ABS: &str = "";
    #[cfg(windows)]
    const ABS: &str = "C:";

    #[test]
    fn inside_rejects_other_folders() {
        let at = |p: &str| PathBuf::from(format!("{ABS}{p}"));
        let root = at("/data");
        assert!(inside(&root, &at("/data/downloads/a/media.mkv")).is_ok());
        assert!(inside(&root, &at("/data/../etc/passwd")).is_err());
        assert!(inside(&root, &at("/tmp/x")).is_err());
        assert!(inside(&root, Path::new("data/x")).is_err());
    }

    /// The page joins its paths with "/" onto the data folder that Windows gives with "\".
    #[cfg(windows)]
    #[test]
    fn inside_accepts_mixed_separators_on_windows() {
        let root = Path::new(r"C:\Users\me\AppData\Roaming\com.zogtech.zoggyfin.desktop");
        let page = r"C:\Users\me\AppData\Roaming\com.zogtech.zoggyfin.desktop/downloads/a/media.mkv";
        assert!(inside(root, Path::new(page)).is_ok());
        assert!(inside(root, Path::new(r"C:\Users\me\AppData\Roaming\other/x")).is_err());
    }

    #[test]
    fn a_range_must_fit_the_partial_file() {
        // 206 from the offset with the known total: append.
        assert_eq!(
            range_fit(206, Some("bytes 100-999/1000"), 100, Some(1000)),
            RangeFit::Append
        );
        assert_eq!(range_fit(206, Some("bytes 100-999/1000"), 100, None), RangeFit::Append);
        // Another start or another total: start over.
        assert_eq!(
            range_fit(206, Some("bytes 0-999/1000"), 100, Some(1000)),
            RangeFit::Restart
        );
        assert_eq!(
            range_fit(206, Some("bytes 100-1999/2000"), 100, Some(1000)),
            RangeFit::Restart
        );
        assert_eq!(range_fit(206, None, 100, Some(1000)), RangeFit::Restart);
        // 200: the whole file again.
        assert_eq!(range_fit(200, None, 100, Some(1000)), RangeFit::Whole);
        // 416: complete only when the partial file has every byte.
        assert_eq!(range_fit(416, Some("bytes */1000"), 1000, None), RangeFit::Complete);
        assert_eq!(range_fit(416, None, 1000, Some(1000)), RangeFit::Complete);
        assert_eq!(
            range_fit(416, Some("bytes */1000"), 1200, Some(1000)),
            RangeFit::Restart
        );
        assert_eq!(range_fit(416, None, 100, None), RangeFit::Restart);
        // Other errors stay errors.
        assert_eq!(range_fit(404, None, 100, None), RangeFit::Failed);
    }

    #[test]
    fn reads_the_validator() {
        let mut h = reqwest::header::HeaderMap::new();
        h.insert(
            reqwest::header::LAST_MODIFIED,
            "Tue, 01 Sep 2026 10:00:00 GMT".parse().unwrap(),
        );
        assert_eq!(validator_of(&h).as_deref(), Some("Tue, 01 Sep 2026 10:00:00 GMT"));
        h.insert(reqwest::header::ETAG, "W/\"weak\"".parse().unwrap());
        assert_eq!(validator_of(&h).as_deref(), Some("Tue, 01 Sep 2026 10:00:00 GMT"));
        h.insert(reqwest::header::ETAG, "\"strong\"".parse().unwrap());
        assert_eq!(validator_of(&h).as_deref(), Some("\"strong\""));
    }

    #[test]
    fn reads_the_content_range_total() {
        let mut h = reqwest::header::HeaderMap::new();
        h.insert(reqwest::header::CONTENT_RANGE, "bytes 100-199/1000".parse().unwrap());
        assert_eq!(content_range_total(&h), Some(1000));
        h.insert(reqwest::header::CONTENT_RANGE, "bytes 100-199/*".parse().unwrap());
        assert_eq!(content_range_total(&h), None);
    }
}
