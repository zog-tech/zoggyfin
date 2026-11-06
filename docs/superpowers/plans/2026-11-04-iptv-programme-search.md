# Live TV Programme Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing "Arsenal" in Live TV search shows an "On now" section with the programmes whose title matches, on which channel and provider, with one tap to play.

**Architecture:** The incremental XMLTV parser gets a second sink that collects every linked programme of the next 48 hours. A pure module turns those programmes into a compact, versioned per-provider index file (distinct titles stored once). A small I/O module refreshes the index in the background (once a day, Wi-Fi only on phones, one provider at a time) and keeps only a 2-hour slice in memory. A pure search over the slices feeds a new "On now" section in the Live TV search.

**Tech Stack:** TypeScript (strict), Zustand, Jest (`jest-expo`), React Native / Expo Router, the existing `src/iptv` transport and files.

**Spec:** `docs/superpowers/specs/2026-11-04-iptv-programme-search-design.md`

## Global Constraints

- JS only; ships as an OTA update. No new dependency. No top-level import of a native package (`@react-native-community/netinfo` is reached only through `src/servers/network-source`).
- Pure modules have no React and no native imports, start with a doc comment ending "Pure, so it is unit-tested."
- Saved shapes carry a schema version; a migration never throws.
- Error texts and logs never contain a URL or login (`iptvErrorText`).
- Design system only (`useTheme`, `createStyles`, `font()`, `<Icon>`, `Touchable`); TV focus must work. UI text in plain British English.
- Keep: 48 hours (from now − 30 min). Refresh when the index is missing or ends within 24 hours. After a failure, wait 12 hours. "On now" = runs now, or starts within the next 60 minutes. Query needs at least 2 characters. Matching = every folded word of the query is in the folded title (`foldText` from `search.ts`).
- Phones (iOS, Android, not TV): the index download runs only when the network type is `wifi` or `ethernet`. Mac app, TV: no limit. Plain web (`iptvFiles.persistent === false`): no index at all.
- No fallback when `xmltv.php` fails. No cross-provider guide use.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm jest src/iptv src/features/iptv` per task; full `pnpm test` before the last commit. Commit message style: `Live TV: …`, with the `Co-Authored-By` line.

## Review Focus

1. A panel guide with several streams on one guide id ("TNT Sports 1 HD", "FHD", "Backup") — one hit row per provider, first stream in list order plays, others reachable. Test in Task 2.
2. A programme that crosses midnight or spans the slice edges (started 90 min ago, still on) — must show as on now. Test in Task 2.
3. An `xmltv.php` that answers with HTML, an empty body or a 404 — keeps the old index, records the failure, no retry for 12 hours, no error in search. Test in Task 3.
4. A provider removed, or its login / guide URL changed, while an index exists — index file, ledger and memory slice go. Test in Task 3.
5. M3U channels with no `tvg-id` that link by display name — their programmes must be kept (the parser's `matchNames` path) and found. Test in Task 1.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `src/iptv/xmltv.ts` | Modify | Optional `collect` sink in `XmltvOptions`; `parseXmltv` returns nothing new |
| `src/iptv/programme-index.ts` | Create (pure) | Index shape, builder, migration, slice, refresh rule |
| `src/iptv/programme-search.ts` | Create (pure) | Search over slices, hit grouping by guide id |
| `src/iptv/programme-manager.ts` | Create (I/O) | Background refresh, network gate, files, ledger, memory slices, cleanup |
| `src/iptv/xtream.ts` | Modify | `xtreamGuideUrl(login)` |
| `src/iptv/manager.ts` | Modify | M3U `loadGuide` shares one download; cleanup calls on remove / change |
| `src/iptv/store.ts` | Modify | `programmeSlices` state |
| `src/iptv/sync.ts` | Modify | `startIptvSync` also starts the index refresh |
| `src/iptv/index.ts` | Modify | `useProgrammeSearch` hook, type exports |
| `src/features/iptv/programme-row.tsx` | Create | One "On now" row |
| `src/features/iptv/live-tv-screen.tsx` | Modify | "On now" section in the list header |
| `AGENTS.md`, `CHANGELOG.md`, `desktop/CHANGELOG.md` | Modify | Docs |

---

### Task 1: Collect sink in the XMLTV parser and the pure programme index

**Files:**
- Modify: `src/iptv/xmltv.ts` (`XmltvOptions`, `XmltvWindowParser.programme`)
- Create: `src/iptv/programme-index.ts`
- Test: `src/iptv/__tests__/programme-index.test.ts`

**Interfaces:**
- Produces (in `xmltv.ts`):
  ```ts
  export interface XmltvCollect { from: number; to: number; add(guideId: string, start: number, stop: number, title: string): void }
  // XmltvOptions gains: collect?: XmltvCollect | null
  ```
  In `programme()`, after the `keep` check and time parse, and **before** the window and `maxPerChannel` checks, call `collect.add(id, start, stop, title)` when `stop > collect.from && start < collect.to && stop > start`. The existing window behaviour is unchanged. The `keep` set must already hold name-matched ids (it does: `<channel>` comes first).
- Produces (in `programme-index.ts`):
  ```ts
  export const PROGRAMME_INDEX_SCHEMA_VERSION = 1;
  export const INDEX_KEEP_MS = 48 * HOUR;          // with INDEX_BACK_MS = 30 * 60_000
  export interface ProgrammeIndex { schemaVersion: number; providerId: string; builtAt: number; from: number; to: number; titles: string[]; channels: Record<string, number[]> } // per guide id: flat [startMin, stopMin, titleIdx, …], minutes since `from`, sorted by start
  export class ProgrammeIndexBuilder implements XmltvCollect { constructor(providerId: string, from: number, to: number); add(...): void; build(builtAt: number): ProgrammeIndex }
  export function migrateProgrammeIndex(raw: unknown): ProgrammeIndex | null   // never throws
  export interface SlicedProgramme { guideId: string; start: number; stop: number; title: string; folded: string }
  export function sliceIndex(index: ProgrammeIndex, from: number, to: number): SlicedProgramme[] // programmes with stop > from && start < to
  export interface IndexLedger { builtAt: number | null; to: number | null; failedAt: number | null }
  export function needsIndexRefresh(ledger: IndexLedger | null, now: number): boolean
  ```
  `folded` is `foldText(title)` padded with spaces like `buildSearchIndex`. The builder drops duplicate (guideId, start) pairs, keeps one copy of each distinct title, and `build()` sets `to` to the latest stop it kept (or `from` when empty).

- [ ] **Step 1: Write the failing tests** in `programme-index.test.ts` (use `bigXmltv`, `inChunks`, `xmltvTime` from `test-utils/fixtures`):
  - `collect sees every programme in its window, not capped by maxPerChannel`: `bigXmltv(3, 72, T0 - 6*HOUR)` parsed with `{ from: T0, to: T0 + 4*HOUR, maxPerChannel: 3, collect: builder }` where builder window is T0−30 min … T0+48 h → `index.channels['ch1.example'].length / 3 === 49` (hourly programmes overlapping the 48.5-hour window) and `guide.channels['ch1.example'].length === 3`.
  - `collect respects keep, including name-matched channels`: an XMLTV with `<channel id="x1"><display-name>Sky Sports Main Event</display-name></channel>` and programmes for `x1` and `x2`; `keep = new Set()`, `matchNames = new Set(['sky sports main event'])` → `Object.keys(index.channels)` equals `['x1']`.
  - `titles are stored once`: 2 channels × 10 programmes all titled "Live Football" → `index.titles` equals `['Live Football']`.
  - `slice keeps a programme that started before the slice and is still on`: programme 22:30–00:45 next day, slice from 23:59 → present with exact `start`/`stop` ms and `folded === ' live arsenal v slavia praha '` for title "LIVE: Arsenal v Slavia Praha".
  - `migrateProgrammeIndex`: valid v1 round-trips through `JSON.parse(JSON.stringify(...))`; `null`, `{}`, `{ schemaVersion: 99 }`, a string → `null`; never throws.
  - `needsIndexRefresh`: `null` → true; `{builtAt: now-1h, to: now+30h, failedAt: null}` → false; `to: now+23h` → true; `{builtAt: null, to: null, failedAt: now - 11h}` → false; `failedAt: now - 13h` → true; `{builtAt: now-2d, to: now+30h, failedAt: now-1h}` → false.
  - Performance: a 2 000-channel × 48-programme build plus `sliceIndex` over 2 hours runs under 500 ms (same style as the existing 10k tests).
- [ ] **Step 2:** Run `pnpm jest src/iptv/__tests__/programme-index.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Add `collect` to `xmltv.ts`; implement `programme-index.ts` as specified.
- [ ] **Step 4:** Run `pnpm jest src/iptv` → PASS (old `xmltv.test.ts` unchanged and green). `pnpm typecheck && pnpm lint` clean.
- [ ] **Step 5:** Commit `Live TV: collect a 48-hour programme index from the XMLTV guide`.

