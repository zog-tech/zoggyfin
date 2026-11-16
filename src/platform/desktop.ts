/**
 * The desktop app bridge. The desktop app (`desktop/`, Tauri) loads the web
 * build in a window and adds libmpv for video. This module finds out if the
 * web app runs there and gives the desktop features to the player.
 *
 * Screens do not import this module. The player (`src/player/`) uses it
 * through its engine interface. In a plain browser `isDesktop` is false and
 * nothing here runs.
 *
 * The Rust side calls `window.__zoggyfinDesktop.mpv(event)` for libmpv
 * events, `.menu(command)` for menu items, `.download(event)` for download
 * progress, `.remote(command)` for the media keys and Now Playing, and
 * `.update(event)` for the download progress of an app update.
 */
import { router } from 'expo-router';

interface TauriInternals {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

type DesktopWindow = Window & {
  __TAURI_INTERNALS__?: TauriInternals;
  __zoggyfinDesktop?: {
    mpv(event: MpvEvent): void;
    menu(command: string): void;
    download(event: DownloadEvent): void;
    remote(command: RemoteCommand): void;
    update(event: AppUpdateEvent): void;
    nearby(event: NearbyEvent): void;
  };
  /** Set by the desktop app before the page loads when libmpv started. */
  __ZOGGYFIN_MPV__?: boolean;
  /** The app data folder (absolute path), set by the desktop app before the page loads. */
  __ZOGGYFIN_DATA_DIR__?: string;
  /** The app version (tauri.conf.json), set by the desktop app before the page loads. */
  __ZOGGYFIN_VERSION__?: string;
  /** True in release builds: the app looks for updates by itself. */
  __ZOGGYFIN_AUTO_UPDATE__?: boolean;
  /** The operating system ("macos", "windows"). Desktop builds before 0.1.16 leave it out (macOS). */
  __ZOGGYFIN_PLATFORM__?: string;
};

function tauri(): TauriInternals | null {
  if (typeof window === 'undefined') return null;
  return (window as DesktopWindow).__TAURI_INTERNALS__ ?? null;
}

/** True in the desktop app (Tauri), false in a browser and on native. */
export const isDesktop: boolean = tauri() !== null;

/** True when the desktop app plays video through libmpv. */
export const hasMpv: boolean = isDesktop && (window as DesktopWindow).__ZOGGYFIN_MPV__ === true;

/** The app data folder (an absolute path) in the desktop app, else null. Downloads live under it. */
export const dataDir: string | null = (isDesktop && (window as DesktopWindow).__ZOGGYFIN_DATA_DIR__) || null;

/** The version of the desktop app, else null. */
export const appVersion: string | null = (isDesktop && (window as DesktopWindow).__ZOGGYFIN_VERSION__) || null;

/** True when the desktop app looks for updates by itself (release builds). */
export const autoUpdate: boolean = isDesktop && (window as DesktopWindow).__ZOGGYFIN_AUTO_UPDATE__ === true;

/** The operating system of the desktop app, else null. */
export const desktopPlatform: 'macos' | 'windows' | null = !isDesktop
  ? null
  : (window as DesktopWindow).__ZOGGYFIN_PLATFORM__ === 'windows'
    ? 'windows'
    : 'macos';

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = tauri();
  if (!t) return Promise.reject(new Error('Not in the desktop app.'));
  return t.invoke(cmd, args) as Promise<T>;
}

/** A track as libmpv lists it. `ffIndex` is the stream index in the file (Jellyfin's `Index`). */
export interface MpvTrack {
  id: number | null;
  type: 'video' | 'audio' | 'sub' | null;
  ffIndex: number | null;
  external: boolean;
  title: string | null;
  lang: string | null;
  codec: string | null;
  selected: boolean;
  /** The default and forced flags. Desktop builds before 0.1.12 leave them out. */
  isDefault?: boolean;
  forced?: boolean;
}

export type MpvEvent =
  | { type: 'prop'; name: string; value: number | boolean | string | null }
  | { type: 'tracks'; tracks: MpvTrack[] }
  | { type: 'start-file' | 'file-loaded' | 'playback-restart' | 'seek' }
  | { type: 'end-file'; reason: 'eof' | 'error' | 'stop' | 'quit' | 'redirect'; error: string | null };

