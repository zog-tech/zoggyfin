# Extensions v2: native pages, playable media, downloads, account sync

Survey of `origin/main` at `cf247b1`. Line numbers refer to that commit.

## 1. Today

### 1.1 The extension system (`src/extensions/`)

| Part | File | What it does |
|---|---|---|
| Schema | `schema.ts` | zod manifest, `schemaVersion: 1` only (`:8`, `:140`). `contributes` = `settings`, `itemActions`, `homeSections` (max 5, `:157`), `shareTargets`, `panels` (`:153-161`). `parseManifest` refuses any other version (`:168-171`) and checks unique ids per list (`:180-184`). Permissions: `network`, `itemPath`, `jellyfinToken` (`:26`). |
| Store | `store.ts` | One Zustand store saved under the MMKV key `extensions.v1` (`:34`). It is **device-wide, not per account**. `InstalledExtension = { manifestUrl, manifest, enabled, grants, installedAt }` (`:13-19`). Secret text settings go to the secure store as `ext.<id>.<key>`; the JSON keeps only a `•` marker (`:80-93`). Effective value order: user, auto, source, default, first option (`:132-153`). No migration code. |
| HTTP | `http.ts` | Origin lock through `resolveOnOrigin` (`:73`), templated headers, Jellyfin token headers only with the grant (`:41-55`), 15 s actions and 8 s feeds (`:9-10`), JSON reply with `error` text (`:106-122`). |
| Runtime | `runtime.ts` | Template context (`:70-86`), action flow (inputs, confirm, request, response effects, `:193-217`), tasks saved under `extensions.tasks.v1` (`:126-162`), install (`:291-354`), and registration into the app registries: item actions as `ext.<id>.<action>` at order 60+ (`:403-423`), Home rows at order 45+ (`:424-426`). Re-registers when the list changes (`:391-436`). |
| Feeds | `feed.ts` | Entry = `id`, `itemId`, `title`, `subtitle`, `image`, `progress`, `link`, `panel` (`:10-24`). Max 100 entries, no paging (`:26`). Bad entries are dropped one by one (`:38-40`). Images must be on the origin (`:42-48`). |
| Install | `install-request.ts`, `src/app/extension-install.tsx` | One confirm screen for one or more manifests, gated with `createGate` (`:19-44`). `installFromInvite(urls)` skips installed URLs (`runtime.ts:374-377`). |
| Bridge | `bridge.ts` | Six panel methods: `getContext`, `play`, `openItem`, `refreshLibrary`, `toast`, `close` (`:8`). `play` takes a Jellyfin `itemId` only. |
| UI | `ui/home-section.tsx`, `ui/host.tsx` | The Home row (`home-section.tsx:36-69`) uses `useQuery` per row, resolves `itemId` entries through Jellyfin (`:49-58`), draws a Jellyfin `Tile` or a plain `Card` (`:92-98`). A card opens a panel or a link only (`:105-108`). `ExtensionsHost` starts the runtime once signed in (`host.tsx:33-43`, mounted in `src/app/_layout.tsx:168`). |
| Settings screens | `src/app/(tabs)/(home)/extensions/index.tsx`, `[id].tsx` | List, add, update check (`[id].tsx:64-69` calls `loadManifest` and re-opens the confirm screen). |
| Platform flag | `src/platform/tv.ts:47` | `extensionPanels: !isTV`. TV has no panels, so a card that only opens a panel is not pressable on TV (`home-section.tsx:115`). |
| Tests | `src/extensions/__tests__/` | bridge, feed-store, http, install-request, match, response, schema, tasks, template. Fixtures in `test-utils/fixtures.ts`. |

### 1.2 The player input