### Task 2: Pure programme search

**Files:**
- Create: `src/iptv/programme-search.ts`
- Test: `src/iptv/__tests__/programme-search.test.ts`

**Interfaces:**
- Consumes: `SlicedProgramme` (Task 1), `Channel`, `guideIdFor` (`guide.ts`), `foldText` (`search.ts`).
- Produces:
  ```ts
  export const ON_NOW_AHEAD_MS = 60 * 60_000;
  export const PROGRAMME_SEARCH_LIMIT = 50;
  export interface ProgrammeSource { providerId: string; programmes: readonly SlicedProgramme[]; channelsByGuideId: ReadonlyMap<string, readonly Channel[]> }
  export interface ProgrammeHit { key: string; providerId: string; title: string; start: number; stop: number; onNow: boolean; channels: readonly Channel[] } // channels[0] plays; key = `${providerId}:${guideId}:${start}`
  export function channelsByGuideId(channels: readonly Channel[], names: ReadonlyMap<string, string> | null): Map<string, Channel[]> // list order kept
  export function searchProgrammes(sources: readonly ProgrammeSource[], query: string, now: number, limit?: number): ProgrammeHit[]
  ```
  Rules: fewer than 2 folded characters → `[]`. Keep a programme when `stop > now && start <= now + ON_NOW_AHEAD_MS`, every query word is in `folded`, and its guide id has at least one channel. Order: `onNow` first, then `start`, then the order of `sources` (provider order), then title. Stop at `limit`.

