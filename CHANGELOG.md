# Changelog

All notable changes to Zoggyfin are in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The Mac app has its own version and its own notes in [desktop/CHANGELOG.md](desktop/CHANGELOG.md).
The version of the mobile and web app is in `app.json`.

## [Unreleased]

Zoggyfin is in early development. The list below follows the history of the repository, from the
first commit to today. All of it was built in the first weeks of the project.

### Added

- **Extensions, schema version 2.** An extension can add native pages (rows, grids and lists that
  load more as you scroll, with search), shown as a tab on iPad, the web and the Mac app, in the
  TV side menu, and on phones as a Library tile or, if you choose ("On this phone"), as a tab in
  place of Music, Downloads, Search or Library; the replaced tab stays one tap away. Entries open an entry page with Play, on/off
  buttons and related rows. The video player plays an extension's media with its headers (and the
  Jellyfin token only when you allow it), quality choices, subtitles, chapters, a next title and
  labelled skip segments (auto skip with Undo, a Skip button, or off, per label in Settings).
  Phones, tablets and the Mac app can save an extension's media for offline play. Installed
  extensions now belong to the Jellyfin account and sync between your devices through it. Each
  use (playback, downloads, the token) has its own switch. An older app version keeps its own
  downloads after a rollback.
- **Swipe a song to queue it.** Swipe a song row right to play it next, or left to add it to the
  queue, as in Music. It works in search, albums, artists, playlists and the Songs page. Playlist
  entries and downloads keep swipe left to remove, and add to the queue on a swipe right. A swipe
  on a song row no longer turns the Music page or goes back from an album. Search results now
  open the song's actions with a long press too. Catalog songs (" ☁") are fetched when they play,
  not when they go into the queue.
- **Item actions on tiles.** A long press on a tile in a Home row or a grid opens the item actions
  (play, mark as played, favourite, download and more). On the web and in the Mac app a right click
  does the same, and the browser's own image menu no longer shows. TV is unchanged.
- **Right click everywhere in the Mac app.** Episode rows, artist rows, the search top result,
  extension rows and download items also open their actions on a right click (and on a long press).
  The Mac app no longer shows the browser menu (save image, reload) anywhere; text fields and
  selected text keep cut, copy and paste.
- **A Home tab for music.** Music libraries open on a Home tab: recently played, mixes from your
  top artists and genres, recently added, your top songs, new releases, favourites, playlists,
  albums to rediscover and genres. The played rows moved there from Albums.
- **Catalog rows on music Home.** When the server has a plugin that offers a music catalog, music
  Home shows the rows it sends, such as trending songs and top albums. Other servers show no change.
- **Smoother TV navigation.** Focus moves on Android TV and Fire TV do no extra work: the focus
  mark runs on the UI thread, and the billboard and prefetch wait for 500 ms of rest. Home rows and
  sections mount as you reach them, the side menu slides over the page, screens change at once, and
  the player controls show with no fade. Focused captioned tiles light a caption strip. Fast D-pad
  repeat needs a new native build.
- **Search Live TV programmes.** Search in Live TV now has an "On now" section. It lists programmes
  whose title matches your words and that are on now or start within the hour. Tap one to watch its
  channel. Streams that share one guide show as one row with "+N streams". The app downloads the
  guide in the background, on Wi-Fi or Ethernet only on phones. The plain web has no programme
  results (the Mac app has them).
- **Share IPTV providers with other users.** A server admin opens a provider and chooses "Share
  with…": some users of the server, or everyone (also users added later). The users get the provider
  on all their devices, marked "Shared by" and the admin's name. They cannot change it, remove it or
  see its login, but they can add its channels to their favourites. When the admin stops sharing, it
  goes from their devices.
- **Full IPTV accounts.** When an Xtream stream does not start because every stream of the account is
  in use, the player says so: "This provider allows N streams at a time, and all are in use."
- **Live TV in your Jellyfin account.** IPTV providers (with their logins), their order, what Live TV
  opens on, favourite and recently watched channels and film positions sync through the Jellyfin user.
  A phone, a TV, the Mac app or the web that signs in as the same user gets them with no typing.
  Changes go to the account a few seconds later, or when the server answers again. Providers and
  favourites added on two devices all stay; a provider removed on one device goes from all of them.
  The provider logins are stored on the Jellyfin server, and its admins can read them.