- **What to play.** Three request types in `src/player/types.ts`: `PlayRequest` (a Jellyfin `BaseItemDto`, `:4-25`), `LivePlayRequest` (`:90-95`) and `VodPlayRequest` (`:130-137`). The VOD path is the existing **non-Jellyfin seam**: a `VodRef` (`:98-114`) plus a `VodSource` with `resolve(ref)` → stream candidates and `savePosition(...)` (`:121-127`).
- **Engine seam.** `EngineSource` (`engine-types.ts:6-32`) is `uri`, `isHls`, `startSeconds`, title, subtitle, artwork, `autoplay`, and `userAgent`. There is no general `headers` field. `engine.native.tsx:205` passes only `User-Agent` to expo-video; `engine-mpv.ts:274` sets only `user-agent`. The web engine does not touch hls.js `levels` (no quality switch inside one HLS stream on any engine).
- **Shared state.** `NowPlaying` (`store.ts:22-40`) always has an `item: BaseItemDto` and a `plan: StreamPlan`, plus optional `live` or `vod`. `segments`, `chapters`, `next` and `bitrateChoice` are already fields.
- **VOD in the session** (`session.ts`): `vodItem()` makes a synthetic `BaseItemDto` with id `iptv-vod:<provider>:<kind>:<id>` (`:151-160`). `playVod` (`:755-797`) sets state, calls `source.resolve`, then `loadNextVod` tries the candidates in order (`:800-832`), and `vodFailed` hides URLs from error text (`:835-843`). Positions go to `source.savePosition` every 10 s, on pause, on end and on stop (`:163`, `:272-280`, `:301`, `:846-859`, `:1252`). Next episode = `index + 1` in `vod.items` (`:1208-1215`). Reload and Try again restart at the position (`:862-868`, `:999-1003`). Embedded audio and subtitle tracks are listed by the engine (`:309-312`).
- **Entry points.** `src/player/index.ts`: `usePlayer().playVod` → `playVodHere` refuses it in a together session, stops audio, and navigates to `/player` (`:118-128`). The mini player and keyboard keys use `activePlayback` (`:38-59`) and `openFullPlayer` (`:32-35`). Both are kind-based, not source-based, so they already work for VOD.
- **IPTV builds the request** in `src/iptv/vod-manager.ts`: `sourceFor()` (`:426-466`) keeps stream secrets out of player state, and `filmRequest()` (`:469-474`). Positions live in MMKV per provider and sync through the account blob.

What each player feature needs from the source:

| Feature | Today | Need for extension media |
|---|---|---|
| Progress | `ProgressReporter` with an injected `ProgressTransport` (`progress-reporter.ts:36-40`); Jellyfin transport in `session.ts:391-411`, offline outbox through `withOutbox`. VOD has no reporter; it calls `savePosition`. | A transport that posts to the extension. The reporter is reusable as is. |
| Resume | Jellyfin `UserData` (`session.ts:449-455`) or `VodPlayRequest.startSeconds`. | `resume` in the stream description. |
| Quality menu | Jellyfin: `setQuality` → `reload` with a new bitrate (`session.ts:1190-1194`). VOD shows one fixed entry "Plays the provider's file as it is" (`player-screen.tsx:815-822`). | A list of variant URLs; a switch reloads at the position. |
| Subtitles | Text: `plan.subtitles[].url`, cues loaded by `loadCues` (`session.ts:1175-1187`) **through `jf.getText(api, url)`, the Jellyfin API with its token** (`:1181`). VOD uses only embedded tracks (`player-screen.tsx:750-751`). | External WebVTT fetched with plain `fetch` on the extension origin. Never through the Jellyfin client. |
| Speed | `setRate` and the menu (`player-screen.tsx:848-853`); VOD keeps the rate across loads (`session.ts:829-830`). | Nothing new. |
| Skip segments | `Segment.kind` is a fixed union of five Jellyfin kinds (`segments.ts:7-13`). The screen shows a skip pill only (`player-screen.tsx:415-418`); there is **no automatic skip**. | Free labels, a per-label setting, auto skip with an Undo toast (`lib/toast.ts:14` supports an `action`). |
| Chapters | `chapters` field, marks on the scrubber (`player-screen.tsx:737`, `:1065`). | Fill from the description. |
| Autoplay next | `onEnded` checks `autoplayNext` and `now.next` (`session.ts:1224-1236`). | `next` entry in the description. |
| PiP, background audio, lock screen | Engine level (`engine.native.tsx:99-100`, `:335`). | Nothing new. |