- [ ] **Step 1: Write the failing tests:**
  - `finds a match on now across two providers in provider order`: providers A and B both carry "UEFA Champions League: Arsenal v Slavia Praha" 20:00–22:15; query "arsenal", now 20:30 → two hits, `providerId` A then B, both `onNow: true`.
  - `groups streams that share a guide id`: provider A channels `TNT Sports 1 HD`, `TNT Sports 1 FHD`, `TNT Sports 1 Backup`, all `epgId: 'tnt1.uk'` → one hit, `channels.map(c => c.name)` equals the three names in list order.
  - `links by display name when a channel has no epg id`: channel "Sky Sports Main Event" with no `epgId`, names map `'sky sports main event' → 'ssme.uk'` → hit found.
  - `window`: a programme starting in 59 min is a hit with `onNow: false`; one starting in 61 min is not; one that ended 1 min ago is not; one on now sorts before one starting in 10 min.
  - `every word must match, accents and case folded`: query "slavia ARSENAL" matches; "arsenal chelsea" does not; title "Atlético" matches query "atletico".
  - `short or empty query`: `"a"` and `"  "` → `[]`.
  - `drops programmes whose guide id has no channel`.
  - Performance: 5 providers × 20 000 sliced programmes searched in under 50 ms.
- [ ] **Step 2:** Run `pnpm jest src/iptv/__tests__/programme-search.test.ts` → FAIL.
- [ ] **Step 3:** Implement `programme-search.ts`.
- [ ] **Step 4:** Run the test → PASS; `pnpm typecheck && pnpm lint` clean.
- [ ] **Step 5:** Commit `Live TV: search programme titles over the guide slices`.

### Task 3: Background index refresh (I/O)

**Files:**
- Create: `src/iptv/programme-manager.ts`
- Modify: `src/iptv/xtream.ts` (add `xtreamGuideUrl`), `src/iptv/manager.ts` (M3U shared download; cleanup), `src/iptv/store.ts` (`programmeSlices`), `src/iptv/sync.ts` (start)
- Test: `src/iptv/__tests__/programme-manager.test.ts` (follow `manager.test.ts` for mocking transport, files and storage)

