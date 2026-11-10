# Extensions v2: device checks

These checks cover what the unit tests cannot: real players, real downloaders,
focus on TV and two real devices. Do them in this order. Mark each line when it
passes. Write the device, the build and the result next to a line that fails.

## Before you start

1. Start the sample on a computer on the same network:
   `BASE_URL=http://<computer address>:8787 node examples/extensions/hello/server.mjs`.
   Keep the console open: it prints each progress report.
2. Use a header capture on the computer for the header checks, for example
   `tcpdump -A -i any port 8787` or a logging proxy. Expected: you can see the
   request headers of each request to port 8787.
3. To check headers, give the sample a header: in a copy of
   `pages-extension.json`, add `"headers": { "X-Sample-Key": "{{settings.key}}" }`
   and a text setting `key`. Set the key to `abc` in the app. Turn on the
   Jellyfin token switch for one run.
4. Have two Jellyfin accounts (A and B) on the same test server, and two
   devices that can sign in as A.
5. Install an older build of the app (the one before extensions v2) with one
   v1 extension installed and one Jellyfin download, for the upgrade checks.

## 1. All platforms (do on each one)

- [ ] Add `http://<computer address>:8787/pages/zoggyfin-extension.json`. Expected: the confirm screen lists Network, Playback and Downloads, each with a switch.
- [ ] Open the "Hello Pages" page. Expected: a row, a list and a grid; art is generated (no pictures).
- [ ] Scroll the grid to the end (95 entries). Expected: it loads 20 at a time, with no repeated or missing entries.
- [ ] Type "clip 12" in the search field. Expected: matching entries; clear the field and the sections come back.
- [ ] Leave the page open for 3 minutes. Expected: the console shows at most one `/pages/latest` request per 60 s (`refreshSeconds`), not a flood.
- [ ] Open "Sample clip 3" (every third entry has a page). Expected: a skeleton first, then title, Play, Save, Download and a "Related" row.
- [ ] Press Save five times quickly. Expected: the button ends in the state of the last press; the console shows no error.
- [ ] Stop the server, press Save. Expected: the button goes back to its old state and an error toast shows. Start the server again.
- [ ] Stop the server and open another entry page. Expected: an error with "Try again". Start the server, press "Try again". Expected: the page loads.
- [ ] Open an entry whose `detail` URL is on another origin (edit a reply to `http://example.invalid/x`). Expected: no request leaves for that host; the page says it cannot open it.
- [ ] Play "Sample clip 3". Expected: the test pattern plays, with sound. The console shows `start`, then `progress` every 10 s.
- [ ] Check the captured request of the stream file. Expected: `X-Sample-Key: abc`; with the token switch on, also `X-Emby-Token` and `Authorization`. No token in any URL.
- [ ] Turn the token switch off and play again. Expected: the stream request has `X-Sample-Key` but no token headers.
- [ ] Play a Jellyfin movie after the extension title. Expected: the Jellyfin stream request has no `X-Sample-Key` header (old headers do not stay).
- [ ] At 2 s, pick quality "Low". Expected: the stream reloads at the same position and the same speed (set 1.5x first). The next report has `"quality": "low"`.
- [ ] Pick "English" subtitles. Expected: three lines show at 0 s, 2 s and 4.5 s. The capture shows the `.vtt` request to port 8787, never to the Jellyfin server.
- [ ] At the start, the intro segment (0 to 1.5 s, "ask"). Expected: a "Skip Intro" button.
- [ ] At 4.5 s, the credits segment ("auto"). Expected: the player skips and a toast with Undo shows. Press Undo. Expected: the player goes back to 4.5 s.
- [ ] In Settings → Extensions → Hello Pages → Skip, set Credits to Off. Expected: the next play does not skip or show a button at 4.5 s.
- [ ] Open the chapter list. Expected: "Opening" and "Middle".
- [ ] Let the video end. Expected: the next-up card shows "Sample clip 4" and it plays next; the console shows `finished` for s3.
- [ ] Long press an entry. Expected: Play, Play from the beginning (if it has progress), Open (if it has a page) and Download (where the device saves files).
- [ ] Start a watch-together session. Tap an entry, press Play on an entry page, use the long press Play, and press "Play" in the Hello panel. Expected: each time the toast "Extension media does not play in a watch-together session"; nothing plays.
- [ ] Open the Hello panel (v1 sample) and use `playMedia`, `openEntry` and `openPage`. Expected: each plays or opens the right screen; a playback URL on another origin is refused.
- [ ] Turn the Playback switch off and tap an entry. Expected: the toast says playback is off; nothing plays.