const mpvListeners = new Set<(e: MpvEvent) => void>();

/** Download progress from the Rust downloader (`desktop/src-tauri/src/downloads.rs`). */
export type DownloadEvent =
  | { type: 'begin'; id: string; expected: number; validator?: string | null }
  | { type: 'progress'; id: string; done: number; total: number }
  | { type: 'done'; id: string; bytes: number }
  | { type: 'error'; id: string; message: string; code: number };

const downloadListeners = new Set<(e: DownloadEvent) => void>();

/** Download events. Returns the unsubscribe function. */
export function onDownloadEvent(listener: (e: DownloadEvent) => void): () => void {
  downloadListeners.add(listener);
  return () => downloadListeners.delete(listener);
}

/** A media key, a Control Center button or a Now Playing seek (macOS). */
export type RemoteCommand =
  | { command: 'play' | 'pause' | 'toggle' | 'next' | 'previous' }
  | { command: 'skip'; seconds: number }
  | { command: 'seek'; position: number };

const remoteListeners = new Set<(c: RemoteCommand) => void>();

/** The download progress of an app update (`desktop/src-tauri/src/update.rs`). */
export type AppUpdateEvent = { type: 'progress'; done: number; total: number };

const updateListeners = new Set<(e: AppUpdateEvent) => void>();

/** App update events. Returns the unsubscribe function. */
export function onUpdateEvent(listener: (e: AppUpdateEvent) => void): () => void {
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}

/** An event of the nearby transport (`desktop/src-tauri/src/nearby.rs`); see `src/together/link-desktop.ts`. */
export type NearbyEvent = { event: string; body: Record<string, unknown> };

const nearbyListeners = new Set<(e: NearbyEvent) => void>();

/** Nearby transport events. Returns the unsubscribe function. */
export function onNearbyEvent(listener: (e: NearbyEvent) => void): () => void {
  nearbyListeners.add(listener);
  return () => nearbyListeners.delete(listener);
}

const menuListeners = new Set<(command: string) => void>();

/** Menu commands that a module handles itself (for example "check-updates"). */
export function onMenuCommand(listener: (command: string) => void): () => void {
  menuListeners.add(listener);
  return () => menuListeners.delete(listener);
}

/** What the system shows in Now Playing for libmpv video. */
export interface NowPlayingInfo {
  title: string;
  subtitle?: string;
  artworkUrl?: string;
  duration: number;
  position: number;
  playing: boolean;
  rate: number;
}

/** Now Playing and the media keys for libmpv video (macOS; elsewhere the calls do nothing). */
export const nowPlaying = {
  update: (info: NowPlayingInfo): Promise<void> => invoke('now_playing_update', { info }),
  clear: (): Promise<void> => invoke('now_playing_clear'),
  onRemote(listener: (c: RemoteCommand) => void): () => void {
    remoteListeners.add(listener);
    return () => remoteListeners.delete(listener);
  },
};

/**
 * The URL prefix of Tauri's asset protocol, which serves local files to the page.
 * WebView2 (Windows) serves custom protocols as `http://<scheme>.localhost/`.
 */
const ASSET_PREFIX = desktopPlatform === 'windows' ? 'http://asset.localhost/' : 'asset://localhost/';

/**
 * A page URL for a folder on the disk. The page cannot load `file://` URLs;
 * Tauri's asset protocol serves the files (with HTTP ranges, for audio seeks).
 */
export function assetUrl(path: string): string {
  return ASSET_PREFIX + encodeURIComponent(path.replace(/\/+$/, ''));
}

/** The disk path of a local URL (`asset://` or `file://`), for libmpv. Other URLs stay as they are. */
export function localPath(uri: string): string {
  if (uri.startsWith(ASSET_PREFIX)) return decodeURIComponent(uri.slice(ASSET_PREFIX.length));
  if (uri.startsWith('file://')) return decodeURIComponent(uri.slice('file://'.length));
  return uri;
}