### 1.3 Downloads (`src/downloads/`)

- The engine contract is generic: `start({ id, url, destination, headers?, resume? })` (`engine-types.ts:30`). One progressive file per task; HLS cannot download.
- The record is Jellyfin-shaped: `itemId`, `serverId`, `userId`, `item: BaseItemDto`, `mediaSourceId`, `method`, `quality` (`types.ts:44-85`), schema version 2 (`:8`).
- `manager.ts` is Jellyfin-bound in three places: `context()` builds a Jellyfin API and auth header (`:56-81`); `begin` always sends `Authorization: ctx.authHeader` (`:367-373`); `prepare` calls `getItem` and `getPlaybackInfo` (`:395-435`). `download(item)` and `enqueue` take a `BaseItemDto` (`:534-618`).
- Playback finds a completed record by item id (`session.ts:63-67`, `:428-432`) and reports to the Jellyfin outbox (`:534-546`). The Downloads tab groups by server (`lists.ts:52-95`).
- For a non-Jellyfin file the record needs a source discriminator, `prepare` needs a second branch, and `begin` must send the extension's headers, not the Jellyfin header.

### 1.4 Navigation

- Phone, tablet, web and Mac: `NativeTabs` in `src/app/(tabs)/_layout.tsx:84-138`. Six triggers are declared; `(live)` is `hidden` except on the web build (`:125`, rule in `features/iptv/nav.ts:6-21`). The comment there records the limits: Android's bottom bar throws with a sixth visible tab, and iOS moves a sixth into "More". Phones already show five tabs (Home, Library, Music, Downloads, Search). `sidebarAdaptable` (`:86`) gives the iPad and Mac sidebar. `HAS_ACCESSORY` (iOS 26+, `lib/tab-bar-inset.ts:11`) only decides where the mini player sits.
- A trigger's `name` must match a route group folder, so tabs cannot be created at run time. A fixed `(ext)` group whose content and label come from a store, shown or hidden with `hidden`, is the workable pattern (the `(live)` trigger proves `hidden` works).
- TV: headless `Tabs` from `expo-router/ui` with a static `DESTINATIONS` array (`features/tv/side-menu.tsx:43-50`, triggers at `:101-105`). Entries can be added at run time if they point at an existing route.
- Shared stacks use multi-group folders, for example `(tabs)/(home,library,live)/live-tv/...` and `(tabs)/(home,library,music,search,saved)/item/[id].tsx`.
- On phones Live TV is a tile in the Library grid (`(library)/libraries.tsx:15-27`, `features/iptv/live-tv-tile.tsx`, rules in `features/iptv/placement.ts`).

### 1.5 Detail pages and tiles

- `DetailScaffold` (`features/detail/detail-scaffold.tsx:66-121`) needs a `BaseItemDto` and pulls item actions, together, and download status from it (`:128-133`). Not reusable for plain data.
- The IPTV VOD components are already provider-data-only and match the design system: `VodDetail` (`features/iptv/vod/vod-detail.tsx:29-61`: title, eyebrow, poster, backdrop, facts, overview, primary Play with progress, round actions, children), `VodTile` (`vod-tile.tsx:18-45`), `VodArt` (plain URLs, no token, generated-art fallback), `VodGrid` (virtualized FlashList), `VodShelf` (TV shelf aware). `VodAction.icon` is a closed union of four icons (`vod-detail.tsx:22-27`).
- `resolveImage` (`images/resolve-image.ts:264`) is only for `BaseItemDto`. Plain URLs go through `expo-image` directly (the extension `Card`, `home-section.tsx:120`) or `VodArt`.

### 1.6 Live TV account sync

- `iptv/account-sync.ts` (pure, 763 lines): one versioned blob, per-entry stamps with tombstones (`:56-68`), tombstone TTL 30 days (`:41`), first sync seeds the lowest stamps so a new device only adds (`:253`), `mergeStamped` (`:343`), `mergeBlobs` (`:384`), chunking into 200 000-character `CustomPrefs` values (`:47-54`). Provider passwords and list URLs **are synced in the blob** (`:70-80`).
- `iptv/sync.ts`: DisplayPreferences id `zoggyfin-iptv`, client `zoggyfin` (`:3-5`, `:56`), via `getCustomPrefs` / `setCustomPrefs` (`api/jellyfin.ts:1055-1065`). Pull on sign-in, start, foreground, reconnect and page open; push a few seconds after a change; one run at a time through `createSerialRunner` (`lib/async-gate.ts:86`).