**Interfaces:**
- Consumes: Task 1 (`ProgrammeIndexBuilder`, `migrateProgrammeIndex`, `sliceIndex`, `needsIndexRefresh`, `IndexLedger`), `parseXmltv`, `transport.text`, `iptvFiles`, `storage`, `networkSource` (`@/servers/network-source`), `isNativeTV` / platform from `@/platform/tv`, `providerById`, `readSecrets`, `xtreamLogin`.
- Produces:
  ```ts
  // xtream.ts
  export function xtreamGuideUrl(login: XtreamLogin): string   // `${base}/xmltv.php?username=…&password=…`, same encoding as xtreamApiUrl
  // programme-manager.ts
  export function startProgrammeIndex(): void                   // idempotent; runs refreshDue() now and on AppState 'active'
  export async function refreshDue(now?: number): Promise<void> // sequential over providers in order; skips when not allowed
  export async function ensureSlices(now?: number): Promise<void> // loads saved index files into store.programmeSlices when missing or when the slice ends within 30 min
  export async function dropProgrammeIndex(providerId: string): Promise<void>
  export function programmeIndexEnabled(): boolean              // false on the plain web (iptvFiles.persistent === false)
  // store.ts: programmeSlices: Record<string, { from: number; to: number; programmes: SlicedProgramme[] }>
  ```
  Paths and keys: file `iptv/<providerId>/programmes.json`; ledger MMKV key `iptv.progidx.<providerId>` (`IndexLedger`). Slice in memory: now − 0 … now + 2 h.
  Network gate: allowed when not a phone (Mac app, TV), or when `networkSource.snapshot()` gives `type` `wifi` or `ethernet`. `null` snapshot on a phone → not allowed.
  Source URL: Xtream → `xtreamGuideUrl(login)`; M3U → `secrets.guideUrl ?? secrets.playlistGuideUrl`; none → skip with no ledger change. Keep set and `matchNames` built exactly as `loadGuide` does today (extract that into a small exported helper in `manager.ts`, `guideKeepFor(channels)`, and use it in both places). The provider's channels must be loaded first (`ensureLoaded`).
  M3U shared download: when the index refresh runs for an M3U provider, pass the same parse both the 6-hour window options and `collect`, and save the guide window and names exactly as `loadGuide` does (extract `saveGuideResult(id, r)` in `manager.ts`).
  Failure (transport error, `!looksLikeXmltv`, zero programmes collected): ledger `failedAt = now`, keep old file and slice, `console.warn('[iptv] programme index failed:', iptvErrorText(e))`.
  Cleanup: `removeProvider`, `applySynced` removals, `applyShared` removals and `saveProvider` when login or guide URL changes call `dropProgrammeIndex(id)` (file goes with `dirOf(id)` already; also clear ledger and slice).
  `startIptvSync()` calls `startProgrammeIndex()` when `programmeIndexEnabled()`. Account switch: slices are cleared with the rest of the per-account state in `bindSession`.