## 2. iPhone

- [ ] Play an entry, lock the phone. Expected: the lock screen shows the title and "Hello Pages", play and pause work, audio continues in the background.
- [ ] Start picture in picture and go to the Home screen. Expected: the video goes on in the window.
- [ ] Close the full player. Expected: the mini player shows the extension title and plays on.
- [ ] Check headers on AVPlayer (stream and byte-range requests). Expected: the sample header on every request to port 8787.
- [ ] Play an IPTV film and a series episode. Expected: they play, seek, resume where they stopped, and autoplay the next episode.
- [ ] Play a live extension stream (change one reply to `"live": true` and an HLS URL). Expected: no seek bar, no resume point, no progress in the report duration.
- [ ] Rotate to landscape on the page and the entry page. Expected: the layout fits; no cut-off rows.
- [ ] Pull to refresh on the page. Expected: the app spinner shows under the status bar and the sections reload once.
- [ ] Library tab. Expected: a "Hello Pages" tile; no sixth tab.
- [ ] Download an entry and pick "Low". Expected: a row in the Downloads tab under "Hello Pages" with the label and size.
- [ ] Start a download, send the app to the background for 1 minute. Expected: the download completes in the background.
- [ ] Start a download, kill the app from the app switcher, open it again. Expected: the download continues from its bytes (a Range request in the console).
- [ ] Pause a download, restart the server with a changed file URL (an expired URL gives 410), resume. Expected: the app asks the download description again once and completes.
- [ ] Turn on airplane mode, play the downloaded entry. Expected: it plays with its subtitles and image, and resumes where you stopped last time.
- [ ] Stop playback in airplane mode, then turn airplane mode off. Expected: the console shows the `stop` report with `"offline": true` once the app reaches the server.
- [ ] Settings → Extensions → Hello Pages → Remove. Expected: the app asks whether to delete its downloads too; both choices do what they say.

## 3. iPad

- [ ] Regular width (full screen). Expected: "Hello Pages" shows as a tab in the tab bar or sidebar, with the page icon and title.
- [ ] Split view at compact width. Expected: the tab stays reachable; the layout has no overlap.
- [ ] Turn the extension off and on. Expected: the tab goes and comes back; the tab navigator remounts with no crash and no blank screen.
- [ ] Install a second copy of the page sample (another id) with `tab: true`. Expected: one tab only. In Settings → Extensions choose "Show as tab" for the second. Expected: the tab changes.
- [ ] On a second device as the same account, after a pull. Expected: the same page is the tab ("Show as tab" synced).
- [ ] Page with the grid at iPad width. Expected: more columns than on the phone; long grids (2000 entries, change the sample count) scroll smoothly.

## 4. Android phone

- [ ] Start the app with the sample installed (with `tab: true`). Expected: no crash, no sixth tab, the Library tile shows.
- [ ] Check headers on ExoPlayer. Expected: the sample header on each stream request; none on a Jellyfin stream played after.
- [ ] Quality switch at 2 s at 1.5x. Expected: same position and speed.
- [ ] Picture in picture, background audio, the media notification and the mini player with extension media. Expected: as on iPhone.
- [ ] Download an entry. Expected: the Android download notification shows progress and completion.
- [ ] Kill the app during a download and open it again. Expected: the download continues.
- [ ] Play the download in airplane mode. Expected: it plays with subtitles, image and the saved position.

## 5. Android TV

