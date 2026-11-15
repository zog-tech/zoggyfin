# Zoggyfin desktop

The desktop app is a [Tauri 2](https://tauri.app) window around the Zoggyfin web build.
Video plays through [libmpv](https://mpv.io), the model of Jellyfin Media Player.
The first target is macOS on Apple Silicon. Windows runs from the same code (see [Windows](#windows));
Linux comes later.

## How it works

- The window loads the web build (`dist/`, from `pnpm expo export --platform web`).
  In development it loads Metro web at `http://localhost:8082`.
- `src/platform/desktop.ts` finds the desktop app (`window.__TAURI_INTERNALS__`).
  In a browser and on iPhone and iPad it does nothing.
- Video: the player uses `src/player/engine-mpv.ts` in place of the HTML `<video>` element.
  The device profile (`mpvCapabilities` in `src/player/device-profile.ts`) asks the server
  for direct play of almost every file: MKV, HEVC, AV1, VP9, DTS, TrueHD, and ASS, SRT, PGS
  and DVD subtitles. libmpv opens the static stream URL of the original file.
  libmpv switches audio and subtitle tracks inside the file, so no new stream is necessary.
  Progress goes to the server through the same `ProgressReporter` as on the other platforms
  (start, every 10 seconds, pause, seek and stop).
- Music and audiobooks use the web audio engine. WebKit gives it Now Playing and the media
  keys through the Media Session API.
- Downloads: see [Downloads](#downloads).
- Now Playing and media keys for libmpv video: see [Now Playing](#now-playing-and-media-keys).

### Video surface (macOS)

libmpv draws with its render API into a `CAOpenGLLayer` (the approach of IINA).
The layer is in a view under the `WKWebView`, in the window's content view.
The web view is transparent (`transparent: true` and `macOSPrivateApi: true`).
While the player is open, the page hides what is under the player and makes the player
background transparent. Thus the video shows through, and the normal Zoggyfin controls
draw over it. libmpv decodes with VideoToolbox (`hwdec=auto-safe`).

Why this approach: libmpv on macOS does not support `--wid` embedding, and a separate mpv
window that follows the main window has focus, Spaces and full-screen problems.
The render API in a layer under the web view gives one window, real overlays and
correct full screen.

Note: Apple marks OpenGL as deprecated, but it still works on macOS 26.
libmpv has no Metal render API yet. If OpenGL goes away, a libmpv Vulkan (MoltenVK) or
Metal render path takes its place behind the same view.

### Rust side (`src-tauri/`)

| File | What it does |
|---|---|
| `src/lib.rs` | Starts libmpv, makes the window, adds the commands |
| `src/menu.rs` | App, Edit, View, Window and Help menus |
| `src/mpv/ffi.rs` | The libmpv C API that the app uses (hand-written from the headers) |
| `src/mpv/player.rs` | One libmpv instance; events go to the page as JSON |
| `src/mpv/view_macos.rs` | The OpenGL layer under the web view |
| `src/downloads.rs` | Downloads (HTTP, resume, progress) and the file commands |
| `src/media_macos.rs` | Now Playing and the media keys for libmpv video |
| `src/debug.rs` | Test automation, in debug builds only (see below) |

Commands: `mpv_command`, `mpv_set_property`, `mpv_get_property`, `mpv_set_video_visible`,
`desktop_toggle_fullscreen`, `download_*`, `files_*`, `now_playing_update`,
`now_playing_clear`. Events go to `window.__zoggyfinDesktop.mpv(event)`, `.download(event)`
and `.remote(command)`.

### Downloads

The Downloads tab shows in the desktop app. The records, the queue and the state rules are
the same code as on iPhone (`src/downloads/manager.ts`, `state-machine.ts`). The records are
in the page's storage, as on the web. Rust only moves bytes (`src/downloads/desktop.ts` is
the engine and the file interface over the Rust commands):

- Files are in `~/Library/Application Support/com.zogtech.zoggyfin.desktop/downloads/<itemId>/`,
  with the same layout as on iPhone: the media file, `item.json`, `primary.jpg`,
  `backdrop.jpg`, `subtitle-<index>.vtt`, `lyrics.json`.
- A download writes to `<file>.part` and renames it at the end. Pause keeps the partial file;
  resume continues with an HTTP `Range` request. A server that does not answer with 206
  (a transcode) sends the file again from the start.
- The task list is in `download-tasks.json` (mode 0600; it holds the request headers).
  After a restart, paused downloads stay paused and running downloads continue.
- Progress events come twice a second. The manager starts at most two downloads.
- Rust accepts only paths inside the data folder.
- The page loads local images, music and subtitles through Tauri's asset protocol
  (`asset://localhost/...`, limited to `$APPDATA/downloads/**`). libmpv gets the disk path
  (`localPath()` in `src/platform/desktop.ts`), so a downloaded video plays with no server.

### Now Playing and media keys

While libmpv plays, `MpvEngine` sends the title, the series line, the artwork URL, the
length, the position, the speed and the play state to `now_playing_update`. Rust writes them
to `MPNowPlayingInfoCenter` and adds handlers to `MPRemoteCommandCenter`: play, pause,
play/pause, next, previous, skip 10 s back and forward, and seek from the Control Center
bar. The handlers send the commands to the page. When playback stops, Rust removes the
handlers and clears Now Playing, so the media keys go back to the web audio engine.

Picture in Picture for libmpv video is not done. The system PiP window
(`AVPictureInPictureController`) needs an `AVPlayerLayer` or an
`AVSampleBufferDisplayLayer`. libmpv draws with OpenGL into a `CAOpenGLLayer`, so each frame
would have to go to an IOSurface-backed pixel buffer and then into a sample buffer, with its
own timing and the subtitles drawn in. That is a separate render path. The other choice,
a second small window with a second OpenGL layer, does not stay above full-screen apps or
show in Spaces the way PiP does. Both are too large for this step.

### Window and menus

- Transparent title bar with the window buttons over the page; a 28 pt strip at the top
  drags the window. Minimum size 900 × 600. The window keeps its size and position
  (`tauri-plugin-window-state`).
- ⌘, opens Settings. ⌘F opens Search. ⌘1, ⌘2 and ⌘3 open Home, Library and Music.
  ⌘[ goes back. ⌘R reloads. ⌃⌘F toggles full screen.
- Space (play and pause), the arrow keys, F (full screen), M and C stay in the page.

## Develop

For development, you need Rust (stable), pnpm and Homebrew libmpv:

```sh
brew install mpv
pnpm install
pnpm expo start --web --port 8082   # Metro web, in one terminal
pnpm desktop:dev                    # the desktop app, in another terminal
```

`MPV_LIB_DIR` changes where the build looks for `libmpv.dylib` (default `/opt/homebrew/lib`).
Set it to `<work>/libmpv/prefix/lib` to run a debug build with the LGPL libmpv (debug builds
have an rpath to that folder).

Build an app for testing (not signed for distribution):

```sh
pnpm desktop:build
# -> <cargo target dir>/release/bundle/macos/Zoggyfin.app
```

Checks for the Rust code:

```sh
cd desktop/src-tauri
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

### Test automation (debug builds)

Start a debug build with `ZOGGYFIN_AUTOMATION=<folder>`. The app runs `<folder>/cmd.js` in the
page and deletes it. A file `<folder>/snap` that holds a PNG path makes the app save a picture
of its window (video and page together); an app can capture its own window without the
screen recording permission. Scripts write lines to `<folder>/out.log` with
`__TAURI_INTERNALS__.invoke('debug_log', { line })`. Release builds do not contain this code.

## Updates

The app updates itself with the [Tauri updater](https://v2.tauri.app/plugin/updater/) and a
signed feed on Cloudflare R2: `https://releases.zog-tech.com/zoggyfin/latest.json`
(`plugins.updater` in `tauri.conf.json`, with the public key).

- The web app (`src/platform/updates/`) checks 10 s after start and every 4 hours in release
  builds. "Check for Updates…" in the app menu and in Settings checks at once. The state rules
  (`machine.ts`) and the version compare (`version.ts`) are pure code with unit tests.
- The update card (`src/features/updates/update-card.tsx`, design system §7.18) shows the new
  version and its notes, "Install and restart" and "Later", a progress bar, and the errors.
  "Later" keeps quiet for that version only. In a browser and on iPhone and iPad nothing shows.
- Rust (`src-tauri/src/update.rs`) checks, downloads (progress events to
  `window.__zoggyfinDesktop.update`), checks the signature, and installs. These rules came from
  the problems of an earlier Tauri app:
  - The update goes into the bundle that the user installed: the real path of the executable,
    or the original path when macOS translocated the app.
  - Relaunch: a detached shell waits until the old process has exited, then runs `open` on the
    same bundle path (no `-n`). Tauri's `restart()` starts the new process while the old one
    runs, and the Dock then shows two icons.
  - A release build that runs from the disk image, App Translocation or `~/Downloads` asks to
    move to Applications ("Do not ask again" is kept in the app config folder). The copy is made
    with `ditto` and loses the quarantine attribute, so it is not translocated again.
  - The single-instance plugin: a second start focuses the running window.
  - `panic = "unwind"` in the release profile (`lib.rs` refuses "abort"): wry catches WebKit's
    Objective-C exceptions by unwinding through Rust.
  - An app on the Desktop needs the macOS Desktop folder permission for the swap. The install
    waits until the user answers.

## Publish a release

One command builds, signs, notarizes, uploads and makes the GitHub release:

```sh
pnpm desktop:version 0.1.2   # tauri.conf.json, Cargo.toml and Cargo.lock; adds a CHANGELOG section
# write the notes in desktop/CHANGELOG.md, commit, push to main
pnpm desktop:publish
```

`desktop/scripts/publish.sh`:

1. Checks: the CHANGELOG has a section for the version, HEAD is on `origin/main`, the version
   is not on R2 yet, and the updater endpoint matches the R2 prefix.
2. Makes a clean git worktree of HEAD in `$BUILD_DIR/src` and runs `release.sh` there, so
   uncommitted files never ship.
3. Writes `latest.json` (version, notes from the CHANGELOG, date, the signature and the URL of
   the update archive).
4. Uploads to R2. The version files first, the feed last:

   | Path under `https://releases.zog-tech.com/zoggyfin/` | Cache |
   |---|---|
   | `<version>/Zoggyfin-<version>-arm64.dmg` | immutable |
   | `<version>/Zoggyfin-<version>-arm64.app.tar.gz` and `.sig` (the update) | immutable |
   | `<version>/latest.json` | no-cache |
   | `latest/Zoggyfin-arm64.dmg` (the website link: always the newest) | no-cache |
   | `latest.json` (the updater feed) | no-cache |

5. Makes the GitHub release `v<version>` with the DMG, the update archive, its signature and
   `latest.json`.

Secrets stay in `~/.config/zoggyfin-desktop/` (mode 600, never in the repository):
`notary.env` (Developer ID identity and the App Store Connect API key), `updater.env` and
`updater.key` (the updater private key and its password), `r2.env` (`R2_ENDPOINT`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PREFIX`, `R2_PUBLIC_URL`).
If the updater key is lost, installed apps cannot update any more: keep a backup of it.

Options: `SKIP_BUILD=1` (publish the last build), `SKIP_GITHUB=1`, and for test releases only
`ALLOW_UNPUSHED=1` and `REPUBLISH=1`.

## Release: LGPL libmpv, signing and notarization

```sh
pnpm desktop:release
# -> $BUILD_DIR/release/<version>/ Zoggyfin-<version>-arm64.dmg (signed, notarized, stapled),
#    Zoggyfin-<version>-arm64.app.tar.gz and .sig (the update), Zoggyfin.app
```

`desktop/scripts/release.sh` runs these steps:

1. `build-libmpv.sh`: builds libmpv and its libraries from source (see below).
2. `expo export --platform web`, then `tauri build --bundles app` with
   `MPV_LIB_DIR=<work>/libmpv/prefix/lib`.
3. `bundle-libmpv.sh`: copies libmpv and every library it needs into
   `Contents/Frameworks` and the license texts into `Contents/Resources/ThirdParty`. It stops
   when a binary links a path outside the bundle and the system (for example `/opt/homebrew`).
4. Signs each dylib, then the app, with the Developer ID identity, the hardened runtime and a
   secure timestamp. The entitlements file (`src-tauri/entitlements.plist`) is empty: all
   dylibs have the same Team ID, so library validation passes, and nothing uses JIT.
5. Notarizes the app (`notarytool --wait`) and staples it.
6. Makes the update archive: a `tar.gz` of the stapled app (with `COPYFILE_DISABLE=1`),
   signed with the updater key (`tauri signer sign`). Tauri's own updater archive is not used:
   Tauri makes it before libmpv goes in and before notarization.
7. Makes the DMG with `dmgbuild` (`desktop/dmg/settings.py`): a 600 × 380 window, the app on
   the left, a link to Applications on the right, and the background from
   `desktop/scripts/dmg-background.py`. `desktop/dmg/verify.py` checks the layout. Then it
   signs, notarizes and staples the DMG, and checks with `spctl -a -vvv -t install` and
   `codesign --verify --deep --strict`.

Settings: `BUILD_DIR` (a work folder with about 10 GB free, default
`/Users/Shared/zoggyfin-release`; not in the home folder, because FFmpeg keeps its build path
in the library and the privacy check stops on the home folder path), the updater file
(`ZOGGYFIN_UPDATER_ENV`, default `~/.config/zoggyfin-desktop/updater.env`) and a notary file
(`ZOGGYFIN_NOTARY_ENV`, default `~/.config/zoggyfin-desktop/notary.env`) with
`APPLE_SIGNING_IDENTITY`, `APPLE_API_KEY` (the key id), `APPLE_API_ISSUER` and
`APPLE_API_KEY_PATH` (the `.p8` file). Do not commit the notary file. `SKIP_NOTARIZE=1`
signs only. The script waits while an `eas build` runs, because that narrows the keychain
search list.

### The LGPL libmpv build

Zoggyfin is MPL-2.0. libmpv is LGPL-2.1+ only when mpv is built with `-Dgpl=false`.
The Homebrew build is a GPL build (Homebrew FFmpeg has `--enable-gpl`, x264 and x265).
Use Homebrew libmpv for development only. Do not ship it.

`desktop/scripts/build-libmpv.sh` builds for arm64 with a macOS 13.0 deployment target (the
`minimumSystemVersion` of the app). The script pins each version and the SHA-256 of each
source archive (libplacebo: a git commit). Only the work folder is used; pkg-config sees only
the work prefix, so no Homebrew library gets in.

| Library | Version | License | Notes |
|---|---|---|---|
| mpv (libmpv) | 0.41.0 | LGPL-2.1+ | `-Dgpl=false`, no `mpv` program, no Lua, no JavaScript; one upstream patch (audio device change crash on macOS 26) |
| FFmpeg | 9.0.2 | LGPL-2.1+ | `--disable-autodetect`; no `--enable-gpl`, `--enable-nonfree` or `--enable-version3`; VideoToolbox, AudioToolbox, Secure Transport (HTTPS), dav1d |
| libplacebo | 7.360.1 | LGPL-2.1+ | OpenGL only (no Vulkan, no shader compilers) |
| libass | 0.17.5 | ISC | Core Text fonts (no fontconfig) |
| HarfBuzz | 14.6.0 | MIT | |
| FreeType | 2.15.0 | FTL | |
| FriBidi | 1.0.17 | LGPL-2.1+ | |
| dav1d | 1.5.4 | BSD-2-Clause | AV1 software decoding |

Video decoding: VideoToolbox (`hwdec=auto-safe`, zero copy into OpenGL through
`videotoolbox-gl`), with dav1d and the FFmpeg decoders as the software path. mpv needs Cocoa
and its Swift helpers for `videotoolbox-gl`; they link only system Swift libraries.

The script checks the license at the end: `avutil_license()` and the other FFmpeg
`*_license()` calls (what `ffmpeg -L` prints) must say "LGPL version 2.1 or later", the FFmpeg
configuration must not have `CONFIG_GPL` or `CONFIG_NONFREE`, and the libmpv property
`mpv-configuration` (what `mpv --version` prints) must contain `-Dgpl=false`. Result of the
build for 0.1.0:

```text
avutil: LGPL version 2.1 or later   (avcodec, avformat, avfilter, swscale, swresample: the same)
mpv-version: mpv v0.41.0
mpv-configuration: ... -Dgpl=false -Dlibmpv=true -Dcplayer=false ...
ffmpeg-version: 9.0.2
```

The bundle has `Contents/Resources/ThirdParty/THIRD-PARTY-NOTICES.txt` (each library, its
version, license and source URL, and the written source offer) and the full license texts.
libmpv and FFmpeg are separate dylibs in `Contents/Frameworks`, so a user can replace them
(LGPL section 6). Do not copy GPL code into this repository.

**Local Network access.** libmpv opens its own connections to the server. For a server on
the local network, macOS asks once if Zoggyfin can find devices on the local network
(`NSLocalNetworkUsageDescription` in `Info.plist`). Until the user allows it, the pages
load (WebKit), but video stops with "loading failed". A debug build or a binary started from
a terminal uses the terminal's permission and does not show this.

`macOSPrivateApi` (transparent web view) is acceptable for Developer ID distribution but not
for the Mac App Store.

## Windows

The same app builds on Windows 10 and 11 (x86_64). The web build, the Rust commands,
downloads and IPTV are shared; the differences:

- **Video surface** (`src/mpv/view_windows.rs`): libmpv draws itself (`vo=gpu-next`,
  Direct3D 11, `hwdec=auto-safe` → D3D11VA) into a borderless window *behind* the main
  window, through `wid`. The main window stays transparent, so the clear parts of the page
  show the video. A child window under the web view does not work on Windows: a child
  window is clipped to what its siblings above leave free, and WebView2's host windows
  cover the whole client area. The video window owns the main window (`GWLP_HWNDPARENT`),
  so Windows keeps the main window right above it; it follows the client area on every
  move and resize, hides while the main window is minimized, never takes focus and is not
  in the taskbar.
- **Linking**: `src/mpv/ffi.rs` links `libmpv-2.dll` with `raw-dylib` (no import library).
  `build.rs` copies the DLL next to the executable for development; the installer has it
  as a resource (`tauri.windows.conf.json`). The app does not start without the DLL.
- **Window**: the normal Windows title bar (the page has no 28 px strip) and no menu bar.
  The page handles the shortcuts: Ctrl+, Settings, Ctrl+F Search, Ctrl+1/2/3 Home, Library
  and Music, Ctrl+[ or Alt+← Back, Ctrl+R reload, F11 full screen.
- **Asset URLs**: WebView2 serves Tauri's asset protocol as `http://asset.localhost/`.
- **Not on Windows yet**: updates (no Windows feed; `update.rs` is macOS only), Now Playing
  and the media keys for libmpv video (SMTC), Nearby mode (Swift), the network interface
  list for discovery (only the 255.255.255.255 broadcast), and test-automation pictures.

Develop on Windows. You need the Visual Studio C++ Build Tools, Rust (stable, MSVC), Node
and pnpm, and a libmpv development build:

```powershell
powershell -ExecutionPolicy Bypass -File desktop/scripts/windows/setup-libmpv.ps1
pnpm install
pnpm expo start --web --port 8082   # Metro web, in one terminal
pnpm desktop:dev                    # the desktop app, in another terminal
```

`pnpm desktop:build:windows` makes an NSIS installer (not signed). The development libmpv
from `setup-libmpv.ps1` (shinchiro/mpv-winbuild-cmake) is a GPL build: do not ship it.
A release needs an LGPL libmpv build for Windows, as on macOS.

## Left to do

- Picture in Picture for libmpv video (see above).
- Windows: an LGPL libmpv build, code signing, an update feed, SMTC media keys, the
  interface list for discovery.
- Linux: the same Rust code with a native window (`wid`) in place of `view_macos.rs`.
