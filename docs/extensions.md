# Extensions

An extension adds features for your own setup without a change to the app. For
example, a self-hosted downloader can add a "Download" target for shared links,
buttons on items, Home rows and a page.

An extension is **data only**. The app reads a JSON manifest from your server and
draws the contributions. No code from an extension runs in the app (App Store
guideline 2.5.2): there is no `eval`, and the app downloads no scripts. A panel is
a normal web page in a WebView or an iframe. It can only use the bridge
methods below.

Extensions work on iPhone, iPad, Android, web and the Mac app.

## Install

1. Settings → Extensions → **Add an extension**.
2. Enter the manifest URL, or only the address of the extension's server (for
   example `http://192.0.2.10:3000`). For a server address, the app tries
   `<address>/zoggyfin-extension.json`, then
   `<address>/.well-known/zoggyfin-extension.json`.
3. The confirm screen shows the name, the server, the permissions and the
   contributions. Tap **Add**. The app fills in the settings by itself.

You can turn an extension off, change its permissions and settings, check for an
update, or remove it on its page in Settings → Extensions.

### Updates

The app loads the manifest of each installed extension again at start, when
you sign in to another account, and then at most once every 6 hours while it
is in use. "Check for an update" on the extension's page checks at once.

- An update that needs no new permission and places no new page (a page that
  asks for a tab or a Library tile it did not ask for before) applies by
  itself, with no question. New `tabs`, sections, settings and a new
  `version` are such updates.
- An update that asks for a new permission or places a new page is not
  applied. The extension shows "Update available" in Settings → Extensions,
  its page has "Review the update" (the confirm screen), and the app shows
  one toast per account, extension and version. "Check for an update" opens
  the confirm screen for it at once.
- A manifest that does not load, is not valid, or has another `id` changes
  nothing.

Other parts of the app use two functions from `src/extensions`:

- `extensionsForInvite()` returns the manifest URLs of the turned-on extensions.
- `installFromInvite(urls)` shows one confirm screen for all the extensions in
  the list that are not installed yet.

### Your extensions follow your account

The installed extensions belong to the Jellyfin account (server and user), not
to the device. Each account on a device has its own list, and a switch to
another account shows that account's extensions.

The list also syncs through the account, like Live TV. It is kept in the
user's display preferences (id `zoggyfin-extensions`, client `zoggyfin`).

- What syncs: the manifest URL, on or off, the permissions you allowed, the
  settings that are not secret, the page you chose as a tab, and the skip
  choices per segment label. The manifest itself does not: each device loads
  it from its URL.
- Secret settings (`"secret": true`) never leave the device. Enter them again
  on each device.
- An extension that you added on another device shows the confirm screen once,
  with the title "From your account". **Not now** keeps it off this device; it
  does not ask again until the extension is removed and added again.
- An extension that you remove on one device goes from your other devices,
  with no question.
- The first sync of a device only adds to the account. When the same extension
  is already in the account, the account's settings win.

The first start of this version copies the list that was on the device to
every account saved on it.

## Manifest (schema version 1)