### 1.7 Conventions to follow

From `AGENTS.md`: pure core with thin I/O and tests in `__tests__/` (§3); one union type and one pure `transition` for any lifecycle with more than two states; async work takes an `async-gate` token; `createSerialRunner` for single-flight jobs; saved data is versioned and a migration never throws; one import surface per area (`@/player`, `@/downloads`); design tokens through `@/theme`, icons from `components/icon-names`; every feature works on every platform or shows a clear message; web must work on plain http; error text never holds a URL or token. §5: a JS change ships OTA to phones and TV; the Mac app needs a desktop release; the web needs a new export.

## 2. Recommendation

**Extend, with an internal restructure. Do not rebuild.**

The v1 core is sound and tested: the origin lock, templates, grants, the action flow, tasks, the gated confirm screen and the bridge. None of it conflicts with the new features. The new features are additions: pages, paged feeds, media, detail, downloads, sync. A rebuild would throw away tested security rules for no gain.

The restructure:

1. **Manifest `schemaVersion: 2`**, with v1 still accepted. `parseManifest` reads both and returns one internal model. A v1 `homeSections` entry becomes a Home placement of a one-section page with no tab. Nothing an extension author wrote stops working.
2. **Split `src/extensions/`** into `schema/` (v1, v2, normalize), `feeds/` (entry, paging, search), `media/` (stream description, external source, report transport), `pages/` (page model), `sync/` (account blob). `runtime.ts` keeps registration and the action flow.
3. **Generalize the VOD seam, not a new player mode.** `VodSource`/`VodRef` become `ExternalSource`/`ExternalRef` with optional capabilities. IPTV is one adapter, extensions are a second. The player keeps one non-Jellyfin path.
4. **Per-account store `extensions.v2`**, with a migration from `extensions.v1`. Sync is per Jellyfin account, so the list must be per account too. The migration copies the device list to every saved account, keeps grants and values, and does not touch secure-store keys (their names do not change).

Still data only. The app gets JSON and media streams. It runs no code from the extension (guideline 2.5.2).

## 3. Proposed schema

All paths are under `baseUrl`. Every URL in a reply is checked with `resolveOnOrigin`. Every reply is parsed per entry, and bad entries are dropped.

### 3.1 Manifest additions

```json
{
  "schemaVersion": 2,
  "id": "org.example.media",
  "name": "Example Media",
  "version": "2.0.0",
  "baseUrl": "https://media.example.org",
  "permissions": ["network", "playback", "downloads"],
  "contributes": {
    "pages": [
      {
        "id": "main",
        "title": "Example",
        "icon": "play.rectangle",
        "placement": { "tab": true, "library": true, "home": ["latest"] },
        "search": { "feed": "/api/search", "placeholder": "Search Example" },
        "sections": [
          { "id": "latest", "title": "Latest", "layout": "row", "shape": "thumb", "feed": "/api/feed/latest", "refreshSeconds": 300 },
          { "id": "all", "title": "Everything", "layout": "grid", "shape": "poster", "feed": "/api/feed/all" },
          { "id": "queue", "title": "Queue", "layout": "list", "feed": "/api/feed/queue" }
        ]
      }
    ],
    "skipLabels": [
      { "id": "intro", "title": "Intro", "default": "ask" },
      { "id": "promo", "title": "Promotion", "default": "auto" }
    ]
  }
}
```

- New permissions: `playback` (the app plays streams and sends progress) and `downloads` (files saved on the device). Both show on the confirm screen. An update that adds one shows the screen again, as today.
- `placement.tab`: the page may be a tab (§4 WP5 for the platform rules). `library`: a tile in the Library grid. `home`: section ids that also show as Home rows.
- `layout`: `row` (horizontal), `grid` (virtualized, infinite), `list` (one line per entry, infinite).
- Limits: 5 pages, 8 sections per page, 10 skip labels.