- [ ] Open the side menu. Expected: at most two extension entries, before Settings; the D-pad reaches them.
- [ ] Select "Hello Pages". Expected: the first focus is on the first entry of the first row.
- [ ] Move to "See all" of the list and press Select. Expected: the full list opens. Press Back. Expected: focus returns to "See all".
- [ ] In the grid, move up from the first grid row into a shelf inside a grid header and back. Expected: focus moves and never gets lost.
- [ ] Move from the search field down to the sections. Expected: focus reaches the first section.
- [ ] Open an entry page. Expected: focus on Play; down goes to the actions, then to the sections.
- [ ] Long press Select on an entry. Expected: the entry menu opens with focus on its first row.
- [ ] Play to 4.5 s (credits, auto). Expected: the skip toast takes focus; Select undoes the skip.
- [ ] Press Back from the page. Expected: the side menu opens with the selected mark on "Hello Pages".
- [ ] Download. Expected: no Download row (TV has no downloads), or a message that says so.
- [ ] Play an IPTV film and series. Expected: play, seek, resume and next episode work.

## 6. Web build

- [ ] Open the app in Chrome on plain `http://`. Expected: "Hello Pages" shows as a tab or sidebar item.
- [ ] Play an HLS stream with headers (change a reply to an `.m3u8` URL on the sample origin, with segments on another origin). Expected: hls.js plays; the header goes on the playlist and the same-origin segments; the other-origin segments have no header.
- [ ] Play an HLS stream in Safari with headers. Expected: hls.js plays it (Safari native HLS cannot send headers).
- [ ] Quality switch and subtitles. Expected: as in section 1.
- [ ] Look for Download on an entry page and in the long press menu. Expected: none (the plain web build saves no files).
- [ ] Two browser contexts as the same account: add the sample in one. Expected: the other shows "From your account" once; "Not now" does not come back.
- [ ] Remove the sample in one context. Expected: it goes from the other after a pull.

## 7. Mac app

- [ ] Start the Mac app. Expected: "Hello Pages" in the sidebar.
- [ ] Play an entry. Expected: mpv sends the sample header on each stream request; a Jellyfin title after it has none.
- [ ] In a debug build, play with the token switch on. Expected: the dev console shows `[mpv] set http-header-fields = <redacted>`, never the token.
- [ ] Quality switch at 2 s at 1.5x. Expected: same position and speed.
- [ ] Download an entry. Expected: the Mac downloader sends the sample header (capture), and the file plays offline.
- [ ] Remove the extension. Expected: the app asks about its downloads.

## 8. Accounts and sync (two devices, two accounts)

- [ ] Upgrade the older build (see "Before you start") to this build. Expected: the v1 extension is still installed on each saved account, and the Jellyfin download still plays.
- [ ] On device 1 as A, add the sample and turn the token switch off. On device 2 as A, pull (open Settings → Extensions). Expected: the "From your account" confirm screen once; the token switch is off there too after the pull.
- [ ] Turn the Downloads switch off on the confirm screen of device 2, add. Expected: after the next pull it is still off on device 2.
- [ ] Remove the sample on device 1. Expected: it goes from device 2 with no question.
- [ ] On one device, sign in as A and as B. Install the sample on A only. Switch to B. Expected: no "Hello Pages" tab, tile, Home row or side menu entry.
- [ ] As A, download an entry. Switch to B. Expected: the Downloads tab of B does not show it. Download the same entry as B. Expected: the message that another account saved it.
- [ ] As A, start a Hello v1 task ("Say hello"), switch to B before it ends. Expected: the task leaves the list; back on A, it resumes.
- [ ] As A, set the secret key `abc`; as B (same extension), set `xyz`. Expected: A's requests carry `abc`, B's carry `xyz`.
- [ ] As A, play offline (airplane mode) and stop; switch to B; go online. Expected: no report of A's play is sent while B is signed in; it is sent after A signs in again.

## 9. Rollback

- [ ] With this build, make one Jellyfin download and one extension download. Install the older build over it (or publish the older update). Expected: the Jellyfin download is listed and plays. The extension download is gone (accepted).
- [ ] Install this build again. Expected: the Jellyfin download is still there; the extension download is listed as missing and offers "Download again".