- **Remote control.** "Play on…" in an item's menu starts the item on another Jellyfin app of the
  same account (a TV, a computer, a phone). "Control a device" in the profile menu opens the Remote
  screen: what the device plays, the position, play and pause, seek 10 or 30 seconds, next and
  previous, stop, volume and mute, where the device supports them. Not on TV.
- **Foundation.** An Expo SDK 58 project on `react-native-tvos`, the Jellyfin API layer, sign-in with
  a password or Quick Connect, the tab shell, Home, library grids, item pages, search and generated art
  for items with no picture.
- **Quick Connect approval.** Settings, Quick Connect takes the six-digit code that another device
  shows (a TV, a browser, another Jellyfin app) and signs that device in as this account.
- **Trailers.** Movie and show pages have a Trailer button. A trailer file on the server plays in the
  player; a trailer link from the metadata (YouTube) opens in the browser or the YouTube app.
- **Design system.** The Ember accent on graphite, a light and a dark theme, one icon set per platform
  and rules for Arabic text. See `docs/design`.
- **Video player.** Direct play or HLS from a device profile, a full-screen player with trickplay,
  chapters, audio and subtitle tracks, Skip Intro and Skip Credits, a next-episode countdown, Picture in
  Picture, AirPlay, lock-screen controls and a mini player.
- **Music player.** Background audio, a queue with drag to reorder, synced lyrics, Instant Mix, a
  long-form mode with a sleep timer for audiobooks, and the Music tab with Albums, Artists, Playlists,
  Songs and Genres.
- **Downloads.** A background download engine, a state machine with retry, the Downloads tab, offline
  mode with an outbox for playback progress, and playlists.
- **Servers and accounts.** Many servers, many users per server, several addresses per server with
  automatic choice, and an account switcher.
- **Server discovery.** The first screen finds Jellyfin servers on the local network.
- **Watch and listen together.** Nearby sessions with no internet and no server (Bonjour, a join code,
  drops and rejoin), and Jellyfin SyncPlay groups. Clock sync keeps devices within a few milliseconds.
  A session is a room: start it, then pick anything with the normal app, and it plays for everyone.
  A room bar shows on every screen while the session runs.
- **Invites.** An administrator adds a person and shares one link or QR code. The invite page on the
  website opens the app or the store.