### 3.2 Feed page

`GET <feed>?cursor=<cursor>` (search adds `query`):

```json
{ "items": [ /* entries */ ], "next": "opaque-cursor-or-null" }
```

`next` is a cursor string, not a URL, so the origin rule stays trivial. Max 100 entries per page. A row loads one page; a grid and a list load the next page near the end (TanStack `useInfiniteQuery`).

### 3.3 Feed entry

```json
{
  "id": "e123",
  "title": "An entry",
  "subtitle": "12 min · 2 days ago",
  "image": "/img/e123.jpg",
  "progress": 0.4,
  "badge": "New",
  "detail": "/api/entries/e123",
  "media": { "id": "e123", "kind": "video", "duration": 734, "playback": "/api/entries/e123/play", "download": "/api/entries/e123/download" }
}
```

The v1 fields (`itemId`, `panel`, `link`) stay. Tap order: `detail` page, else play `media`, else `panel`, else `link`. Long press: Play, Download, Open. `kind` is `video` or `audio`; `audio` plays in the video session with no picture in the first version (see open questions).

### 3.4 Stream description (`GET media.playback`)

```json
{
  "stream": { "url": "/hls/e123/master.m3u8", "type": "hls" },
  "alternatives": [{ "url": "/files/e123.mp4", "type": "file" }],
  "title": "An entry",
  "subtitle": "Example Media",
  "image": "/img/e123.jpg",
  "duration": 734,
  "resume": 120.5,
  "qualities": [
    { "id": "auto", "label": "Auto", "url": "/hls/e123/master.m3u8" },
    { "id": "720", "label": "720p", "url": "/hls/e123/720.m3u8" }
  ],
  "subtitles": [{ "id": "en", "label": "English", "language": "en", "url": "/subs/e123.en.vtt" }],
  "segments": [
    { "label": "intro", "start": 0, "end": 12.5 },
    { "label": "promo", "start": 200, "end": 245 }
  ],
  "chapters": [{ "title": "Part 1", "start": 0 }, { "title": "Part 2", "start": 380 }],
  "next": { "id": "e124", "title": "Next entry", "image": "/img/e124.jpg", "media": { "id": "e124", "kind": "video", "playback": "/api/entries/e124/play" } },
  "report": { "path": "/api/entries/e123/progress", "intervalSeconds": 10 }
}
```

- Stream URLs must be on the extension origin. The stream gets the manifest `headers` (needs a new `EngineSource.headers`, see WP6). On the web and in the Mac app, HLS playlists and segments need CORS for the app origins, the same rule as feeds.
- `stream` + `alternatives` map to `LiveStreamChoice[]` and use the existing try-next logic (`session.ts:800-843`).
- A quality switch reloads that URL at the current position.

### 3.5 Progress report (`POST report.path`)

```json
{ "event": "start | progress | pause | resume | seek | stop | finished", "mediaId": "e123", "position": 130.2, "duration": 734, "rate": 1, "quality": "720", "offline": false }
```

Errors are ignored, as for Jellyfin reports. `stop` and `finished` from offline play go to a small extension outbox and are sent when the origin answers again.

### 3.6 Detail description (`GET entry.detail`)

```json
{
  "title": "An entry",
  "eyebrow": "Example Media",
  "image": "/img/e123.jpg",
  "backdrop": "/img/e123-wide.jpg",
  "lines": ["12 min", "2 days ago"],
  "description": "Plain text.",
  "media": { "id": "e123", "kind": "video", "playback": "/api/entries/e123/play", "download": "/api/entries/e123/download" },
  "progress": 0.4,
  "actions": [
    {
      "id": "save",
      "title": "Save",
      "icon": "heart",
      "state": { "on": false, "onTitle": "Saved", "onIcon": "heart.fill" },
      "request": { "method": "POST", "path": "/api/entries/e123/save", "body": { "on": "{{action.next}}" } }
    }
  ],
  "sections": [{ "id": "related", "title": "Related", "layout": "row", "shape": "thumb", "feed": "/api/entries/e123/related" }]
}
```

