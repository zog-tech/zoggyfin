# Zoggyfin for Mac: changes

Each section is the notes of one release. `pnpm desktop:publish` puts the section of the
version into `latest.json` (the update card shows it) and into the GitHub release.
Write one short line per item.

## 0.1.14 (2026-11-09)

- Music: songs play the original file instead of a converted stream, so seeking and tapping a lyric line work and songs no longer restart
- Lyrics: the sung line fills word by word, right to left for Arabic, and the current line stays a third from the top
- Music: swipe a song row to play it next or add it to the queue
- Search: recent searches keep only what you used, and a longer search replaces its shorter start
- Downloads: a song that the server adds to the library on first play downloads under its library entry
- Fixes: many late or repeated results in Live TV, Servers, Admin, Playlists, Together and the player no longer undo a newer action

## 0.1.13 (2026-11-04)

- Live TV: search shows an "On now" section with programmes that match your words and run now or start within the hour

## 0.1.12 (2026-11-04)

- Live TV: add an IPTV provider (M3U or Xtream) in Settings, then watch channels, films and series in the Live TV tab
- Home: a Live TV row of favourite and recent channels
- Remote: "Play on…" starts an item on another Jellyfin device, and the Remote screen controls it
- Settings: subtitle size, colour, background and position, with a preview
- Settings: Quick Connect approves the code that a TV or browser shows
- Movie and show pages: a Trailer button
- Faster start: a smaller app bundle
- Fixes: the item page header after a scroll, Search results, the player title on narrow windows

## 0.1.11 (2026-10-30)

- Home: "Because you watched" rows, a "Short on time" row and a genre of the day
- Player: a Screen size menu with Fit, Fill and Stretch
- Player: the resolution and bitrate that play show under the title and in the Playback menu
- Favourite and Played turn on at once on an item page
- Download rings move smoothly, and pages fade in after loading

## 0.1.10 (2026-10-29)

- The display no longer dims or sleeps while a video plays
- Admin, Libraries: a "Watch for new files" switch, so new files appear without a scan

## 0.1.9 (2026-10-28)

- Delete a film, an episode or an album from the server (More, for users who may delete)
- A video you downloaded plays from the file, also when you open it from the server's pages
- A download that finishes while you watch takes over from the stream at the same place
- The player's error card says what failed, not only "Request failed"
- Hover and keyboard focus show on the round buttons only, not on their labels

## 0.1.8 (2026-10-20)

- Together: a guest that already played the film no longer pauses everyone when it joins
- Together: the video plays on after you leave the session or the host ends it, when it streams from your server
- Server sessions say why "Only I control" is not available there, and how to get it

## 0.1.7 (2026-10-20)

- Together: pause no longer plays again by itself half a second later
- Together: the play button and Space follow the group, so a fast tap does what the button shows
- A seek on the Mac is no longer lost (the video went back to the old place)
- Invites work for 7 days; the invite list shows when each one expires

## 0.1.6 (2026-10-20)

- Together: the nearby list shows what a room plays now, and when the host picks something
- No old video frame stays on screen when music starts after a video
- The profile button opens a menu with Together, Downloads, Extensions, Settings and more
- A server room shows no wrong number of people while someone joins or leaves

## 0.1.5 (2026-10-20)

- Together: start a session, then pick anything in the app, and it plays for everyone
- A Together bar shows who is in the session, and the Play buttons read "Play for everyone"

## 0.1.4 (2026-10-20)

- Watch together: a pause, a seek or a speed change no longer starts the group again
- Listen together: next, previous and a jump keep every device on the same track

## 0.1.3 (2026-10-20)

- Together: one hub to join or start a session, and a clear flow from the invite to the room
- Host controls: accept or decline each request, remove or block a guest, and lock the session
- Watch and listen together stay in sync with many guests, and use less upload and memory
- Downloads whose file is gone show again, with an offer to download them again

## 0.1.2 (2026-10-19)

- The install window now shows the Applications folder

## 0.1.1 (2026-10-19)

- The update card has a solid background, so the notes are easy to read over artwork
- An update error shows one Close button
- Updates install in place, and Zoggyfin restarts once with one Dock icon

## 0.1.0 (2026-10-19)

- The first release of Zoggyfin for Mac (Apple silicon, macOS 13 or later)
- Video plays with libmpv: direct play of MKV, HEVC, AV1, DTS, TrueHD, and ASS and PGS subtitles
- Downloads for offline playback, with pause and resume
- Now Playing and the media keys
- Automatic updates: the app shows new versions and installs them when you choose