- **Admin panel.** Dashboard, now playing, users, libraries, tasks, activity, devices, logs, restart
  and shut down. Each library has a "Watch for new files" switch (the server's real-time monitoring).
- **Extensions.** Install a JSON manifest from a server. Extensions add item actions, Home rows,
  shared-link targets and panels. No extension code runs in the app.
- **Mac app.** A Tauri 2 app with libmpv video, downloads, Now Playing and media keys, signed and
  notarized releases and automatic updates. See `desktop/CHANGELOG.md`.
- **Android.** The native module with decoders and Picture in Picture, ExoPlayer playback, the tab bar,
  seek in video downloads, nearby sessions over Wi-Fi and a hotspot, and the Google Play listing.
  Android is not released yet.
- **Website.** The landing page, the download page, the privacy policy, the support page and the invite
  page at zoggyfin.zog-tech.com, deployed to Cloudflare Pages.
- **Releases.** EAS build profiles, EAS Update for over-the-air updates and TestFlight builds.
- **Update ready card.** On iPhone, iPad, Android and TV the app checks for an over-the-air update
  after start, on return to the foreground (at most every 30 minutes) and from "Check for updates" in
  Settings. It downloads the update, then a small card says "An update is ready" with "Restart now" and
  "Later". The card waits while video or audio plays. A new TV app from the TV updater wins over it.
- **Stream info.** The player shows the resolution and bitrate that play under the title. The Playback
  sheet puts them next to the original file (with its HDR type and audio track), so a viewer can tell
  whether a higher quality would help, and says why the server converts the file.
- **Screen size.** A player menu with Fit, Fill (crop) and Stretch.
- **Motion.** Favourite and Played turn on at once on the item page, with a small pop and a light
  haptic. Download rings move smoothly between steps. A finished download's icon arrives with a small
  bounce. Item, library and genre pages fade their content in after a loading skeleton.
- **Live TV (IPTV).** Xtream and M3U providers per account (passwords in the secure store), channel
  lists cached in files, groups with Favourites and Recently watched, fast search, now and next from
  Xtream or an XMLTV guide, and playback in the video player with channel up and down and a channel
  list. A tab on the web and the Mac app, a Library row and a Settings entry on phones and tablets,
  and a side menu entry on TV.
- **Home discovery.** "Because you watched" rows from the server's movie recommendations, a "Short on
  time" row of unwatched movies of 100 minutes or less, and a genre of the day that changes at midnight.
- **Genres.** A Genres row on Home (movie and show genres, the largest first) opens a page with every
  movie and show of the genre. Search has genre chips: a genre keeps the search to its movies and
  shows, and with no words lists the genre, best rated first.
- **Voice search (Android).** A microphone button next to the search field opens the system speech
  screen and searches for what was said. On Google TV the remote's voice button opens Google's own
  search, not the app's.
- **Android TV updates.** The sideloaded Android TV app (Google TV, Fire TV) finds a new APK, downloads
  it, checks its SHA-256 and opens the system installer. The Play build (`tv-play`) has no self-update.
  The website has a download for TV. TV releases keep the version 0.1.0; the build number
  (versionCode) tells them apart.
- **TS bridge (iOS).** A native bridge that plays a progressive MPEG-TS stream (the `.ts` URLs of many
  IPTV lists, which AVPlayer cannot open) as a live HLS playlist from a local server, with Picture in
  Picture, AirPlay and the lock screen. Live TV uses it on iPhone and iPad. Needs a new native iOS build.
- **IPTV films and series.** Films and Series pages in Live TV for Xtream providers (and for the film
  and episode entries of M3U lists): categories, poster grids, title search, Favourites, Continue
  watching, film and series pages with seasons and episodes. Catalogues are cached in files per
  provider and load again when a day old. Films and episodes play seekable in the video player, with
  the resume position kept on the device (never sent to Jellyfin) and the next episode through the
  next-up card. MKV plays on Android and the Mac app; iOS tries the panel's HLS form and else says why.
- **IPTV audio and subtitles.** "Audio and subtitles" lists the tracks inside an IPTV film, episode or
  channel stream and switches them (channels show it when they have two audio tracks or subtitles).
  The choice is kept per film, series or channel, and a new title starts in the languages picked
  last. Browsers other than Safari cannot switch the tracks inside an MP4 or MKV file.
- **IPTV: All providers.** With two providers or more, Live TV has "All providers": Favourites,
  Recently watched and channel search of every provider in one list, each channel with a small label
  of its provider. Channel up and down in the player stay in that list. The provider switch is in the
  browse column on TV and wide windows and a chip row on phones; groups, films and series stay per
  provider. Favourites and recents keep a small copy of each channel (no stream address), so the
  merged lists need no channel list in memory; only a search loads every list.
- **IPTV providers.** Choose what Live TV opens on (the last one used, All providers or one
  provider) and the order of the providers. Two providers never share a name ("Playlist 2"). Removing
  a provider also removes its recent searches and the audio and subtitle choices of its titles.
- **Subtitle appearance.** Settings has a Subtitles section with a live preview: text size (Small to
  Extra large), text colour (white or yellow), background (none, outline and shadow, or a translucent
  box) and position (normal or raised). The sizes grow on TV. Subtitles from the server use them on
  every platform, and the Mac app passes them to libmpv. Subtitles inside a Live TV stream or an IPTV
  film follow them on the web; on iPhone, iPad and Android they use the caption settings of the device.

### Changed

- **Live TV placement.** On iPhone, iPad and Android, Live TV is now a tile in the Library grid with the
  server's libraries, not a row above them. Home has a Live TV row with your favourite channels and the
  channels you watched last; a tap plays the channel, and "All channels" opens Live TV. The row shows
  only when you have an IPTV provider (not on TV). On iOS, Live TV still shows only after you add a
  provider in Settings.
- **Compact tab pages.** The first page of each tab (Home, Library, Music, Live TV, Search, Downloads)
  has no large title any more: the tab bar already shows where you are, and the content starts at the
  top of the screen. A slim bar stays only where a page has buttons in it (the profile button on Home,
  the library picker on Music, the search field on iPhone and Android). Library and genre pages show
  their name in a normal-size title.
- **Live TV.** A new layout, made for the TV first: a browse column (Search, Favourites, Recently
  watched, All channels, the groups, Providers), the channel list with numbers, logos and what is on
  now, and on TV a panel with now and next for the focused channel. Search is one step away (the
  Search entry, a Search button, the field on phones); it opens the keyboard on TV, shows results as
  you type, finds channel numbers, and keeps recent searches. Favourites come first when there are
  some. The loading, empty and error states are new.
- **Live TV player on TV.** Up, Down and the channel keys step through the channels in a zap banner
  (number, logo, now and next with times and progress); the player tunes when you stop pressing, or
  at once with Select, and Back cancels. The controls show a card for the channel that plays, and
  the channel list previews the focused channel's programmes. "Search channels" in the channel list
  goes to the Live TV search.
- The invite flow, the nearby transport and the rendezvous crypto use one design on every platform:
  ChaCha20-Poly1305, with CryptoKit on Apple platforms.
- A saved server stays one entry when its address or its Id changes.

### Fixed

- **Downloads of a long video from an extension no longer fail with "did not answer in time".** An
  extension that makes the file first (for example one that converts a video) can now answer
  "preparing". The download waits in the Downloads tab with "Preparing on the server…" and its
  progress, asks again, and starts when the file is ready. The wait survives a restart; pause and
  cancel stop it; it gives up after 30 minutes. Extension authors: see "Preparing" in
  docs/extensions.md.
- **Video length on extension tiles.** Extension tiles and list lines (for example YouTube videos)
  now show the video's length ("12:34") at the bottom right of the picture, and screen readers say
  it. Live entries show no length.
- **Extension videos play to the end.** A YouTube video with a next title stopped about 20 s early:
  the Up Next card counted down from 30 s before the end (or from a SponsorBlock outro) and then
  started the next video. For extension media the card now shows in the last 10 s, its ring shows
  the time left in the video, and the next video starts only when the video ends. Cancel keeps
  the player at the end. Jellyfin episodes keep the countdown at the credits.
- **Invite links open in full from Messages.** iPhone Messages linked only `…/join`, because it stops a
  link before a long run of letters. The link now has a dot every 200 characters; the app and the
  /join page remove them. Old links still work.
- **Sheets fill the screen.** A sheet opened from a tab page (the profile menu, item actions) had a blank
  band at the bottom and cut its list short. It now uses the whole height and scrolls.
- **Seeking with the remote or a double tap no longer opens the full controls.** On Android TV
  and Fire TV with the controls hidden, a double Left or Right starts a seek run: each further press
  seeks 10 s at once, and rewind and fast forward do the same. On phones, tablets and touch screens,
  a double tap on a side does the same with taps. Only a bubble with the total (for example +30 s)
  and a thin progress line show, until the run ends.
- Late results no longer overwrite newer state. A slow step that ends after you moved on is now dropped:
  - A quick switch to a channel or film no longer stops it with an error.
  - A finished queue no longer stops the song you just started.
  - A late add to a playlist, or a late "Play on", no longer closes the sheet you opened next.
- Downloads: a pause and resume while a download prepares no longer starts it twice.
- Player: the "Next up" countdown waits while the video is paused.
- Live TV:
  - The guide no longer stays at "loading" after a refresh finds a new guide address.
  - A change made while your account syncs is now sent to your other devices.
  - A shared provider that fails to load says so.
- Watch together: when the host drops, a guest that closed its player no longer becomes the new host, so the
  other guests no longer wait for a host that never comes. SyncPlay stops loading when you leave the group.
- Servers: a new address is checked at once, and a failed server search on the first screen ends.
- Sign in: Cancel stops Quick Connect, also while the code loads.
- Admin: a refresh keeps your unsaved changes to a user. One action that ends no longer hides the spinners of the others.
- Extensions: Cancel stops a late install list. After a partial install, the screen shows what is left.
- One tap does one thing: a fast double tap no longer adds a provider twice or joins an invite twice.

- Live TV on TV: moving through the channel list no longer lags on slow TV sticks. A focus move re-renders only the
  details panel (after the focus rests), each row re-renders only when its own programme changes, and fewer rows stay mounted.
- Live TV: a channel that played and then stops (broken data from the provider, or the player stuck with no progress)
  starts again by itself, up to 3 times in 2 minutes, before the error shows.
- TV: the Films and Series pages use the single focus mark and stay inside the overscan-safe area.
  A focused track or episode row no longer runs to the edge of the screen.
- TV: Down on the last Home row no longer scrolls the rows out of view.
- Android: AV1 films with a Dolby Vision layer over HDR10, HLG or SDR play directly. Before, the server
  converted them to H.264, often slower than real time, and playback kept stopping to buffer.
- Android TV: Home, its rows and the item grids scroll once per press, in a 300 ms glide. Before,
  Android jumped to the focused row and the app's scroll then slid it again, so each press jumped and
  slid. Extra Down presses on the last Home row no longer cut the row off, and fast Up presses in a
  library grid no longer scroll up past the focus and then back down.
- Android TV: every other page that scrolls (item pages, Search, Settings, Live TV, the IPTV films and
  series, music lists, sign-in, menus and sheets) glides to the focused control the same way and stops
  at the end of its content. Before, Down at the end of an item page scrolled past it and cut the
  rows off.
- TV: Settings, and other pages with no preferred focus, take the focus when they open. Before, the
  focus stayed on the page they covered and the remote could not reach them.
- Android: a transcode that started mid-file (resume, a quality change) could stop with a playback
  error ("Top bit not zero"). ExoPlayer now gets MPEG-TS HLS segments.
- TV: Home in the side menu leaves Settings. A tab pressed again goes back to its first page.
- TV: Right in the open side menu gives the focus back to the content.
- TV: The Home billboard no longer cuts off the top and bottom of the backdrop.
- TV: In library grids the row with the focus scrolls to the middle. Before, it sat on the bottom
  edge with its title cut off, and Down on the last row scrolled into empty space.
- TV: No Picture in Picture button. Google TV refused it, so the button did nothing.
- TV: The focus stays on the page you see. Each page in a tab stack keeps its own focus. Settings
  and every other page take the focus when they open or come back. Back from a page no longer opens
  the side menu, and content that loads late takes a lost focus. Before, the focus could stay on the
  page under the open one, and the remote seemed to do nothing.
- Android and TV: Back closes a confirm dialog (for example "Clear cache?"). Before, only its buttons closed it.
- TV: Extension pages are not offered on TV. The remote cannot use them.
- TV: Skip Intro and Up Next take the focus while the player controls are hidden. Double Left/Right
  still seeks, and Up/Down still changes the Live TV channel. The error card buttons show a focus ring.
- TV: Left and Right on the Now Playing seek bar seek, also when held. Every Now Playing button, the
  mini player and every text field show a focus ring.
- TV: The queue and playlists have a Move button with a menu of moves. The queue menu also removes.
- TV: Track rows have a More button, so the track menu needs no long press.
- TV: An action toast (for example Undo) takes the focus and stays while it has it. Back closes it.
  It never takes the focus from a text field.
- TV: The music library picker shows above the Music tabs. The first focus goes to the first
  visible tile on Music and on library grids, not to a tile below the screen edge or the Sort chip.
- TV: The Live TV channel list uses its full width.
- TV: A focused row (Settings, sheets, Live TV, search) shows one fill and no ring. Before, it showed a
  ring and a fill at the same time. Tiles and buttons keep the ring and the focus scale.
- TV: Nothing is cut off on a TV that crops the edges of the picture (overscan, for example Fire TV).
  The side menu, the pages, the player controls, toasts and sheets stay inside 5 % of each edge.

## Mac app releases

| Version | Date | Notes |
|---|---|---|
| 0.1.2 | 2026-10-19 | The install window shows the Applications folder |
| 0.1.1 | 2026-10-19 | A solid update card, one Close button on errors, in-place updates with one Dock icon |
| 0.1.0 | 2026-10-19 | The first release of the Mac app |

[Unreleased]: https://github.com/zog-tech/zoggyfin/compare/v0.1.2...HEAD