An action takes the v1 `inputs` and `confirm`. The reply extends v1: `{ "toast": "Saved", "refresh": "none | entry | page | library", "state": { "on": true } }`. The button shows the new state at once and goes back if the request fails (the Favourite pattern in `DetailScaffold`).

### 3.7 Download description (`GET media.download`)

```json
{
  "url": "/files/e123-720.mp4",
  "bytes": 123456789,
  "container": "mp4",
  "label": "720p",
  "subtitles": [{ "label": "English", "language": "en", "url": "/subs/e123.en.vtt" }],
  "image": "/img/e123.jpg"
}
```

One progressive file only (the downloader cannot save HLS). Optional `options: [{ "id": "720", "label": "720p · 310 MB", "download": "/api/entries/e123/download?q=720" }]` lets the user pick a quality first.

### 3.8 Skip settings

Per-label setting: `auto` (skip, toast "Skipped Promotion" with Undo), `ask` (the existing skip pill), `off`. Key `<extensionId>:<label>`. The manifest `default` is used until the user changes it. Jellyfin segments map to built-in labels (`intro`, `outro`, `recap`, `preview`, `commercial`) with `ask` as default, so the existing behaviour does not change.

### 3.9 Account sync blob

DisplayPreferences id `zoggyfin-extensions`, client `zoggyfin`:

```json
{
  "v": 1,
  "extensions": {
    "org.example.media": {
      "stamp": 1731234567000,
      "value": {
        "manifestUrl": "https://media.example.org/zoggyfin-extension.json",
        "enabled": true,
        "grants": { "itemPath": false, "jellyfinToken": true },
        "settings": { "quality": "720" },
        "tab": "main"
      }
    },
    "org.example.old": { "stamp": 1731000000000, "del": true }
  },
  "skip": { "org.example.media:promo": { "stamp": 1731234000000, "value": "auto" } }
}
```

- The same stamp and tombstone rules as Live TV (`mergeStamped`, 30-day TTL, seed stamps on the first sync).
- **Secret settings do not sync** in this proposal (unlike IPTV passwords). See open questions.
- The device ledger also keeps a set of extension stamps this device has **seen**. An entry in the account that is not installed and not seen opens the confirm screen once (the `installFromInvite` path, with the title "From your account"). "Not now" marks it seen, so the screen does not come back. A later stamp (a re-add on another device) asks again.

## 4. Work packages

Every package is JS only. `zod`, `expo-router` native tabs and headless tabs, `expo-video` (its `VideoSource` already takes `headers`), `hls.js`, `@shopify/flash-list` and the background downloader are all installed (`package.json`). No package needs a new native module, so phones and TV get them as **OTA updates**. The Mac app needs a desktop release, and the web needs a new export, for every package.

Order and parallel tracks:

```
WP0 ─┬─ WP1 ── WP2                     (store, sync)
     ├─ WP3 ── WP4 ── WP5              (feeds, pages, navigation)
     └─ WP6 ─┬─ WP7                    (player, skip)
             └──────── WP8 (needs WP3, WP4) ── WP9 (needs WP1) ── WP10, WP11
```

After WP0, the three tracks can run in parallel.

