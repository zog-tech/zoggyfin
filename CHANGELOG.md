# Changelog

All notable changes to Zoggyfin are in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The Mac app has its own version and its own notes in [desktop/CHANGELOG.md](desktop/CHANGELOG.md).
The version of the mobile and web app is in `app.json`.

## [Unreleased]

Zoggyfin is in early development. The list below follows the history of the repository, from the
first commit to today. All of it was built in the first weeks of the project.

### Added

- **Autoplay similar music.** When 2 songs or fewer are left in the queue, similar songs from your
  library join it (the server's Instant Mix), so the music does not stop. They show in the queue
  under "Autoplay". On a server with the catalog plugin, autoplay also asks the plugin's radio
  (`/OnDemand/Radio`) when the library has nothing similar, so catalog songs can play next.
  The ∞ button in the queue, or Settings, Playback, turns it off. Autoplay is off
  for audiobooks and podcasts, with Repeat, and in a listen-together session.
- **Fade between songs.** Settings, Playback has "Fade between songs" (Off, or 2 to 12 seconds). The
  song fades out over its last seconds and the next one fades in. Two songs that follow each other
  on one album stay seamless. The two songs do not overlap: the music player plays one track at a
  time.
- **Lite mode for small devices.** Settings, Playback has Lite mode: Auto (on for Android devices
  with about 1 GB of memory, such as a Fire TV Stick), On or Off. In Lite mode Home plays no
  previews and a TV tab that you leave is closed, so the app uses about a third less memory.
  Lite mode also lets go of the Live TV channel lists 10 seconds after you leave Live TV, loads
  the Home backdrop at a lower density and clears the image memory on a page change.
  Images decode at 2 bytes a pixel, and the data of a closed page stays 5 minutes, not 7 days.
- **Sign in on a TV with your phone's camera.** Quick Connect on the sign-in page now shows a QR
  code next to the code. Scan it with the phone's camera: Zoggyfin opens Quick Connect with the
  code filled in, and you tap Approve. The page says so when the phone's account is on another
  server.
- **TV: play and pause in the side menu.** While music plays, the "Now playing" item in the open
  side menu has a play/pause button. Right from the cover reaches it; a second Right closes the menu.
- **Genre tiles show what the genre is.** A genre with no image now gets an icon from its name, for
  example a flame for Action, a smile for Comedy and a trophy for Sport, in place of the theatre
  masks on every tile. Music genres get guitars, a microphone or a note.
- **Choose the quality of each download.** Download on a film, an episode or a video now asks
  for the quality: Original or a smaller copy (1080p, 720p or 480p, only below the file's own
  height). Each choice shows the file size or an estimate, so you can pick a smaller copy when the
  original is too big. The "Download quality" setting is the choice that is ticked. Seasons, shows,
  collections and music keep using the setting. On iPhone, iPad, Android and the Mac app; the web
  and TV have no downloads.
- **Liked Songs and Downloaded in the music pager.** Liked Songs is the second tab, after Home: it
  lists your favourite songs, newest first, with Play and Shuffle for the whole list and the usual
  sort chips. A song you like in the player or the action sheet shows up there. Downloaded is the
  last tab: every song on the device from this server, newest download first, and it works with no
  connection. On iPhone, iPad, Android and the Mac app; the web and TV have no downloads, so the
  Downloaded tab says so.
- **TV: streaming-app item pages.** On Android TV a movie, show or episode page now opens like the
  big streaming apps: the backdrop fills the screen and fades into the page, with the logo, the
  facts (the age rating in its own badge), the overview and one row of buttons on the left. Play or
  Resume has the focus, so one press plays. The buttons light up white when focused.
- **TV: episodes on the show page.** A show's page lists its seasons as chips and the episodes of
  the chosen season in a row (the season of the next episode first). Select on an episode plays it;
  a long press opens its page. Before, it took a season page and an episode page to start one.
- **TV: Home opens on the featured title.** Play (or Resume) and More info sit under the
  billboard and Play has the focus, so one press plays what you were watching. Down goes into the
  rows; Up brings the featured title back.
- **TV: previews.** When the focus rests on a movie or an episode for a few seconds, a clip of it
  plays over the billboard art, from a point past its opening, and fades out after 40 seconds or
  as soon as the focus moves. It streams the original file (no work for the server). Settings,
  Playback, "Autoplay previews on Home" turns them off.
- **TV: instant tab switches.** A tab you visited before shows about 30 ms after Select (it was
  3.6 s): hidden tabs keep their views in a native container that only stops drawing them and
  blocks their focus (`ZoggyfinTvVisibility`), and the menu shows the tab before the router has
  switched. Pictures on a tab you come back to are all there (a detached tab came back with empty
  tiles until they had the focus). Needs the new build; an older build detaches hidden tabs.
- **Home: show music or not.** Settings, Home, "Show music on Home" leaves out Continue listening
  and the Recently added rows of music libraries. Music keeps its own tab.
- **TV: steadier vertical scrolling.** A preview pauses at once when the focus moves (its video
  made every frame of the glide cost twice as much), Home builds its lower rows ahead while you
  rest, and the side menu stops the preview while it is open.
- **TV: steadier held D-pad.** A held key steps about 5.5 times a second, so each step glides
  instead of the focus running ahead and the row catching up in jumps.
- **Search: no separate voice button.** The mic beside the search field is gone; the keyboard's
  own voice typing works in the field (on Android the field is no longer overwritten while the
  keyboard composes).
- **TV: a music player made for the remote.** The art on the left, the song on the right with a
  progress line, one row of large buttons (shuffle, previous, play or pause, next, repeat; Play has
  the focus) and three pills: Up next, Lyrics and Favourite, with the rest under More. The queue
  and the lyrics open in place of the art and are focus stops only then; Back closes them.
- **TV: music from any page.** While music plays, the side menu's first entry shows the cover and
  opens the player (one Left and Select). The floating mini player over the rows is gone on TV.
- **TV: album, artist and playlist pages** have the art on the left and one row of buttons beside
  the title, in place of the phone layout with full-width Play and Shuffle bars.
- **TV: rows no longer cut off at the top.** On Home a row fades as it slides up past the focused
  row, and pages of rows (Music, item pages) bring the focused row to the top, so no half row stays
  under the tab bar. Home starts the glide at once with the row positions it knows.
- **TV: Continue watching and Next up play at once.** Select on one of their tiles resumes it; a
  long press opens its page.
- **TV: smoother scrolling and streaming-app sizes.** Rows and grids use smaller tiles that sit
  closer together (about seven posters or four and a half wide tiles across), and the next row
  peeks in at the bottom instead of stopping at a hard line. Home tiles show only their art (and
  the progress bar); the billboard shows the title. On TV the page background is painted once
  instead of four times, and the billboard fades cover only the art they fade: on a Google TV
  Streamer the GPU time per frame fell from about 18 ms to 10 ms and janky frames from 24 % to 7 %.
  Rows away from the focus mount only the tiles on screen (the focused row gets its full window
  once the focus settles), tiles have no hairline on TV, and the billboard text fades with a plain
  opacity instead of a layout animation, so the page glides at 60 frames a second.
- **TV: smoother Home billboard.** The billboard text cross-fades when the focus rests on another
  tile, and its overview keeps its two lines while it loads, so the title no longer jumps. The age
  rating shows as a badge. The open side menu dims the page behind it.
- **Sound plays on (listen together).** In a nearby listen-together session, the host picks where
  the sound comes out: every device (as before) or one device, for example the phone on the car
  stereo. The other devices keep playing in sync with no sound, so a change is instant, and their
  controls still work. When the chosen device leaves, the sound goes to the host and everyone sees
  a note. Guests of an older version keep their sound. SyncPlay sessions do not have it.
- **Download state on more places.** The Download button of an album or a playlist counts its
  songs while it downloads ("3 of 12"). The top result in Search shows the download glyph. Song and
  episode rows tell a screen reader that an item is downloaded or downloading. On iPhone, iPad,
  Android and the Mac app only: the web and TV have no downloads.
- **Load the whole video ahead.** A new switch in Settings, Playback (on by default). When on, the
  player reads ahead to the end of the video while it plays, so a slow or unstable connection stalls
  less and seeks forward are fast. Each platform keeps a memory cap: about 160 to 200 MB on Android
  phones with 3 GB of memory or more (the player's own size on smaller devices and most TV sticks),
  120 MB in a browser, 1 GB in the Mac app; on iPhone and iPad the system sets the limit. Live
  streams, downloads and watch together keep the normal buffer. Nothing is saved after the player
  closes.
- **Extension results in Search.** An extension search with `global: true` also shows its results
  in the Search tab, as a row after the server's results, under its own title. Each extension
  loads on its own, so the server's results never wait. See `docs/extensions.md`.
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

- **The tab bar stays in place by default (iOS 26).** Scrolling a page no longer shrinks the tab
  bar and the mini player under it. Turn it back on in Settings, Tab bar, "Collapse on scroll".
- **One name for the heart in music.** Liked Songs, the player heart, the action sheet and the
  filter chip all say Like now; "favourites" stays for films and shows. The Favourites chip on
  the Songs tab is gone (Liked Songs is that list), and the music Home rows are Liked albums and
  Liked artists.
- **Extension updates apply by themselves.** A new page or a new Library tile or tab no longer waits
  for "Review the update": only a new permission asks. The app also checks for extension updates
  every 15 minutes and on each return to the app, not every 6 hours.

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

- **The video player turns smoothly.** When the phone turned during a video, the controls laid out
  again in several steps and jumped. The controls now go out while the screen turns and fade back in
  on the finished layout; the video turns with the screen.
- **A catalog song starts by itself once the server has it.** The first play of a song marked
  " ☁" makes the server fetch the file. The player now asks the server to fetch it first and then
  streams the saved song (with its real name and album), and it plays again when iOS leaves a
  ready track paused. Before, the song sometimes waited for a press on Play.
- **Smoother rotation.** Pages, the video player and the music player take the new window size in
  the same render as the new safe-area insets, so a rotation lays them out once instead of jumping
  twice. The Now Playing art no longer loads again at the new size and flashes blurred.
- **TV: a Home preview no longer plays only its sound.** A preview now plays only when the TV
  decodes the file's video as it is. A 4K or 10-bit HEVC file on a 1080p stick played its sound
  over the still art.
- **Android: the app no longer runs out of memory during playback on a 1 GB TV stick.** The video
  player kept up to about 141 MB of video ahead, more than the 128 MB that such a device gives an
  app, and a Fire TV Stick closed the app during playback and Home previews. In Lite mode the
  player now keeps at most 40 MB, and a Home preview always keeps at most 8 MB.
- **TV: Down at the end of a Live TV list stays there.** Down past the last channel (or the last
  entry of the column) moved the focus into the other list, so a held Down ran through the groups.
- **TV: a slimmer side menu.** The closed rail is narrower and nearer the screen's edge, with a line
  on its right side, so pages have more room. The Live TV column is wider, so its labels fit.
- **TV: a slimmer side menu and more room for pages.** The closed rail is narrower and nearer the
  screen's edge, with a line on its right side, and the page margin is smaller, so pages have more
  room. The Live TV column is wider, so its labels fit.
- **Live TV: the provider switch is in the header.** On TV and wide windows a provider button (with
  the provider's name) sits next to Search and opens the list of providers. The column starts with
  the lists, so the groups show on the first screen. Fast Up in the column no longer jumps to the
  header's Search button.
- **TV: the Resume button's bar has its own line.** The bar sat under the text and the button looked
  squeezed.
- **Live TV: a channel that stops starts again by itself.** When a provider cut the stream (for
  example, an IPTV account that allows one stream and another device took it), iOS showed a
  black, buffering player for good. Now a channel that waits for data for 15 s starts again. After
  3 restarts in 5 minutes the player stops and says why, for example "This provider allows 1
  stream at a time, and all are in use." A stream that reports its end also starts again.
- **Android and TV: the app no longer crashes while music plays.** A track change could crash the
  media session ("Invalid PlayerInfo update"). media3 is 1.11.1 now, and `expo-audio` and
  `expo-video` build from source on Android so the patched version is used. Needs a native build.
- **A liked song stays liked after the app restarts.** The saved queue kept each song's state from
  when playback started, so the heart showed a song liked in an earlier session as not liked. The
  players now read the server's current state, and the action sheet follows the heart.
- **TV: faster tab switches and first Music visit.** Hidden tabs no longer render all their tiles
  again on every switch (each tab stack names its own tab, `lib/own-tab.ts`), and the music Home
  page mounts its sections a few at a time.

- **iPhone downloads no longer start again from zero.** Each time the app started, it cancelled
  the downloads that ran, and they started again from the first byte, so a large film never
  finished. Downloads now go on through app starts. A download that fails over a weak connection
  also continues from where it stopped, in builds from 0.1.1 (22). This now also works for a
  download that ran through an app start: after a network change it went back to zero.
- **Films with Dolby audio that starts late.** Some 4K web releases have E-AC-3 audio that starts
  seconds after the video. The server's stream for them had an empty audio entry, and the iPhone
  stopped with "CoreMediaErrorDomain error -16172". After such a stream fails, the player now asks
  the server again with AAC audio, at the same place.
- **Songs in A to Z order.** The Songs and Liked Songs tabs sorted by Jellyfin's sort name, which
  starts with the disc and track number, so the list went through every first track, then every
  second track, and a song looked missing from its place in the alphabet. They now sort by the
  song title. A sort by album still keeps the track order.
- **Music player heart after reopening.** The heart showed the song's state from when it started
  playing, so after a like or an unlike, closing and opening the player showed the old state and the
  next tap undid the change. It now follows likes made in the player and in the item menu.
- **Music has sound again after an interruption on iPhone.** When the camera or another app stopped
  the music and never said it was done, a later play showed "playing" with no sound. The app now
  activates the audio session again before that play, also a play from the lock screen.
- **Next and previous on the lock screen always work on iPhone.** They now move the app's queue
  like the buttons in the app. Before, they did nothing for a song that was not preloaded (a
  catalog song) and for "previous" on the first song after a fresh start. Needs a new native build.

- **One filter row in Search.** The genre chips and the type chips (All, Movies, Shows, ...) were two
  rows. Now there is one row: the type chips, then a "Genre" chip at the end that opens a list. A
  chosen genre shows its name with a Clear chip beside it.

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