- [ ] **Step 1: Write the failing tests** (fake transport yields an XMLTV string in chunks; fake files map; fake network):
  - `builds and saves an index for an Xtream provider on Wi-Fi`: after `refreshDue(T0)`, the files map has `iptv/p1/programmes.json` that `migrateProgrammeIndex` accepts, ledger `builtAt === T0`, the requested URL ends with `/xmltv.php?username=…` (assert via the fake transport's recorded URL; do not log it).
  - `skips on mobile data on a phone`: network `cellular` → no transport call, ledger unchanged.
  - `skips when the index is fresh`: second `refreshDue(T0 + HOUR)` → no transport call.
  - `a failure keeps the old index and waits 12 hours`: first build OK; then transport answers `<html>…</html>` at T0+25h → file unchanged, `failedAt` set; `refreshDue(T0+30h)` → no transport call; `refreshDue(T0+38h)` → one call.
  - `M3U: one download feeds the guide window and the index`: exactly one transport call; `guide.json` and `programmes.json` both written.
  - `dropProgrammeIndex clears file, ledger and slice`, and `removeProvider` calls it.
  - `plain web: nothing runs` when `iptvFiles.persistent` is false.
  - `ensureSlices` loads only the 2-hour slice into the store.
- [ ] **Step 2:** Run `pnpm jest src/iptv/__tests__/programme-manager.test.ts` → FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `pnpm jest src/iptv` → PASS (incl. `manager.test.ts`); `pnpm typecheck && pnpm lint` clean.
- [ ] **Step 5:** Commit `Live TV: refresh a programme index in the background`.

### Task 4: Search hook and the "On now" section

**Files:**
- Modify: `src/iptv/index.ts`
- Create: `src/features/iptv/programme-row.tsx`
- Modify: `src/features/iptv/live-tv-screen.tsx`

**Interfaces:**
- Consumes: `searchProgrammes`, `channelsByGuideId`, `ProgrammeHit` (Task 2); `ensureSlices`, `programmeSlices` (Task 3); `useMinute`, `usePlayMerged`, `asProviderChannel`, `progressOf`.
- Produces:
  ```ts
  // index.ts
  export type { ProgrammeHit } from './programme-search';
  export function useProgrammeSearch(liveView: string | null, query: string): ProgrammeHit[] // liveView = provider id or ALL_PROVIDERS; [] when disabled or query < 2 chars
  // programme-row.tsx
  export function ProgrammeRow(props: { hit: ProgrammeHit; providerName: string | null; now: number; onPlay: (hit: ProgrammeHit, channel: Channel) => void }): JSX.Element
  ```
  The hook calls `ensureSlices()` when the query becomes non-empty, reads `programmeSlices` and the loaded channels (`data[pid].channels`, `guideNames[pid]`), memoises `channelsByGuideId` per provider, and recomputes on `useMinute()`.
  Row: channel logo (`ChannelLogo`), programme title (2 lines max), "Channel name · Provider · 20:00–22:15" (provider only in All providers), a thin progress bar when `onNow`, else "Starts at 20:45". Tap plays `channels[0]`. When `channels.length > 1`, a trailing tonal control "+N streams" opens a choice of the other streams (reuse the existing sheet/menu pattern used elsewhere in `features/iptv`; must be D-pad focusable on TV).
  Screen: when `searching && query` and hits exist, the list header shows a section title "On now" and the rows, above the existing result count. Play uses `usePlayMerged()` with the list of each hit's first stream as `ProviderChannel`, so channel up and down move through the hits. Remember the search like `onPlay` does. The empty-state text for a query with no channels and no programmes stays as today.
  Not on the plain web (hook returns `[]`).

- [ ] **Step 1:** Implement the hook; add a hook-free test in `src/iptv/__tests__/programme-search.test.ts` only if logic was added outside Task 2 (otherwise none: the hook is wiring).
- [ ] **Step 2:** Implement `programme-row.tsx` and the screen change.
- [ ] **Step 3:** `pnpm typecheck && pnpm lint && pnpm jest src/iptv src/features/iptv` → clean / PASS.
- [ ] **Step 4: Manual check (Mac app):** `pnpm expo start --web --port 8082` + `pnpm desktop:dev`, a provider with a guide: search a title that runs now → "On now" row; tap plays; "+N streams" works; All providers and one provider; window narrow and wide. Web `?tv=1`: D-pad reaches the rows and the streams control; Back works.
- [ ] **Step 5:** Commit `Live TV: show matching programmes on now in search`.

### Task 5: Docs, full checks, Mac update

**Files:**
- Modify: `AGENTS.md` (section 2.7a: a "Programme search" bullet; section 4: a table row for `programme-*.ts`), `CHANGELOG.md`, `desktop/CHANGELOG.md`

- [ ] **Step 1:** Write the docs (plain STE-style English like the existing text).
- [ ] **Step 2:** Run `pnpm typecheck && pnpm lint && pnpm test --ci` → all PASS.
- [ ] **Step 3:** Commit `Docs: Live TV programme search`.
- [ ] **Step 4:** Mac update (the maintainer approved publishing): follow the `tauri-mac-release` skill and `desktop/scripts/version.sh`, `release.sh`, `publish.sh` (bump the desktop version 0.1.12 → 0.1.13; do not touch `app.json` `version`). Verify the published `latest.json` names 0.1.13.
- [ ] **Step 5:** Tell the maintainer the Mac update is out. Do not publish an OTA update or merge to `main` until the maintainer approves.