| # | Package | Files | Depends on | Size | Main risks |
|---|---|---|---|---|---|
| WP0 | **Schema v2 and normalize.** v1 and v2 zod schemas; one internal model; feed entry, stream, detail and download parsers (pure, tolerant per entry). | `src/extensions/schema/*`, `feeds/entry.ts`, `media/describe.ts`, `docs/extensions.md`, `__tests__/schema*.test.ts` | none | M | Keep every v1 fixture valid. Error text must still name the first bad field. |
| WP1 | **Per-account store and migration.** `extensions.v2` keyed by `serverId.userId`; migrate from `extensions.v1`; registration follows the account switch. | `store.ts`, `migrate.ts` (new), `runtime.ts:391-436`, `ui/host.tsx`, tests | WP0 | M | A migration that loses an install. Tasks in `extensions.tasks.v1` must follow the right account. |
| WP2 | **Account sync.** Move the generic parts of `iptv/account-sync.ts` (stamps, `mergeStamped`, chunks, `canonical`) into `src/lib/account-blob.ts` and keep IPTV on it. Add `extensions/sync/blob.ts` (pure) and `sync/io.ts` (serial runner, same triggers as `iptv/sync.ts`). New-device confirm through `install-request.ts`. | `src/lib/account-blob.ts`, `src/iptv/account-sync.ts`, `src/extensions/sync/*`, `__tests__/sync*.test.ts` | WP1 | M | A refactor of IPTV sync breaks it: keep `account-sync.test.ts` green before any extension code lands. A confirm screen loop on every pull. |
| WP3 | **Paged feeds and search.** Cursor paging, `useInfiniteQuery` hooks per section, debounced search with a gate token. Query keys under `queryKeys.all(scope)`. | `src/extensions/feeds/*`, `ui/use-feed.ts` | WP0 | S–M | Stale search results (use `async-gate`). Memory on long grids. |
| WP4 | **Native page screen.** Move `VodTile`, `VodArt`, `VodGrid`, `VodShelf` into neutral components (for example `components/plain-tile.tsx`) used by IPTV and extensions. Section renderers: row, grid, list. Home rows from `placement.home` replace `ExtensionHomeSection`. | `src/features/extensions/page-screen.tsx`, `section-*.tsx`, `src/features/iptv/vod/*` (imports only), route `src/app/(tabs)/(home,library,search,ext)/ext/[ext]/[page].tsx` | WP3 | M–L | TV focus rules (`AGENTS.md` §2.8a): use the TV shelf and windowed rows. Several grids on one page with infinite scroll: a grid section must be the last section, or open its own screen. |
| WP5 | **Placement.** A fixed `(ext)` tab group whose index renders the chosen page; label and icon from the store; `hidden` when not chosen. Library tile on phones (like `live-tv-tile.tsx`). TV: add `DESTINATIONS` entries at run time. Mac and web: a visible tab, so it shows in the sidebar. | `src/app/(tabs)/_layout.tsx`, `src/app/(tabs)/(ext)/_layout.tsx`, `features/tv/side-menu.tsx`, `features/extensions/placement.ts` (pure, tested) | WP4 | M | Android throws with six visible tabs; iOS adds "More". Phones can only show the page tab in place of another tab (open question 1). Only one `(ext)` slot exists unless more groups are added. Icon names must map to both SF Symbols and Material names. |
| WP6 | **External media in the player.** Rename `VodSource`/`VodRef` to `ExternalSource`/`ExternalRef` with optional `qualities`, `subtitles`, `segments`, `chapters`, `next()`, `report`. IPTV keeps its adapter. Add `EngineSource.headers` (expo-video `headers`, hls.js `xhrSetup`, mpv `http-header-fields`). Quality reload by URL at the position. External WebVTT loaded through the source, **not** `jf.getText` (`session.ts:1181`). A report transport for `ProgressReporter`. `usePlayer().playMedia(...)`. Refuse in a together session, like VOD. | `src/player/types.ts`, `store.ts`, `session.ts:755-868`, `engine-types.ts`, `engine.native.tsx`, `engine.tsx`, `engine-mpv.ts`, `index.ts`, `features/player/player-screen.tsx:750-851`, `src/extensions/media/*`, tests in `src/player/__tests__/` | WP0 | L | The largest file in the app (`session.ts`, 1278 lines): keep IPTV VOD tests green and test the IPTV films path by hand. Header support on the iOS AVPlayer path and in the Mac app must be checked on device. A stream URL in error text (keep the `vodFailed` filter). |
| WP7 | **Skip segments.** Widen `Segment` to `{ label, title, start, end }`; map Jellyfin kinds to labels. A pure auto-skip machine (`idle → skipped(undoable) → idle`, one skip per range per play, no skip during a seek in the range). Toast with Undo. Per-label setting in Settings → Playback and on the extension page; synced through WP2. | `src/player/segments.ts`, `auto-skip.ts` (new), `src/settings/playback.ts`, `player-screen.tsx:415-418`, `skip-pill.tsx`, tests | WP6 (pure part can start at once) | M | Next-up countdown rules depend on `Outro` (`segments.ts:56`). TV focus on the toast action. The together session must not auto skip for a guest. |
| WP8 | **Entry detail page.** Generalize `VodDetail`: open icon set, action buttons with on/off state, eyebrow, lines, feed sections below. Route `ext/[ext]/entry/[entry]` in the same shared groups. | `src/features/extensions/detail-screen.tsx`, `features/iptv/vod/vod-detail.tsx`, `src/extensions/runtime.ts` (action with state), tests for the reply parser | WP3, WP4, WP6 | M | Optimistic state and a late reply (gate token). TV first focus on Play. |
| WP9 | **Downloads of extension media.** Record schema v3: `source: { kind: 'jellyfin' } | { kind: 'extension', extId, mediaId, account }`; migration from v2 sets `jellyfin`. `prepare` branch that reads the download description; `begin` sends the extension headers. Downloads tab section per extension. Local play through the external source with the local file. Report outbox for offline play. | `src/downloads/types.ts`, `migrate.ts`, `manager.ts:56-81,346-435,534-618`, `lists.ts`, `index.ts`, `player/session.ts` (local play), `extensions/media/outbox.ts`, `desktop/src-tauri/src/downloads.rs` (only if it ignores headers) | WP6, WP1 | L | Never drop user downloads: a migration test with the v2 shape. Record ids must not collide with Jellyfin ids (use `ext:<extId>:<mediaId>`). The Mac downloader's header support is not verified in this survey. A file URL that expires before a resume. |
| WP10 | **Bridge additions.** `playMedia { mediaId, playback }`, `openEntry { detail }`, `openPage { page }`. | `src/extensions/bridge.ts`, `src/app/extension-panel.tsx`, tests | WP6, WP8 | S | Panels are not on TV; these methods must not be the only way to reach content. |
| WP11 | **Sample and docs.** Extend `examples/extensions/hello/` with a page, a fake HLS file, a stream description, a detail and a download; update `docs/extensions.md`, `AGENTS.md` §2.7 and the §4 table, `CHANGELOG.md`. | `examples/extensions/hello/*`, docs | all | S | Keep the sample free of real services and real addresses. |

