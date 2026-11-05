# Live TV: find the channel a programme is on

Date: 2026-11-04. State: draft, waiting for approval.

## Why

The maintainer often knows that a match is on now, but not which channel shows it.
Today they search the web ("Arsenal v Slavia Praha UK channel"), learn "TNT Sports 1", and then find that channel in one of several IPTV providers.
Zoggyfin cannot help: Live TV search looks only at channel names and numbers (`src/iptv/search.ts`).
The guide data that Zoggyfin keeps is too small to search. An M3U provider keeps the next 6 hours with at most 4 programmes per channel. An Xtream provider loads only now and next, and only for the channels on screen (`get_short_epg`).

Success: the maintainer types "Arsenal" in Live TV search at match time and plays the right channel with one tap.

## Goals

- Programme titles from each provider's guide are searchable in the existing Live TV search box.
- The search covers every provider ("All providers") and the single-provider search.
- A hit shows the programme title, the channel, the provider and the times. One tap plays the channel.
- The guide data loads in the background. The user never waits for it.

## Non-goals

- No team following, no "upcoming matches" list, no reminders or alerts.
- No outside fixtures or broadcaster feed. The data comes only from the providers' own guides.
- No full grid guide (a later phase may reuse the data).
- No use of one provider's guide for another provider's channels.

## Anti-goals

- The download or the parse must never freeze the UI or slow the app start.
- The feature must not use mobile data for a large download.
- The feature must not break the existing now-and-next display.

## Constraints

- Follow AGENTS.md: pure core with tests, thin I/O, versioned saved data, no `any`, design system, British spelling in UI text.
- JS only. It ships as an OTA update. No new native dependency.
- Every platform: iPhone, iPad, Android, TV, web, Mac app. On the plain web (no persistent files, CORS) the feature may fail like the M3U guide does today. Search then shows only channels, with no error.
- Guide links and logins are secrets. Error texts and logs never contain a URL (`errors.ts`).
- Large guides: Xtream `xmltv.php` is often 20 to 200 MB of text. The parse is incremental (`XmltvWindowParser` already reads in chunks). The transport limit is `MAX_LIST_BYTES` (400 MB).

## Behaviour

### Search

- When the query has at least 2 characters, the Live TV search shows a new section "On now" above the channel hits.
- "On now" lists programmes whose title contains the query and that run now, or start within the next 60 minutes. (60 minutes is the assistant's call; the maintainer did not object.)
- Matching uses the same folding as channel search (case, accents). Matching on description is not needed.
- Order: programmes on now first, then by start time. Then by provider order.
- One row per programme per provider. When several streams of one provider share one guide id ("TNT Sports 1 HD", "FHD", "Backup"), the row plays the first stream in list order. The other streams are reachable from the row (for example a "More streams" choice). The builder chooses the control, within the design system and with TV focus.
- Row content: programme title, channel name and logo, provider name (in "All providers"), start–end time, and a progress bar for a programme on now.
- No hits: the section does not show. The channel hits show as today.
- The section must work with the D-pad on TV.

### Link from guide to channel

- Xtream: a channel links through its `epg_channel_id` (already `channel.epgId`).
- M3U: through `tvg-id`, else through the display name (`guideIdFor` in `src/iptv/guide.ts`).
- A guide programme with no linked channel in that provider is dropped.

### Data

- New per-provider "title index": for each linked guide id, the programmes with start, stop and title only. No descriptions.
- It keeps only the next 48 hours (from 30 minutes ago), not the whole guide. The search needs only "now" and the next hour, and a full guide of a large panel is 1 to 3 million programmes. Programmes of channels with no link in the provider's list are dropped during the parse.
- Titles repeat a lot ("Live Football", news). Store each distinct title once and refer to it by number, so the file stays small.
- In memory, only the slice that the search needs (now to now + 2 hours) is held, rebuilt from the file at start and when the slice runs out. This keeps memory low on Fire TV and Android TV boxes.
- Saved as a file next to the other IPTV files (`iptv/<providerId>/…`), with a schema version and a migration that never throws.
- Xtream source: `xmltv.php` with the same login (built next to `xtreamApiUrl`). M3U source: the guide URL that exists today.
- Refresh: at app start (and on foreground), in the background, when the saved index is missing or its programmes end within 24 hours. In practice this is about once a day. One provider at a time.
- On iPhone, iPad and Android: download only on Wi-Fi or Ethernet. The Mac app, web and TV have no such limit.
- A failed download (the panel has no `xmltv.php`, an empty file, not XMLTV, too large) keeps the old index. The next try for that provider waits at least 12 hours, so a broken panel is not asked at every start. No error is shown in search. No fallback to per-channel guide calls: that provider simply has no programme hits.
- Plain web (not the Mac app): no programme index. Its files over 2 MB stay in memory only, so each page load would download the full guide again.
- When a provider is removed, or its login or guide link changes, its index goes (as the guide does today in `manager.ts`).
- Shared providers (`sh_…`) get an index like other providers.

### Relation to the existing guide

The existing M3U now-and-next download keeps its current behaviour on every network, mobile data included. When the index refresh runs (Wi-Fi on phones) and the M3U guide is due too, one download feeds both parses. On mobile data only the existing download runs. Xtream now-and-next stays on `get_short_epg`.

## Left to the builder

- The module split (for example a pure `programme-search.ts` and an I/O part in `manager.ts`), following the "pure core, thin I/O" rule.
- The saved file format, if it stays small (target: under about 10 MB per provider for 48 hours) and loads fast.
- How the Wi-Fi check is done in JS (an existing dependency such as `expo-network` or `@react-native-community/netinfo` if it is already installed; no new native dependency).
- Performance targets: the search over all providers' indexes returns in under 50 ms for 100k programmes; tests with large fixtures, like the existing parser tests.

## Search matching

Programme titles match by the same rule as channel search: every word of the query must be in the title, after folding (case, accents).

## Tests and checks

- Unit tests: the index build from XMLTV (incremental, large fixture), the search (folding, window, order, grouping of streams by guide id), the refresh rule, the migration.
- Manual: an Xtream provider and an M3U provider with a guide. Search a programme that runs now. Play it from the row. Phone, iPad width, web, Mac app and TV (`?tv=1`).
- Risk to confirm on the maintainer's providers: whether their guides name the matches. A guide that says only "Live Football" gives no hits. The feature cannot fix that.

## Calls made by the assistant (not discussed)

- The "On now" window includes the next 60 minutes.
- Wi-Fi only on phones.
- Keep 48 hours, refresh about once a day, wait 12 hours after a failure.
- The existing M3U guide download stays as it is on mobile data.
- No fallback for a panel without a working `xmltv.php`.
- No programme index on the plain web.
- Word matching, the same as channel search.
- One row per provider, with other streams of the same guide id one tap away.
- No cross-provider guide use.
