# Extensions

An extension adds features for your own setup without a change to the app. For
example, a self-hosted downloader can add a "Download" target for shared links,
buttons on items, Home rows and a page.

An extension is **data only**. The app reads a JSON manifest from your server and
draws the contributions. No code from an extension runs in the app (App Store
guideline 2.5.2): there is no `eval`, and the app downloads no scripts. A panel is
a normal web page in a WebView or an iframe. It can only use the six bridge
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
update, or remove it on its page in Settings → Extensions. An update that asks
for a new permission shows the confirm screen again.

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
keeps its `true`/`false` type.

| Scope | Keys |
| --- | --- |
| `item` | `id`, `name`, `type`, `mediaType`, `libraryName`, `serverId`, `path` (only with `itemPath`) |
| `input` | the keys of the action's `inputs` |
| `settings` | the keys of `contributes.settings` |
| `share` | `url` |
| `jellyfin` | `serverUrl`, `serverId`, `userId`, `userName`, `isAdmin` |

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
| `refreshLibrary` | – | Loads the app's data again. |
| `toast` | `{ text }` | Shows a toast. |
| `close` | – | Closes the panel. |

The app answers only messages from the extension's origin, and sends answers
only to that origin.

### CORS

Web and the Mac app send requests from a browser, so the extension must allow
CORS for the app's origins: the web address of your Zoggyfin, `tauri://localhost`
and `http://tauri.localhost` (the Mac app), and `http://localhost:<port>` for
development. Allow the headers `Content-Type`, `Authorization`, `X-Emby-Token`,
`X-Jellyfin-Server-Url`, `X-Jellyfin-Server-Id` and `X-Jellyfin-User-Id`. The
iPhone, iPad and Android apps send no `Origin`.

A panel must allow framing by those origins (no `X-Frame-Options: DENY`, and no
`frame-ancestors` that leaves them out).

### Time limits

Actions have 15 s. Feeds, choice lists and task polls have 8 s. A slow or broken
extension shows an error toast or a small note; it never blocks a screen.

## Schema version 2

Version 2 adds native pages, playable media, downloads and skip labels. It
keeps every version 1 field and contribution except `homeSections`: a Home row
is now a page section named in `placement.home`.

**The app reads these; screens that use them arrive in later releases.** Today
the app checks a version 2 manifest, installs it and shows the sections in
`placement.home` as Home rows, the same as version 1 rows. Pages, tabs,
Library tiles, search, the entry detail page, playback, downloads and skip
settings follow.

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
| `permissions` | Adds `playback` (the app plays streams from the origin and sends progress) and `downloads` (the app saves files from the origin on the device). Both show on the confirm screen. A version 1 manifest cannot ask for them. |
| `pages` | At most 5. `id`, `title`, an optional `icon` (an icon name of the app), `placement`, an optional `search`, and 1 to 8 `sections`. |
| `placement` | `tab`: the page may show as a tab. `library`: a tile in the Library grid. `home`: ids of sections of this page that also show as Home rows, in that order. All are off by default. |
| `search` | `feed` gets `query` and `cursor`, and answers with a feed page. `placeholder` is optional. |
| `sections` | `id`, `title`, `feed`, `layout` (`row`, the default, `grid` or `list`), `shape` (`poster`, `thumb`, the default, or `square`), `refreshSeconds` (5 to 3600). `grid` and `list` load the next page near the end. |
| `skipLabels` | At most 10. `id`, `title`, `default`: `auto` (skip, with Undo), `ask` (the default; a Skip button) or `off`. |

Ids are unique in each list: pages, the sections of one page, the Home ids of
one page, and skip labels. A Home id must name a section of its page.

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
  else `link`.

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

On a phone, start the server with `BASE_URL=http://<your computer's LAN
address>:8787` and add that address.