## 5. Open questions for the maintainer

1. **The page tab on phones.** Phones already have five tabs. Should an extension page replace one tab the user chooses (for example Music or Downloads), or stay a Library tile and a Home row only on phones, with a real tab on TV, web and the Mac?
2. **How many page tabs.** One `(ext)` slot is simple. Is one enough, or are two or three fixed slots needed?
3. **Secrets in account sync.** IPTV syncs provider passwords into the Jellyfin account. Should extension secret settings sync the same way, or stay on the device (a new device then asks for them on the confirm screen)?
4. **Audio-only media.** Should `kind: "audio"` play in the music player (queue, lyrics, sleep timer), or in the video session without a picture for the first version?
5. **Downloads on the plain web build.** The web build has no downloads today. Keep it that way for extension media?
6. **Together sessions.** VOD and Live TV refuse a together session. Keep the same rule for extension media, or allow it when every member has the same extension?
7. **App Review exposure.** Guideline 2.5.2 is covered (data only). An extension that streams media may draw attention under the content and intellectual-property rules. Is it acceptable that the App Store build shows no extension pages until the user adds an extension, as Live TV does today?

## 6. Decisions (2026-11-10)

- Question 2: one `(ext)` page slot.
- Question 3: secret settings stay on the device; they do not sync.
- Question 4: `kind: "audio"` plays in the video session with no picture in the first version.
- Question 5: no downloads on the plain web build.
- Question 6: extension media refuses a together session, like VOD and Live TV.
- Question 7: the app shows no extension pages until the user adds an extension, as Live TV does.
- Question 1 (the page tab on phones) is open. Until it is decided, phones get the Library tile and Home
  rows; the tab slot is built but hidden on phones.
- The stream description also carries `live: true` for a live stream (no duration, no resume).