The schema is in `src/extensions/schema/` (zod). The app reads schema versions 1
and 2 (see [Schema version 2](#schema-version-2)). A manifest that is not valid
is refused, and the error names the first wrong field. A version 1 manifest
stays valid.

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `1` or `2` | Required. This section describes version 1. |
| `id` | string | Lower-case letters, digits, `.`, `_`, `-`. One install per id. |
| `name`, `version` | string | Shown on the confirm screen. |
| `description` | string | Optional. |
| `baseUrl` | http(s) URL | Every request goes to this origin and to no other. |
| `permissions` | array | `network` (always added), `itemPath`, `jellyfinToken`. |
| `headers` | object | Optional. Headers for each request. Values are templates. |
| `contributes` | object | `settings`, `itemActions`, `homeSections`, `shareTargets`, `panels`. |

### Permissions

- `network`: the app sends requests to the `baseUrl` origin only. A request,
  a feed image or a panel page on another origin is refused.
- `itemPath`: the app sends the file path of an item (`{{item.path}}`), and
  `when.pathPrefixes` can filter on it.
- `jellyfinToken`: the app sends the user's Jellyfin token and server with each
  request:
  - `Authorization: MediaBrowser Token="<token>"`
  - `X-Emby-Token: <token>`
  - `X-Jellyfin-Server-Url`, `X-Jellyfin-Server-Id`, `X-Jellyfin-User-Id`

  The confirm screen shows this permission in red ("<name> can act as you on
  your Jellyfin server"), with its own switch. The user can turn it off there or
  later. The extension must check the token against its own Jellyfin server, for
  example with `GET /Users/Me`, and refuse tokens of other servers.

### Templates

Strings in `path`, `query`, `body`, `headers`, `confirm` and a panel `url` can
contain `{{scope.key}}`. A template only reads a value; there are no
expressions. An unknown name gives an empty string. Values in a `path` are URL
encoded. In a `body`, a string that is exactly one token of a toggle setting
or of `action.next` keeps its `true`/`false` type.

| Scope | Keys |
| --- | --- |
| `item` | `id`, `name`, `type`, `mediaType`, `libraryName`, `serverId`, `path` (only with `itemPath`) |
| `input` | the keys of the action's `inputs` |
| `settings` | the keys of `contributes.settings` |
| `share` | `url` |
| `jellyfin` | `serverUrl`, `serverId`, `userId`, `userName`, `isAdmin` |
| `action` | `next`: the state an on/off button of an entry page asks for, `true` or `false` (schema version 2) |

### `settings`

Simple fields, kept per account and extension (they sync, see above). Secret text goes to the
keychain (secure store on web). The user never has to type a value: each field
gets one by itself.

```json
{ "key": "user", "type": "text", "label": "User", "source": "jellyfin.userName" }
{ "key": "loud", "type": "toggle", "label": "Loud", "default": true }
{ "key": "folder", "type": "choice", "label": "Folder", "optionsSource": "/api/folders", "matchLibrary": true }
{ "key": "apiKey", "type": "text", "label": "API key", "secret": true }
```

- `source`: `jellyfin.serverUrl`, `jellyfin.serverId`, `jellyfin.userId`,
  `jellyfin.userName` or `jellyfin.isAdmin` (toggle). The value follows the
  signed-in account.
- `optionsSource`: an endpoint for the choices. The app loads it at install and
  when the settings page opens.
- `matchLibrary`: choose the first option whose value or label is the name of a
  Jellyfin library.
- The value in use is: what the user set, else the filled-in value, else the
  `source` value, else `default`, else the first option.

### `itemActions`

A button in an item's action sheet.

```json
{
  "id": "convert",
  "title": "Convert to MP3",
  "icon": "music.note",
  "destructive": false,
  "when": { "types": ["Movie", "Video"], "mediaTypes": ["Video"], "libraries": ["YouTube"], "pathPrefixes": ["/media/videos/"] },
  "confirm": { "title": "Convert {{item.name}}?", "message": "…", "action": "Convert" },
  "inputs": [
    { "key": "name", "type": "text", "title": "New name", "default": "{{item.name}}" },
    { "key": "folder", "type": "choice", "title": "Folder", "source": "/api/folders" }
  ],
  "request": { "method": "POST", "path": "/api/convert", "query": {}, "body": { "path": "{{item.path}}" } }
}
```

- `when`: every given field must match. `libraries` compares without case.
  `pathPrefixes` needs `itemPath`. The app loads the library name and the path
  only when an enabled action uses them.
- `inputs` are asked one after the other, then `confirm`. Cancel stops the
  action.
- `icon` is an icon name of the app (see `src/components/icon-names.ts`).
  Another name shows a default icon.

### Choice lists

An input `source` or a setting `optionsSource` answers with one of these:

```json
{ "options": [{ "value": "videos", "label": "Videos" }] }
[{ "value": "videos", "label": "Videos" }]
["videos", "music"]
```

### Responses

An action or a share target answers with JSON. All fields are optional:

```json
{
  "toast": "Download started",
  "task": { "id": "42", "title": "Downloading Clip", "statusUrl": "/api/tasks/42", "intervalSeconds": 2 },
  "refresh": "none | item | library"
}
```

- No `toast` and no `task`: the app shows "<action>: sent to <name>".
- An error status (not 2xx) shows the `error` text of the body:
  `{ "error": "Already downloaded" }`.
- `refresh: "library"` makes the app load its data again now, after 8 s and
  after 25 s, while the server scans. The extension asks Jellyfin to scan.

A **task** is shown in a "Tasks" row at the top of Home. The app polls
`statusUrl` with GET:

```json
{ "state": "queued | running | done | failed", "progress": 0.45, "title": "…", "message": "…", "toast": "Saved", "refresh": "library" }
```

`progress` is 0 to 1. On `done`, the app shows `toast` (or "<title>: done") and
applies `refresh`. After 4 failed polls in a row, or after 3 hours, the app stops
and shows an error. Running tasks are saved, so the app follows them again after
a restart.

### `homeSections`

A Home row from a JSON feed.

```json
{ "id": "recent", "title": "Recently downloaded", "feed": "/api/feed/recent", "refreshSeconds": 60, "shape": "thumb" }
```

The feed:

```json
{
  "items": [
    { "itemId": "<jellyfin item id>", "subtitle": "videos" },
    { "id": "a", "title": "Clip", "subtitle": "45%", "image": "/thumbs/a.jpg", "progress": 0.45, "panel": "main" },
    { "id": "b", "title": "Docs", "link": "https://example.org" }
  ]
}
```

- An entry with `itemId` shows as a normal tile of that Jellyfin item. If the
  user cannot see that item, an entry with a `title` shows as a card.
- A card opens a `panel` of the extension, or a `link` (http or https) in the
  browser.
- `image` must be on the extension's origin.
- A feed that fails shows a small note ("<name> is not available now"). An empty
  feed hides the row. A row never blocks Home.

### `shareTargets`

Links shared to the app go to the targets whose `hosts` match. Empty `hosts`:
any http(s) link. `youtube.com` also matches `www.youtube.com`.

```json
{
  "id": "download",
  "title": "Download with My Downloader",
  "hosts": ["youtube.com", "youtu.be"],
  "inputs": [{ "key": "format", "type": "choice", "title": "Format", "options": [{ "value": "video", "label": "Video" }] }],
  "request": { "method": "POST", "path": "/api/downloads", "body": { "url": "{{share.url}}", "type": "{{input.format}}" } }
}
```

How a link gets to the app:

| Platform | Path |
| --- | --- |
| All | Settings → Send link to… (paste a link) |
| iPhone, iPad | `zoggyfin://share?url=<link>`. Make a Shortcut: "Receive URLs from Share Sheet", then "Open URLs" with `zoggyfin://share?url=` + the URL-encoded input. It shows in the share sheet. |
| Android | The share sheet: an intent filter for `text/plain` (needs a native build). |
| Web, Mac app | `/share?url=<link>` or paste. |

### `panels`

A full page from the extension, opened from Settings → Extensions, from the
extension's page, or from a feed card.

```json
{ "id": "main", "title": "My Downloader", "url": "/panel" }
```

iPhone, iPad and Android show it in a WebView; web and the Mac app show it in a
sandboxed iframe. The page talks to the app with `postMessage`:

```js
const pending = new Map();
let seq = 0;
window.addEventListener('message', (e) => {
  const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
  if (!d || d.zoggyfin !== 1 || !pending.has(d.id)) return;
  const p = pending.get(d.id);
  pending.delete(d.id);
  d.error ? p.reject(new Error(d.error)) : p.resolve(d.result);
});
function zoggyfin(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    const msg = { zoggyfin: 1, id, method, params };
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    else window.parent.postMessage(msg, '*');
  });
}
```

| Method | Params | Result |
| --- | --- | --- |
| `getContext` | – | `{ extension, settings, jellyfin, theme, platform }`. `jellyfin.token` is there only with `jellyfinToken`. |
| `play` | `{ itemId }` | Plays the item. |
| `openItem` | `{ itemId }` | Closes the panel and opens the item. |
| `refreshLibrary` | – | Loads the app's data again: the Jellyfin data, the feeds of other extensions and entry pages, now and again after 8 s and 25 s. The calling extension's feeds load once, when the panel closes. |
| `toast` | `{ text }` | Shows a toast. |
| `close` | – | Closes the panel. |
| `playMedia` | `{ mediaId, playback, title?, image? }` | Plays the media, as a card with `media` does. `playback` (and `image`) must be on the extension's origin. Needs the `playback` permission, and the user's switch must be on; otherwise the answer is an error that says so. Schema version 2. |
| `openEntry` | `{ detail, title? }` | Closes the panel and opens the entry page of `detail` (on the extension's origin). Schema version 2. |
| `openPage` | `{ page, tab? }` | Closes the panel and shows one of the manifest's pages. When the page is already open under the panel (in the same tab, or as the root of the extension tab), the app goes back to it; else it opens it. `tab`: the id of one of the page's tabs to select (an unknown id is an error). The feeds load again once, when the panel closes. Schema version 2. |
| `refreshPage` | – | Loads the feeds of this extension again (its pages, Home rows and search results), and nothing else. The panel stays open. |
| `openExternal` | `{ url }` | Opens `url` in the system browser (web and the Mac app: a new browser tab). `url` must use `https` and must not hold a user name or a password; another URL is an error. Needs the `network` permission (every extension has it). The answer is `{ "opened": true }` or `{ "opened": false }`. There is no confirm, as for a feed card's `link`. On the web, a blocked popup still answers `true`. |

The app answers only messages from the extension's origin, and sends answers
only to that origin.

**Links in a panel.** Use `openExternal` for a page that must open outside
the app (a sign-in page of another site, a help page). A plain link behaves
differently on each platform: on the web and in the Mac app, a
`target="_blank"` link opens a new browser tab (the iframe allows popups) and
a plain link loads in the panel; on iPhone and iPad, a `target="_blank"` link
does nothing and a plain link loads in the panel; on Android, both load in the
panel. A page on another origin that loads in the panel cannot use the bridge.

**After a change in a panel.** When a panel closes (by `close`, `openPage`,
`openItem`, `openEntry`, the close button or Back), the app loads the feeds of
that extension again, once per feed. A panel that changes what the feeds show
(for example a sign-in) can therefore close with `openPage` or `close`; it
does not need `refreshLibrary`. Use `refreshPage` to reload the feeds while
the panel stays open (they load once more when it closes). The app sends feed requests itself, with the manifest `headers`; it
never sends the panel's cookies. Keep a sign-in made in a panel on the
extension's server, not only in a cookie of the panel page.

### CORS

Web and the Mac app send requests from a browser, so the extension must allow
CORS for the app's origins: the web address of your Zoggyfin, `tauri://localhost`
and `http://tauri.localhost` (the Mac app), and `http://localhost:<port>` for
development. Allow the headers `Content-Type`, `Authorization`, `X-Emby-Token`,
`X-Jellyfin-Server-Url`, `X-Jellyfin-Server-Id`, `X-Jellyfin-User-Id` and
`Prefer` (the download description, see "Preparing" below). The iPhone, iPad
and Android apps send no `Origin`.

A panel must allow framing by those origins (no `X-Frame-Options: DENY`, and no
`frame-ancestors` that leaves them out).

### Time limits

Actions have 15 s. Feeds, choice lists and task polls have 8 s. A slow or broken
extension shows an error toast or a small note; it never blocks a screen.

## Schema version 2

Version 2 adds native pages, playable media, downloads and skip labels. It
keeps every version 1 field and contribution except `homeSections`: a Home row
is now a page section named in `placement.home`.

The app shows each page with its sections and its search (see "Pages"
below), the sections in `placement.home` as Home rows, an entry page for an
entry with `detail`, plays an entry's `media` in the video player (with
qualities, subtitles, chapters, labelled skip segments and progress reports),
and saves it on the device (see "Downloads: how it works"). A page opens from
the extension in Settings → Extensions ("Open <page>"), from the header of its
Home rows, and in the places its `placement` asks for (see "Where a page
shows" below). Each skip label has a setting in the "Skip" group of the
extension's page in Settings → Extensions.

A version 1 manifest is read as version 2 with one page per Home row: the page
has one `row` section, no tab, no Library tile, and the section on Home.

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

| Field | Notes |
| --- | --- |
| `permissions` | Adds `playback` (the app plays streams from the origin and sends progress) and `downloads` (the app saves files from the origin on the device). Both show on the confirm screen, each with its own switch (on by default). Turn one off there or on the extension's page in Settings to stop that use. A version 1 manifest cannot ask for them. |
| `pages` | At most 5. `id`, `title`, an optional `icon` (an icon name of the app), an optional `image` (the artwork of its Library tile, see below), `placement`, an optional `search`, and 1 to 8 `sections`, or `tabs` (see [Tabs](#tabs)), or both. |
| `tabs` | 2 to 6 tabs. Each has `id`, `title`, 1 to 8 `sections` and an optional `search`. |
| `placement` | `tab`: the page may show as a tab. `library`: a tile in the Library grid. `home`: ids of sections of this page that also show as Home rows, in that order. All are off by default. |
| `search` | `feed` gets `query` and `cursor`, and answers with a feed page. `placeholder` is optional. `global` (default `false`) also shows the results in the app's Search tab, under `title` (at most 40 characters; default: the page title). See [Results in the Search tab](#results-in-the-search-tab). |
| `sections` | `id`, `title`, `feed`, `layout` (`row`, the default, `grid` or `list`), `shape` (`poster`, `thumb`, the default, or `square`), `refreshSeconds` (5 to 3600). `grid` and `list` load the next page near the end. |
| `skipLabels` | At most 10. `id`, `title`, `default`: `auto` (skip, with Undo), `ask` (the default; a Skip button) or `off`. |

Ids are unique in each list: pages, the sections of one page, the tabs of one
page, the section ids across all tabs of one page, the Home ids of one page,
and skip labels. A Home id must name a section of its page (in `sections` or
in a tab).

### Replies (schema version 2)

All paths are under `baseUrl`, or full URLs on the same origin. The app checks
every URL in a reply: a URL on another origin is left out, never followed. A
reply is read entry by entry: a bad entry is left out, and the others stay.

**Feed page.** `GET <feed>?cursor=<cursor>` (search adds `query`):

```json
{ "items": [], "next": "opaque-cursor-or-null" }
```

`next` is a cursor, not a URL. No `next`, `null` or `""` means the last page,
so a version 1 feed is one page. At most 100 entries per page.

**Why a feed is empty.** A feed with no entries can say why, and offer a
button that opens one of the extension's panels:

```json
{ "items": [], "message": "Sign in to see your list.", "action": { "title": "Sign in", "panel": "account" } }
```

- `message`: plain text, 200 characters at most. It shows only when the feed
  has no entries, on a page in place of "Nothing here yet.". Home rows stay
  hidden when they are empty.
- `action`: optional, only with `message`. `title` is 40 characters at most;
  `panel` must be the id of a panel in the manifest, else the button is left
  out. TV has no panels, so it shows the message only.
- When the panel closes, the app loads the feeds again (see "After a change in
  a panel").

**Feed entry.** The version 1 fields stay. Version 2 adds:

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

- `badge`: a short label (40 characters at most).
- `detail`: answers with a detail description.
- `media`: `kind` is `video` (the default) or `audio`; `duration` is in seconds;
  `playback` answers with a stream description; `download` with a download
  description. Media with neither URL on the origin is left out.
- A bad `badge`, `detail` or `media` is left out on its own; the entry stays.
- A card opens, in this order: `detail`, else plays `media`, else `panel`,
  else `link`. An entry with an `itemId` that the server knows shows and
  opens as that Jellyfin item. TV has no panels: a card that only opens a
  panel says so there.

### Pages

A page shows its title, a search field when it has `search`, and its
sections in order.

- `row`: one horizontal row with the first page of the feed.
- The last section of a page, when it is a `grid` or a `list`, fills the rest
  of the screen and asks for the next page (`?cursor=<next>`) when the user
  nears its end. It stops when `next` is empty, when a cursor comes back a
  second time, or after 20 pages (2000 entries), with a note.
- A `grid` or `list` that is not last shows its first entries (a row for a
  grid, five lines for a list) and "See all", which opens that section on
  its own screen, where it pages.
- While the user types in the search field, the app waits 0.3 s, then sends
  `GET <search.feed>?query=<text>` (and `cursor` for more pages). The results
  replace the sections until the field is empty. A reply to an older text is
  never shown.
- A section that fails shows its title, "<name> is not available now." and
  "Try again"; the rest of the page stays. A section with no entries shows
  its title, "Nothing here yet." (or the feed's `message`, see below) and
  "Reload". A section never disappears from a page (or a page tab) without a
  word. On Home, a row that loads or is empty takes no room. On an entry page,
  an empty row takes no room either.
- Pull to refresh (not on TV) loads every feed of the extension again.
  `refreshSeconds` loads a feed again on that interval.
- The cursor and the search text are added to the URL as they are: they are
  never read as templates.

### Results in the Search tab

A `search` (of a page or of a tab) with `"global": true` also runs when the
user searches in the app's own Search tab. Its results show as a row after the
server's results, under `title`, or the page title when `title` is left out.

```json
"search": {
  "feed": "/api/search",
  "placeholder": "Search films",
  "global": true,
  "title": "From the catalogue"
}
```

- The app sends `GET <search.feed>?query=<text>` with the same headers and
  limits as the page's own search (8 s), and shows the first page only. It
  never sends `cursor` here.
- It runs for text of 2 or more characters, after the Search tab's pause in
  typing, beside the server search: a slow extension never holds back the
  server's results. A reply to an older text is never shown.
- It runs only for extensions that are turned on for the signed-in account,
  only online, only with the All, Movies or Shows filter, and not when a genre
  is chosen. Downloads and the offline search do not change.
- At most 4 searches run, in the order of Settings → Extensions, then page
  order, then the page's search before its tabs' searches. A feed that two
  searches of one extension name runs once.
- The tiles use the shape of the page's (or tab's) first `grid`, else wide
  tiles, and open as they do on the page: an entry with `itemId` opens the
  Jellyfin item, an entry with `detail` its entry page.
- While the reply is out the row shows a short loading line. An empty reply,
  an error or a timeout shows nothing.
- `global` and `title` need no new schema version: an app version that does
  not know them ignores them. A manifest that the app saved before it knew
  them gets them at the next update check of the extension.

### Tabs

A page can split its sections into tabs. The app shows a tab strip under the
page title; on TV it is a row that the D-pad reaches.

```json
{
  "id": "main",
  "title": "Example",
  "placement": { "tab": true, "home": ["latest"] },
  "search": { "feed": "/api/search" },
  "sections": [
    { "id": "latest", "title": "Latest", "feed": "/api/feed/latest" },
    { "id": "all", "title": "Everything", "layout": "grid", "feed": "/api/feed/all" }
  ],
  "tabs": [
    {
      "id": "films",
      "title": "Films",
      "sections": [
        { "id": "latest", "title": "Latest", "feed": "/api/feed/latest" },
        { "id": "all", "title": "Everything", "layout": "grid", "feed": "/api/feed/all" }
      ]
    },
    {
      "id": "shows",
      "title": "Shows",
      "search": { "feed": "/api/search/shows", "placeholder": "Search shows" },
      "sections": [{ "id": "airing", "title": "Airing", "layout": "list", "feed": "/api/feed/airing" }]
    }
  ]
}
```

- `tabs`: 2 to 6 tabs. A tab has `id`, `title`, 1 to 8 `sections` (the same
  fields as page sections) and an optional `search` (the same fields as the
  page `search`). Tab ids are unique on the page. Section ids are unique
  across all tabs of the page.
- Each tab is laid out like a page: rows, previews with "See all", and a last
  `grid` or `list` that loads more.
- A tab without its own `search` uses the page's `search`; with neither, it
  has no search field.
- The app loads a tab's feeds when the tab first shows, and keeps each tab's
  feeds and scroll position while the user switches (on TV the feeds come
  back from the cache; the scroll position starts at the top). The page opens
  on the tab the user chose last on it, until the app quits.
- `placement.home` can name a section inside any tab.
- `tabs` and `sections`: `tabs` wins. `sections` is what an app version
  without tabs shows. Such a version ignores `tabs`, but it refuses a page
  with no `sections` and a Home id that is not in `sections`, and so the whole
  manifest. Until every user has a version with tabs, keep `sections` on the
  page and keep each Home id in it.
- A `tabs` value that is not valid (fewer than 2 or more than 6 tabs, an id
  used twice, a bad section) is left out when the page has `sections`: the
  page shows them. A page with no `sections` and bad `tabs` is refused, as is
  a page with neither.
- An update that only adds `tabs` (and a new `version`) asks nothing: it
  needs no new permission and places no new page.

### Where a page shows

`placement` asks for places; the app decides per platform. Only the pages of
extensions that are on count. With no extension that asks, the app looks as
it did before.

| Place | iPhone, Android phone and tablet | iPad | Web, Mac app | TV |
|---|---|---|---|---|
| The tab (`tab`) | A Library tile, or a tab in place of one tab (the user chooses, see below) | A tab (the sidebar in regular width) | A tab, an item in the sidebar | An item in the side menu |
| A Library tile (`library`) | A tile after the libraries, unless the page is the tab | A tile after the libraries | A tile, unless the page is the tab | An item in the side menu |
| Home rows (`home`) | Yes | Yes | Yes | Yes |

- **One tab.** The app has one tab slot for all extensions. When more than one
  page has `tab: true`, the page chosen in Settings → Extensions → the
  extension → "Show as tab" fills it (the choice follows the account to other
  devices). With no choice, the page of the extension installed first fills it.
- **Phones.** Phones already have five tabs (Android cannot show a sixth), so
  the user chooses in Settings → Extensions → the extension → "On this phone":
  - **Library tile** (the default): the page with `tab: true` is a tile in
    Library, like a page with `library: true`.
  - **Tab in place of Music, Downloads, Search or Library**: the page is a
    tab, and the chosen tab hides. Home is never replaced. The bar keeps five
    tabs.

  The replaced tab stays one tap away. Music, Downloads and Search get a tile
  in Library with the tab's name and icon; it opens the same screen in the
  Library stack. When Library is replaced, Home shows a "Library" button at
  the top. Links, the music player's "open" actions and "Go to Downloads"
  go to the new place. One extension at a time can be the phone tab; its
  page is the one chosen with "Show as tab", else its first tab page. The
  choice follows the account to your other phones; iPad, the web, the Mac
  app and TV ignore it. When the extension is off or removed, loses its tab
  page in an update, or you sign in to an account without it, the replaced
  tab comes back. A change rebuilds the tab bar and opens Home; playback and
  the mini player go on.
- **TV.** The side menu lists at most two extension pages, before Settings:
  the tab page first, then the pages with `tab` or `library` in install order.
- **Tile artwork.** `image` is a path under `baseUrl` (or a URL on its
  origin; another origin is left out) of a picture for the page's Library
  tile, 16:9 like the Jellyfin library tiles. It loads like an entry image:
  no Jellyfin token, no manifest headers. The tile shows the `icon` while the
  picture loads and when it fails. With an `image`, the caption is the page
  title alone, as on a Jellyfin library tile; put the name in the picture if
  you want it on the artwork too. App versions without this field ignore it.
- The tab and the side menu show the page `title` and `icon`. `icon` is an
  icon name of the app (`src/components/icon-names.ts`, for example `film`,
  `tv`, `music.note`, `play.fill`). Another name shows a grid icon.

**Stream description.** `GET media.playback`:

```json
{
  "stream": { "url": "/hls/e123/master.m3u8", "type": "hls" },
  "alternatives": [{ "url": "/files/e123.mp4", "type": "file" }],
  "title": "An entry",
  "subtitle": "Example Media",
  "image": "/img/e123.jpg",
  "duration": 734,
  "resume": 120.5,
  "qualities": [{ "id": "720", "label": "720p", "url": "/hls/e123/720.m3u8" }],
  "subtitles": [{ "id": "en", "label": "English", "language": "en", "url": "/subs/e123.en.vtt" }],
  "segments": [{ "label": "intro", "start": 0, "end": 12.5 }],
  "chapters": [{ "title": "Part 1", "start": 0 }],
  "next": { "id": "e124", "title": "Next entry", "media": { "id": "e124", "playback": "/api/entries/e124/play" } },
  "report": { "path": "/api/entries/e123/progress", "intervalSeconds": 10 }
}
```

- The player tries `stream`, then each of `alternatives` (5 at most). With no
  `type`, a path that ends in `.m3u8` is `hls`, any other is `file`. With no
  stream on the origin, the reply is refused.
- `live: true` marks a live stream: `duration` and `resume` are ignored.
- `resume` at or past `duration` is ignored.
- Segment labels are free text. `skipLabels` say what the player does with each.
- `next` is a feed entry with `media.playback`; otherwise it is left out.
- `report.intervalSeconds` is 5 to 300 (10 by default).
- On the web and in the Mac app, playlists and segments need CORS, as feeds do.

**Progress report.** `POST report.path`. Errors are ignored.

```json
{ "event": "start | progress | pause | resume | seek | stop | finished", "mediaId": "e123", "position": 130.2, "duration": 734, "rate": 1, "quality": "720", "offline": false }
```

Times are seconds, to 0.1 s. `duration` is not sent for a live stream, and
`quality` is not sent when the stream has no qualities.

**Detail description.** `GET entry.detail`:

```json
{
  "title": "An entry",
  "eyebrow": "Example Media",
  "image": "/img/e123.jpg",
  "backdrop": "/img/e123-wide.jpg",
  "shape": "thumb",
  "lines": ["12 min", "2 days ago"],
  "description": "Plain text.",
  "media": { "id": "e123", "kind": "video", "playback": "/api/entries/e123/play" },
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
  "sections": [{ "id": "related", "title": "Related", "layout": "row", "feed": "/api/entries/e123/related" }]
}
```

- `title` is required. Any other bad field is left out on its own.
- `shape` is the shape of `image`: `poster` (2:3), `thumb` (16:9) or `square`. When it is
  left out, a video entry is a `thumb`, an audio entry a `square`, and an entry with no
  `media` a `poster`. The app shows the whole picture in that shape and never crops a
  `thumb` to 2:3.
- At most 6 `lines` and 6 `actions`, and 8 `sections`.
- An action takes `inputs` and `confirm`, as an item action does. With
  `state`, it is an on/off button; `{{action.next}}` is the state it asks for.
  An action whose `request.path` is on another origin is left out.

The answer to an action adds two `refresh` values and `state` to
[Responses](#responses):

```json
{ "toast": "Saved", "refresh": "none | item | entry | page | library", "state": { "on": true } }
```

`entry` reloads the detail page, `page` the extension page. Where there is no
such page (the item action sheet), they do nothing. A `state` that is not valid
is ignored.

**The entry page.** A card with `detail` opens the entry page. The app loads
the detail description (8 s at most) and shows:

- The picture (`image`, in its `shape`), the eyebrow, the title and the `lines`
  on one line. A `poster` shows with the backdrop above it. A `thumb` or `square` shows
  whole, and the backdrop shows only on wide screens and only when it is another picture. The description shows three lines and "More".
- Play, or Resume with a bar when `progress` is more than 0 and less than 1.
  Play needs `media.playback`. Resume plays from the stream description's
  `resume`; "Start over" plays from 0.
- Download when `media.download` is set, the user's downloads switch is on,
  and the device saves files (not TV and not the plain web).
- The buttons of `actions`, in one row. The row is centred while it fits and scrolls
  sideways when it does not. A long title ends in an ellipsis. `icon` is an icon name of the app
  (`src/components/icon-names.ts`); an unknown name shows a default icon.
  The app knows common button names, for example `hand.thumbsup`, `bell`, `clock`, `bookmark`,
  `star`, `eye`, `flag` and `square.and.arrow.up`, each with a `.fill` form where it makes sense.
- The `sections`, as on a page. A row is the default. A last `grid` or `list`
  scrolls with the page and asks for more. A `grid` or `list` that is not last
  shows its first entries with no "See all".
- While it loads, a placeholder; when it fails, a message (never a URL) and
  "Try again". A `detail` URL on another origin shows "This entry cannot be
  opened".
- TV: Play has the first focus (with no Play, the first button). The D-pad
  goes from Play to the buttons, then down to the sections.

**Buttons with state.** An action with `state` is an on/off button:

- It shows `title` and `icon` while off, and `onTitle` and `onIcon` (else the
  same ones) while on, in the accent colour.
- A press runs the action's `inputs` and `confirm` first. Then the button
  shows the new state at once and the app sends the request with
  `{{action.next}}` set to that state (`true` or `false`; in a JSON body as a
  boolean, in a path or a query as text).
- A failed request (an error, a time-out, an HTTP error) puts back the last
  state that the extension confirmed.
- `state` in the reply is the truth: the button shows it. With no `state`, the
  button keeps the state it asked for.
- When the user presses again before a reply arrives, only the reply to the
  newest press changes the button. A late reply to an older press never does.
- `refresh: "entry"` loads the entry page again; the page's own state is the
  truth after that. `"page"` loads the extension's feeds again, and
  `"library"` the app's data, as for an item action.

**Long press.** A long press (a right click on the web and in the Mac app) on
a card with `media` opens a menu:

| Row | Shown when |
| --- | --- |
| Play | `media.playback` is set |
| Play from the beginning | `media.playback` is set and `progress` is more than 0 and less than 1 |
| Open | the card has `detail` |
| Download | `media.download` is set, the user's downloads switch is on, and the device saves files |

**Playback and downloads switches.** The `playback` and `downloads`
permissions have a switch on the confirm screen and in Settings → Extensions.
With playback off, Play (on a card, in the menu, on the entry page and from a
panel) shows "Playback is turned off for <name>. Turn it on in Settings →
Extensions." With downloads off, Download does not show.

**Download description.** `GET media.download`:

```json
{
  "url": "/files/e123-720.mp4",
  "bytes": 123456789,
  "container": "mp4",
  "label": "720p",
  "subtitles": [{ "label": "English", "language": "en", "url": "/subs/e123.en.vtt" }],
  "image": "/img/e123.jpg",
  "options": [{ "id": "720", "label": "720p · 310 MB", "download": "/api/entries/e123/download?q=720" }]
}
```

- One progressive file: a `url` whose path ends in `.m3u8` is left out.
- `options` (10 at most) let the user pick first. Each `download` answers with
  another download description. A reply can have only `options`.
- A reply with no file and no option is refused.
- Every URL (the file, the subtitles, the image and each option) must be on the
  extension's origin. A URL on another origin is left out.
- The file request gets the manifest `headers`, and the Jellyfin token headers
  only when the user allowed `jellyfinToken`. It never gets the header that the
  app sends to Jellyfin for its own downloads. Use `Range` support on the file
  if you can: a paused or stopped download then continues where it stopped.
- `bytes` is the size the app shows before the transfer starts; the real size
  comes from the response.

**Preparing.** A server that makes the file first (for example with a
converter) can tell the app to ask again later instead of making it wait. The
app sends every download description request with `Prefer: respond-async`
(RFC 7240). When the file is not ready and the request has that header, answer
`202 Accepted` with:

```json
{ "preparing": { "progress": 0.42, "retryAfter": 5 } }
```

- `progress` (optional) is 0 to 1. The Downloads tab shows "Preparing on the
  server…" with the percent when it is known.
- `retryAfter` (optional, default 5) is the seconds until the app asks again.
  The app keeps it between 2 and 60 s, and asks at most every 5 s.
- Answer quickly (in a few seconds): the request has the 8 s time limit of
  feeds. Keep making the file while the app waits.
- The app gives up after 30 minutes of preparing ("The server took too long to
  prepare this file"). A pause or a cancel stops the asks; a resume or a
  restart of the app asks again.
- A failed job is an error status with `{ "error": "…" }` (for example 502).
  The download then fails with that text.
- Without the header (an older app), keep the old behaviour, and answer within
  about 5 s.
- The option list (`GET media.download` with options) can answer "preparing"
  too; the app then downloads with no choice.
- On the web and in the Mac app, allow `Prefer` in CORS. When a browser refuses
  the request, the app asks once more without the header.

**Downloads: how it works.**

- The app asks `media.download` when the user taps Download. When the reply has
  `options` and no `url`, the app shows the options and asks
  the chosen option's `download` for the file.
- The app asks the description again each time a transfer starts (a resume
  after a restart, Retry). A file URL can therefore expire: when the transfer
  answers 401, 403, 404 or 410, the app asks the description once more (a
  "preparing" reply then waits as above) and
  continues from the saved bytes when the server allows ranges, else it starts
  again. Keep the chosen option's `download` valid.
- After the file, the app saves each subtitle (`subtitle-<n>.vtt`) and the
  image next to it, with the same headers. When the entry has
  `media.playback`, the app also reads the stream description once to learn
  `report.path`, so play with no connection can report.
- The download needs the `downloads` permission and its switch. With the switch
  off, the app says "Downloads are off for this extension". The web app in a
  browser and TV have no downloads; they say so. iPhone, iPad, Android phones
  and the Mac app download.

**What the user sees.**

- The Downloads tab has a section per extension (the extension's name), below
  the server sections. A row shows the title, the line under it, the quality
  label and the size. Tap plays the file; swipe left deletes it. Downloads in
  progress show with the others, with pause, resume, retry and cancel.
- A download belongs to the Jellyfin account that made it. Another account on
  the same device does not see it; its file stays on the device until that
  account signs in again. Removing the extension asks whether to delete its
  downloads too. Downloads that the user keeps stay in the Downloads tab and
  still play.
- A downloaded entry plays from the device, also with a connection, with its
  saved subtitles, title and image. The position is kept on the device, so the
  next play resumes there. Reports carry `"offline": true`. A `stop` or
  `finished` report that cannot go waits on the device (100 per account at
  most, 30 days at most) and is sent, oldest first, when the extension answers
  again. Other reports from offline play are not kept.
- Quality choices, `next`, segments and chapters come only from a stream
  description, so a downloaded entry plays without them.

## Try it

1. Start the sample server on a computer (Node 18 or later, no packages):
   `node examples/extensions/hello/server.mjs`.
2. In the app (web build on the same computer), Settings → Extensions → **Add
   an extension**, enter `http://localhost:8787/pages/zoggyfin-extension.json`
   and tap **Add**.
3. Open the "Hello Pages" page: scroll the row, the list and the grid, search
   for "clip 12", open "Sample clip 3", press Save, play it, pick another
   quality and the English subtitles, and let the intro and credits segments
   show their Skip button and toast.
4. On a phone or the Mac app, download an entry and pick one of the two
   choices; the server's console shows each progress report.

On a phone, start the server with `BASE_URL=http://<your computer's LAN
address>:8787` and add that address. The section below lists what the
samples contain.

## Sample: Hello

`examples/extensions/hello/` has a static manifest, a panel page and a small fake
endpoint (Node 18 or later, no packages):

```sh
node examples/extensions/hello/server.mjs
```

Then add `http://localhost:8787` in Settings → Extensions. Hello adds:

- "Say hello" on movies, episodes, videos and music: a choice list from the
  server, a confirm, a toast and a task that counts for 10 s.
- A "Hello cards" Home row with a progress card, a panel card and a link card.
- "Send to Hello" for any shared link.
- A "Hello" panel with buttons for the bridge methods.

A second sample, Hello Pages (schema version 2), runs on the same server. Add
`http://localhost:8787/pages/zoggyfin-extension.json` in Settings →
Extensions. It has one page, opened from its settings page ("Open Hello
Pages") or from the header of its "Latest samples" Home row:

- "Latest samples": a row of 12 entries, also on Home.
- "Up next": a list with progress bars that pages 5 entries at a time; its
  "See all" opens the full list.
- "All samples": a poster grid of 95 entries that pages 20 at a time through
  `next`.
- A search field: `/pages/search` matches titles and topics, 20 per page.
  The search is `global`, so its results also show in the Search tab under
  "From Hello Pages".
- Every entry plays the same 6 s test video, which the sample serves itself
  (`media/sample.mp4`, a test pattern with a tone, with byte ranges). The stream
  description is at `/pages/entries/<id>/play`. It has two `qualities` ("High"
  and "Low", the same file under two URLs), an English WebVTT subtitle file,
  two segments with the manifest's `skipLabels` (`intro`, default `ask`, and
  `credits`, default `auto`), two `chapters`, the following sample as `next`,
  and a `report` path; the server prints each report it gets.
- The download description at `/pages/entries/<id>/download` offers two
  `options`; each answers with one file and its subtitles.
- The page has `tab` and `library` in its `placement`: a tab on iPad, the web
  and the Mac app, a Library tile on phones, a side menu entry on TV.
- Both pages have Library tile art (`/pages/art/<page>.png`, a colour ramp
  that the server draws, so the repository holds no picture).
- A second page, "Hello Tabs" (a Library tile), has three tabs: "Clips" (a
  row and a grid), "Up next" (a list) and "My list" (a grid with its own
  search). Its flat `sections` are the fallback for app versions without
  tabs. "My list" is also a Home row (a Home id inside a tab).
- "My list" is empty until you sign in: its feed answers with a `message` and
  a "Sign in" `action` that opens the "Hello account" panel. The panel's
  Sign in keeps the state on the sample server, shows a toast and calls
  `openPage`; the page then shows the list. Sign out calls `refreshPage`.
- Every third entry opens an entry page (`/pages/entries/<id>`): Play or
  Resume, a Save button with state that the server keeps in memory until it
  stops (`POST /pages/entries/<id>/save` with `{ "on": {{action.next}} }`; any
  other value than `true` or `false` is refused), and a "Related" row.
- A long press on an entry opens its menu: Play, Play from the beginning (with
  progress), Open (with an entry page) and Download.
- Every third entry has a `detail` page; the others carry `media`.

`src/extensions/__tests__/hello-sample.test.ts` starts the server and reads
every endpoint through the app's parsers, so the sample stays valid.