/** libmpv in the desktop app. All calls fail outside the desktop app. */
export const mpv = {
  command: (...args: (string | number)[]): Promise<void> => invoke('mpv_command', { args: args.map(String) }),
  set: (name: string, value: string | number | boolean): Promise<void> =>
    invoke('mpv_set_property', { name, value: typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value) }),
  get: (name: string): Promise<string | null> => invoke('mpv_get_property', { name }),
  /** Shows the video under the web page (the player is open) or hides it. */
  setVideoVisible: (visible: boolean): Promise<void> => invoke('mpv_set_video_visible', { visible }),
  subscribe(listener: (e: MpvEvent) => void): () => void {
    mpvListeners.add(listener);
    return () => mpvListeners.delete(listener);
  },
};

/**
 * Fetches an IPTV list, guide or API answer in Rust (`iptv_fetch`): no CORS,
 * with the provider's user agent, http and https only, at most `maxBytes`.
 * The bytes come back as they are (gzip is inflated by the caller). An error
 * is a short text with no URL (`HTTP 404`, `too large`, `bad address`).
 */
export async function iptvFetch(url: string, userAgent: string | null, maxBytes: number): Promise<Uint8Array> {
  const out = await invoke<ArrayBuffer | number[]>('iptv_fetch', { url, userAgent, maxBytes });
  return out instanceof ArrayBuffer ? new Uint8Array(out) : Uint8Array.from(out);
}

/** Window features of the desktop app. */
export const desktopWindow = {
  toggleFullscreen: (): Promise<boolean> => invoke<boolean>('desktop_toggle_fullscreen'),
};

/** Menu items that the web app handles. Space stays with the page (play/pause). */
function onMenu(command: string): void {
  menuListeners.forEach((l) => l(command));
  switch (command) {
    case 'settings':
      router.navigate('/settings');
      break;
    case 'search':
      router.navigate('/search');
      break;
    case 'home':
      router.navigate('/');
      break;
    case 'library':
      router.navigate('/libraries');
      break;
    case 'music':
      router.navigate('/music');
      break;
    case 'back':
      if (router.canGoBack()) router.back();
      break;
  }
}

/** The CSS class on `<html>` while libmpv shows video under the page. */
const VIDEO_CLASS = 'zf-mpv-video';
/** Marks the video host and its ancestors. Their backgrounds turn transparent. */
const PATH_ATTRIBUTE = 'data-zf-mpv-path';

/**
 * Shows the libmpv video through the page at `host`: the host and its
 * ancestors get transparent backgrounds, and everything painted under them
 * (earlier siblings, such as the screens behind the player) is hidden.
 * Controls painted after the host stay visible. Returns the undo function.
 */
export function showVideoThrough(host: HTMLElement): () => void {
  const path: HTMLElement[] = [];
  for (let el: HTMLElement | null = host; el && el !== document.body; el = el.parentElement) {
    el.setAttribute(PATH_ATTRIBUTE, '');
    path.push(el);
  }
  document.documentElement.classList.add(VIDEO_CLASS);
  void mpv.setVideoVisible(true).catch(() => undefined);
  return () => {
    path.forEach((el) => el.removeAttribute(PATH_ATTRIBUTE));
    document.documentElement.classList.remove(VIDEO_CLASS);
    setTitleBarShade(null);
    void mpv.setVideoVisible(false).catch(() => undefined);
  };
}

/**
 * Shades the title bar strip (macOS) with `color`, or clears it with null.
 * The page starts under the strip, so the player's top shadow cannot reach
 * the window buttons: the player sets the shadow's top colour here while its
 * controls show. The strip fades like the controls (`motion.duration.fast`).
 */
export function setTitleBarShade(color: string | null): void {
  if (!isDesktop || typeof document === 'undefined') return;
  const bar = document.getElementById(TITLE_BAR_ID);
  if (bar) bar.style.backgroundColor = color ?? 'transparent';
}

/**
 * Desktop look: room for the window buttons (the title bar is transparent),
 * a strip to drag the window, and the rules that make the page transparent
 * over the video while the player is open.
 */
/**
 * The height of the transparent title bar with the window buttons (macOS).
 * Windows keeps its own title bar, so the page starts at the top.
 */
const TITLE_BAR = desktopPlatform === 'windows' ? 0 : 28;
const TITLE_BAR_ID = 'zf-titlebar';
/** The fade of the title bar shade: the same as the player controls (`motion.duration.fast`). */
const SHADE_FADE_MS = 160;

/**
 * Windows has no app menu bar: the same shortcuts as the Mac menus, with Ctrl.
 * Ctrl+R reloads, F11 toggles full screen, Alt+Left goes back.
 */
const WINDOWS_SHORTCUTS: Record<string, string> = {
  ',': 'settings',
  f: 'search',
  '1': 'home',
  '2': 'library',
  '3': 'music',
  '[': 'back',
};

function installWindowsShortcuts(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      let command: string | undefined;
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        if (e.key.toLowerCase() === 'r') {
          e.preventDefault();
          window.location.reload();
          return;
        }
        command = WINDOWS_SHORTCUTS[e.key.toLowerCase()];
      } else if (e.altKey && !e.ctrlKey && e.key === 'ArrowLeft') {
        command = 'back';
      } else if (e.key === 'F11' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        void desktopWindow.toggleFullscreen().catch(() => undefined);
        return;
      }
      if (!command) return;
      e.preventDefault();
      onMenu(command);
    },
    true,
  );
}

function installChrome(): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.classList.add('zf-desktop');
  const style = document.createElement('style');
  style.textContent = `
    html.zf-desktop body { -webkit-user-select: none; user-select: none; }
    html.zf-desktop input, html.zf-desktop textarea { -webkit-user-select: text; user-select: text; }
    html.zf-desktop body { background-color: #0B0B0E; }
    html.zf-desktop #root { position: fixed; top: ${TITLE_BAR}px; left: 0; right: 0; bottom: 0; height: auto; }
    html.zf-desktop.zf-fullscreen #root { top: 0; }
    #${TITLE_BAR_ID} { position: fixed; top: 0; left: 0; right: 0; height: ${TITLE_BAR}px; z-index: 2147483647; transition: background-color ${SHADE_FADE_MS}ms ease; }
    html.zf-fullscreen #${TITLE_BAR_ID} { display: none; }
    html.${VIDEO_CLASS}, html.${VIDEO_CLASS} body { background: transparent !important; }
    html.${VIDEO_CLASS} [${PATH_ATTRIBUTE}] { background-color: transparent !important; background-image: none !important; }
    html.${VIDEO_CLASS} *:has(~ [${PATH_ATTRIBUTE}]),
    html.${VIDEO_CLASS} *:has(~ [${PATH_ATTRIBUTE}]) * { visibility: hidden !important; }
  `;
  document.head.appendChild(style);
  if (desktopPlatform === 'windows') {
    installWindowsShortcuts();
    return;
  }
  const bar = document.createElement('div');
  bar.id = TITLE_BAR_ID;
  // Tauri starts a window drag on mouse down in an element with this attribute.
  bar.setAttribute('data-tauri-drag-region', '');
  // Full screen has no title bar: the page uses the whole screen.
  const fullscreen = () => html.classList.toggle('zf-fullscreen', window.innerHeight >= window.screen.height - 1);
  window.addEventListener('resize', fullscreen);
  fullscreen();
  const add = () => document.body.appendChild(bar);
  if (document.body) add();
  else document.addEventListener('DOMContentLoaded', add, { once: true });
}

if (isDesktop && typeof window !== 'undefined') {
  (window as DesktopWindow).__zoggyfinDesktop = {
    mpv: (event) => mpvListeners.forEach((l) => l(event)),
    menu: onMenu,
    download: (event) => downloadListeners.forEach((l) => l(event)),
    remote: (command) => remoteListeners.forEach((l) => l(command)),
    update: (event) => updateListeners.forEach((l) => l(event)),
    nearby: (event) => nearbyListeners.forEach((l) => l(event)),
  };
  installChrome();
  // A page reload leaves libmpv as it was: stop what played before.
  void mpv.command('stop').catch(() => undefined);
  void mpv.setVideoVisible(false).catch(() => undefined);
  void nowPlaying.clear().catch(() => undefined);
}
