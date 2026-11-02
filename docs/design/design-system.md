# Zoggyfin design system

Status: v1, 2026-10-19. Token file: `docs/design/theme.ts` (copy to `src/theme/`).
Brand: `docs/design/brand.md`. Mockups: `docs/design/mockups.html`.

Units are points (pt), the same as React Native layout units. All values here match `theme.ts`.
If the two files disagree, `theme.ts` is correct and this file needs an update.

## 0. Principles

1. **Artwork is the hero.** Chrome is neutral graphite and glass. The only brand colour is Ember. Art supplies the rest.
2. **Native first.** Use the native tab bar, native context menus, native sheets and compact native headers (tab root pages have no title: the tab bar names them). Build custom UI only where iOS has no control: tiles, the pager strip and player overlays.
3. **Nothing is blank.** Every tile has a picture. Every list has a loading state, an empty state and an error state.
4. **Motion follows the finger.** Gestures drive the UI on the UI thread. Animations can be interrupted and they keep velocity. Nothing animates for decoration.
5. **Calm density.** Few weights, one accent, generous gaps between sections, tight gaps inside a group.

Anti-goals from the product spec are hard rules here: no decorative carousels, no hidden downloads, no unresponsive sub-tabs, no blank tiles, no glitchy players.

---

## 1. Colour

### 1.1 Semantic tokens

Use tokens only. Do not put a raw hex value in a screen.

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `#0B0B0E` | `#FFFFFF` | Page canvas |
| `bgGrouped` | `#0B0B0E` | `#F2F2F5` | Settings, Downloads, sheets |
| `surface` | `#16161A` | `#FFFFFF` | Cards, grouped rows, tile placeholder |
| `surface2` | `#202026` | `#EBEBEF` | Raised: menus, icon buttons, chips, skeleton base |
| `surface3` | `#2A2A31` | `#E2E2E7` | Pressed fill, selected chip, skeleton highlight |
| `text` | `#F5F5F7` | `#111114` | Primary text and icons |
| `text2` | `#A8A8B3` | `#595963` | Secondary text, metadata |
| `text3` | `#96969F` | `#63636C` | Tertiary text: counts, timestamps, placeholder |
| `textOnMedia` | `#FFFFFF` | `#FFFFFF` | Text on artwork scrims and on video |
| `accent` | `#FF7A59` | `#B53A17` | Primary button, progress, selected tab, links |
| `accentPressed` | `#E8684A` | `#9C3113` | Accent while pressed |
| `onAccent` | `#1A0B06` | `#FFFFFF` | Text on an accent fill |
| `accentSoft` | Ember 16 % | Ember deep 10 % | Selected row, selected tab capsule |
| `success` | `#3DD68C` | `#12703F` | Downloaded, completed |
| `warning` | `#F2B54B` | `#855300` | Low space, metered network |
| `danger` | `#FF6B6B` | `#BE2329` | Failed, delete |
| `separator` | white 9 % | ink 12 % | Hairlines (decorative) |
| `controlBorder` | `#71717C` | `#7E7E88` | Borders that carry meaning |
| `focusRing` | `#FF7A59` | `#B53A17` | Keyboard focus |
| `scrim` | black 56 % | black 40 % | Behind modals |
| `artScrimBottom` | black 72 % | black 68 % | Gradient under text on artwork |

Dark mode on the accent: the button text is dark (`onAccent` `#1A0B06`) because white on `#FF7A59` is only 2.6:1. Do not put white text on the dark-mode accent.

### 1.2 Contrast check (WCAG 2.2 AA)

Calculated with the WCAG relative-luminance formula. AA needs 4.5:1 for text and 3:1 for meaningful non-text UI.

**Dark**

| Foreground | on `bg` | on `surface` | on `surface2` | on `surface3` |
|---|---|---|---|---|
| `text` | 18.05 | 16.57 | 14.88 | 13.08 |
| `text2` | 8.35 | 7.66 | 6.88 | 6.05 |
| `text3` | 6.70 | 6.15 | 5.52 | 4.86 |
| `accent` | 7.66 | 7.03 | 6.31 | 5.55 |
| `success` | 10.48 | 9.62 | 8.64 | 7.60 |
| `warning` | 10.75 | 9.87 | 8.86 | 7.79 |
| `danger` | 7.08 | 6.50 | 5.84 | 5.13 |
| `controlBorder` (3:1) | 4.08 | 3.74 | 3.36 | 2.95 — do not use |
| `onAccent` on `accent` | 7.47 | | | |

**Light**

| Foreground | on `bg` | on `bgGrouped` | on `surface2` | on `surface3` |
|---|---|---|---|---|
| `text` | 18.85 | 16.87 | 15.85 | 14.60 |
| `text2` | 6.92 | 6.19 | 5.82 | 5.36 |
| `text3` | 5.95 | 5.32 | 5.00 | 4.61 |
| `accent` | 5.86 | 5.25 | 4.93 | 4.54 |
| `success` | 6.15 | 5.50 | 5.17 | 4.76 |
| `warning` | 6.49 | 5.81 | 5.46 | 5.03 |
| `danger` | 6.07 | 5.43 | 5.10 | 4.70 |
| `controlBorder` (3:1) | 4.02 | 3.60 | 3.38 | 3.11 |
| `onAccent` on `accent` | 5.86 | | | |

**Text on artwork.** Put text on artwork only over the bottom scrim (`artScrimTop` → `artScrimBottom`, over the lower 60 % of the tile). The worst case is white artwork under the scrim: white text on 72 % black over white is 9.3:1. The generated-art gradient gives at least 5.19:1 for white text with no scrim (§7.5).

**Colour is never the only signal.** The playing track has the equalizer icon and the accent colour. A failed download has an icon, a red label and the word "Failed".

### 1.3 Theme selection

- Default: follow the system (`useColorScheme()`). Settings → Appearance: System / Dark / Light.
- The full players are always dark (video black, music on blurred artwork), whatever the theme.
- The light theme is a complete theme, not an inverted copy. Light mode uses `bgGrouped` for grouped screens and white cards on it.

---

## 2. Spacing, layout and breakpoints

### 2.1 Spacing scale (4-pt grid)

`xxs 2 · xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32 · huge 48`. Section gap on Home: `section` = 28.

| Use | Value |
|---|---|
| Tile to its title | 6 |
| Title to metadata | 2 |
| Tiles in a row or a grid | `tileGap` (12 / 16 / 16 / 20) |
| Section header to row | 10 |
| Row to next section header | 28 |
| Page gutter | `gutter` (16 / 24 / 32 / 40) |
| List row padding | 14 horizontal, min height 44 (text) / 60 (with art) / 72 (media) |

### 2.2 Breakpoints

Read the width from `useWindowDimensions()`. Never test the device model. Split View, Slide Over, Stage Manager and Mac windows all change the width.

| Name | Width | Typical window | Navigation |
|---|---|---|---|
| `compact` | < 600 | iPhone, iPad Slide Over, narrow Split View | Tab bar |
| `medium` | 600–899 | iPad portrait, half Split View | Tab bar (iPadOS top tab bar) or sidebar if the user opens it |
| `expanded` | 900–1279 | iPad landscape, Mac window | Sidebar |
| `wide` | ≥ 1280 | Mac full screen, desktop web | Sidebar |

When the sidebar is visible, calculate grids from the **content width** (window width minus 280), not the window width.

### 2.3 Grids

Use `gridFor(kind, contentWidth)` from `theme.ts`:
`columns = clamp(floor((W − 2·gutter + gap) / (minTile + gap)), min, max)`, then
`tileWidth = floor((W − 2·gutter − gap·(columns − 1)) / columns)`.

Results for poster (2:3) grids:

| Window | Content width | Columns | Tile width |
|---|---|---|---|
| iPhone 16 / 17 | 393 | 3 | 112 |
| iPhone Pro Max | 440 | 3 | 128 |
| iPad portrait (11") | 820 | 5 | 141 |
| iPad landscape (11") with sidebar | 900 | 5 | 154 |
| iPad landscape, sidebar hidden | 1180 | 7 | 145 |
| Mac 1512 with sidebar | 1232 | 7 | 153 |
| Desktop web 1920 with sidebar | 1640 | 9 | 155 |

Square (album) grids: 2 columns on iPhone, 4–6 on iPad, 6–7 on wide. Thumb (16:9) grids: 1 column on iPhone, 2–3 on iPad, 4 on wide.

Use FlashList 2 with `numColumns` from `gridFor`. Change `key` when `columns` changes, so FlashList rebuilds the layout once and does not animate cells.

### 2.4 Horizontal rows

Rows are lists, not paged carousels. They use free scroll with `decelerationRate="fast"` and **no** `pagingEnabled` or snap. Size each row so the last visible tile is cut at the edge, which shows that more content exists.

| Tile | compact | medium | expanded | wide |
|---|---|---|---|---|
| Poster (2:3) | 116 | 140 | 152 | 168 |
| Thumb (16:9) | 264 | 300 | 320 | 352 |
| Square (1:1) | 148 | 168 | 180 | 196 |
| Circle (person) | 88 | 100 | 108 | 116 |

### 2.5 Radii

`xs 4 · sm 8 · md 10 · lg 14 · xl 20 · xxl 28 · pill 999`.

| Element | Radius |
|---|---|
| Poster and thumb tiles | 10 |
| Square tiles (album art in grids and rows) | 8 |
| Album art on the album page | 14 |
| Artwork in the full player | 20 |
| Cards, mini player, menus, grouped lists | 14 (mini player on iOS 26: capsule) |
| Buttons (50 tall) | 14; small buttons (32 tall) pill |
| Chips | pill |
| Sheets | system (do not set) |

Use continuous corners on iOS (`borderCurve: 'continuous'`).

---

## 3. Elevation and materials

Dark mode shows depth with lighter surfaces, not shadows. Shadows are only for floating things.

| Level | Use | Dark | Light |
|---|---|---|---|
| `flat` | Tiles, rows, cards | none | none |
| `raised` | Tile on hover/focus, player artwork | black 45 %, r 12, y 6 | ink 14 %, r 12, y 6 |
| `floating` | Mini player, toasts, menus | black 50 %, r 20, y 10 | ink 18 %, r 20, y 10 |
| `overlay` | Sheets, dialogs | black 60 %, r 32, y 16 | ink 22 %, r 32, y 16 |

**Materials.** On iOS 26, use Liquid Glass through `expo-glass-effect` (`GlassView`) for the mini player, the floating toolbars and the player control pills. On older iOS, use `expo-blur` `BlurView` with the tint in `theme.material`. On web and when **Reduce Transparency** is on (`AccessibilityInfo.isReduceTransparencyEnabled`), use the solid `glassFallback` colour.

Do not put glass on glass. Do not blur large scrolling areas (it costs GPU time on each frame). The tab bar and navigation bar are native and get their material from the system.

**Full-player background.** Show the current artwork, blurred (radius 60) with saturation 1.4, then dim it 45 % (dark). Cross-fade it in 400 ms when the track changes. Calculate it once per track; do not re-blur each frame.

---

## 4. Typography

### 4.1 Font strategy

- **iOS, iPadOS, Mac (iPad build):** the system font. Leave `fontFamily` undefined. SF Pro covers Latin. iOS falls back to **SF Arabic** for Arabic glyphs in the same `Text`, with matching weights. Nothing ships in the bundle.
- **Web:** `fontFamily.web` from `theme.ts`: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Arabic', system-ui, 'Segoe UI', 'Noto Sans', 'Noto Sans Arabic', 'IBM Plex Sans Arabic', sans-serif`. Self-host Noto Sans Arabic (variable, wght 100–900) as a WOFF2 subset in the web container, with `font-display: swap`. Load nothing from a third-party CDN (the web app runs on LAN with no internet).
- **Android (later):** Roboto plus Noto Sans Arabic (system on Android).
- **Times and sizes:** add `fontVariant: ['tabular-nums']` so numbers do not jump while they change.

### 4.2 Type scale and Dynamic Type

Sizes are the iOS "Large" (default) sizes. Text scales with the user's text size setting (`allowFontScaling` is on). `maxScale` is `maxFontSizeMultiplier`.

| Token | Size / line | Weight | Tracking | Dynamic Type style | maxScale | Use |
|---|---|---|---|---|---|---|
| `display` | 34 / 41 | 800 | 0.4 | largeTitle | 1.4 | Detail page title |
| `largeTitle` | 34 / 41 | 700 | 0.4 | largeTitle | 1.6 | Page titles drawn in the page (TV, empty states) |
| `title1` | 28 / 34 | 700 | 0.38 | title1 | 1.6 | iPad detail title |
| `title2` | 22 / 28 | 700 | −0.26 | title2 | 1.8 | Album title, player title |
| `title3` | 20 / 25 | 600 | −0.45 | title3 | 1.8 | Section headers |
| `headline` | 17 / 22 | 600 | −0.43 | headline | 2.0 | Row title (emphasis), buttons |
| `body` | 17 / 22 | 400 | −0.43 | body | 2.2 | Body, search field |
| `callout` | 16 / 21 | 400 | −0.31 | callout | 2.2 | List row title |
| `subheadline` | 15 / 20 | 400 | −0.23 | subheadline | 2.0 | Overview text, segment labels |
| `tileTitle` | 14 / 18 | 600 | −0.15 | subheadline | 1.5 | Tile titles |
| `footnote` | 13 / 18 | 400 | −0.08 | footnote | 2.0 | Metadata line, section footers |
| `caption1` | 12 / 16 | 400 | 0 | caption1 | 1.8 | Tile metadata |
| `caption2` | 11 / 13 | 500 | 0.06 | caption2 | 1.6 | Badges, tab labels |
| `mono` | 13 / 18 | 500, tabular | 0 | footnote | 1.6 | Times, sizes, speeds |

Rules:
- Tile titles: 1 line, tail truncation. Tile metadata: 1 line. At accessibility text sizes (`fontScale ≥ 1.5`), tiles allow 2 title lines and rows grow taller. Rows never clip text.
- At accessibility sizes, horizontal button groups (Play / Shuffle) stack vertically.
- Weights in use: 400, 500, 600, 700, 800. Do not use 300 or lighter (thin weights break up in Arabic).

### 4.3 Arabic and RTL

The app UI is LTR until the app is localised into Arabic. Content titles can be in any script.

- **Direction per string.** Call `textDirection(title)` (first strong character) and set `writingDirection` on that `Text`. Punctuation, numbers and mixed Latin then display in the correct order.
- **Alignment.** Short labels in tiles and rows keep the UI start edge (left in an LTR UI), so a mixed list has one clean edge. Standalone blocks (detail page title, overview, player title, lyrics) align to their own content direction: Arabic is right-aligned.
- **Line height.** When `hasArabic(text)` is true, multiply the line height by `arabicLineHeightFactor` (1.18). SF Arabic has taller ascenders and descenders, and the dots below the line clip at Latin line heights.
- **Truncation.** Do not truncate Arabic in the middle (`ellipsizeMode="middle"`), because joined letters change shape. Use `tail`.
- **No letter spacing on Arabic.** Set `letterSpacing: 0` when `hasArabic` is true, because tracking breaks the joins between letters.
- **Numbers.** Keep the digits the server sends. Do not convert Western digits to Eastern Arabic digits.
- **RTL UI (when localised).** Use `start`/`end` styles, never `left`/`right`. Mirror chevrons, back arrows and progress direction. Do not mirror play, pause, skip-forward and skip-back icons (media controls follow the timeline, which stays LTR, as on Apple platforms).
- **Search.** Normalise for matching: NFKC, remove tashkeel (U+064B–U+065F, U+0670), map alef forms (أ إ آ → ا), ta marbuta (ة → ه) and alef maqsura (ى → ي). Show the original text.

---

## 5. Iconography

- **iOS / iPadOS / Mac:** **SF Symbols** through `expo-symbols` (`SymbolView`). Native tabs use SF Symbol names directly. Weight: `regular` in lists and toolbars, `semibold` in player controls. Use `hierarchical` rendering for two-tone states.
- **Web (and Android later):** **Lucide** (`lucide-react-native` / `lucide-react`), stroke 1.75, round caps and joins. These match SF Symbols closely in weight.
- Wrap both in one `<Icon name="play" />` component with a name map. Screens never import a symbol library directly.
- Sizes (`iconSize`): `xs 13 · sm 17 · md 22 · lg 28 · xl 36 · xxl 48`.
- Outline icons in tabs and toolbars. Filled icons for the selected tab (native behaviour) and for play/pause and skip.
- Every icon-only control has an `accessibilityLabel`. Decorative icons beside text have `accessible={false}`.
- No emoji as icons.

| Role | SF Symbol | Lucide |
|---|---|---|
| Home | `house` | `house` |
| Library | `square.stack` | `library` |
| Music | `music.note` | `music` |
| Search | `magnifyingglass` | `search` |
| Downloads | `arrow.down.circle` | `circle-arrow-down` |
| Play / Pause | `play.fill` / `pause.fill` | `play` / `pause` (filled) |
| Skip back / fwd 10 | `gobackward.10` / `goforward.10` | `rotate-ccw` / `rotate-cw` + label |
| Skip 15 / 30 | `gobackward.15` / `goforward.30` | as above |
| Next / Previous | `forward.fill` / `backward.fill` | `fast-forward` / `rewind` |
| Add to playlist | `text.badge.plus` | `list-plus` |
| More | `ellipsis` | `ellipsis` |
| Played | `checkmark` | `check` |
| Favourite | `heart` / `heart.fill` | `heart` |
| Subtitles | `captions.bubble` | `captions` |
| AirPlay | `airplay.video` / `airplay.audio` | `cast` |
| PiP | `pip.enter` | `picture-in-picture-2` |
| Queue | `list.bullet` | `list-music` |
| Lyrics | `quote.bubble` | `message-square-quote` |
| Sleep timer | `moon.zzz` | `moon` |
| Shuffle / Repeat | `shuffle` / `repeat` / `repeat.1` | `shuffle` / `repeat` / `repeat-1` |
| Retry | `arrow.clockwise` | `rotate-cw` |
| Downloaded | `arrow.down.circle.fill` | `circle-arrow-down` (filled) |

---

## 6. Motion

Use Reanimated 4 for all animation and Gesture Handler for all gestures. Gestures and the animations they drive run on the UI thread (worklets). Do not use `setState` on each frame.

### 6.1 Tokens

| Token | Value | Use |
|---|---|---|
| `press` | 90 ms | Press-in feedback |
| `fast` | 160 ms | Fades, small state changes, all exits |
| `base` | 240 ms | Most transitions |
| `slow` | 340 ms | Large moves without a spring |
| Easing `standard` | (0.2, 0, 0, 1) | Default timing curve |
| Easing `enter` | (0, 0, 0, 1) | Things that appear |
| Easing `exit` | (0.3, 0, 1, 1) | Things that leave |

| Spring | damping / stiffness / mass | Use |
|---|---|---|
| `snappy` | 30 / 420 / 1 | Press release, toggles, chips |
| `smooth` | 28 / 260 / 1 | Pager indicator settle, layout moves, mini player → full player |
| `sheet` | 32 / 300 / 1 | Full-player dismiss and fling (pass the gesture velocity) |
| `gentleBounce` | 16 / 220 / 1 | Download-complete check mark only |

Rules:
- Exits are faster than entrances (160 ms vs 240 ms).
- An animation can always be interrupted. A new gesture starts from the current animated value, not from the end value.
- Hand the finger velocity into the spring when a gesture ends.
- Animate only `transform` and `opacity`. Never animate `width`, `height`, `top` or `left`.
- No stagger on scroll. First load of a screen can fade its first 6 items in with a 30 ms stagger. Cached content shows at once with no animation.

### 6.2 Press feedback

| Element | Press-in | Release |
|---|---|---|
| Tiles, cards | scale 0.97 + 8 % dark overlay, 90 ms | `snappy` spring to 1 |
| Round icon buttons (player) | scale 0.92 | `snappy` |
| List rows | `surface3` background (opacity 0.6 on media rows), immediate | fade back 160 ms |
| Primary buttons | `accentPressed` colour, scale 0.98 | `snappy` |

Feedback starts at touch-down (no delay), except in scroll views where the native press delay stops highlights during a scroll. Use `Pressable` from Gesture Handler (or `RectButton`) inside lists so scrolling cancels the press.

Long-press on a tile opens the native context menu with its own preview lift. Do not add a custom scale animation on top of it.

### 6.3 Haptics (`expo-haptics`)

| Event | Haptic |
|---|---|
| Tab or segment change, scrubber crosses a chapter mark | `selection` |
| Play/pause, add to queue, long-press menu open | `light` |
| Drag pick-up in reorder (queue, playlist) | `medium` |
| Download complete, playlist created | `success` |
| Destructive confirm shown | `warning` |
| Action failed | `error` |

Never use haptics on scroll or on every scrubber movement. The web has no haptics.

### 6.4 Reduced motion

When `AccessibilityInfo.isReduceMotionEnabled()` (or Reanimated `useReducedMotion()`) is true:
- Replace scale and translate transitions with a 150 ms opacity fade.
- Press feedback uses only the overlay or colour change, no scale.
- No shimmer on skeletons: use a static `surface2` block.
- The full-player background does not cross-fade; it changes at once.
- Direct manipulation stays: the pager, the scrubber and sheet drags still follow the finger, because the user moves them.
- The pager settles with a 160 ms timing curve instead of a spring.

---

## 7. Components

### 7.1 Tab bar and sidebar

- Use **expo-router native tabs** (`NativeTabs`). Do not build a JS tab bar. On iOS 26 it is the floating Liquid Glass bar. On iPadOS 18+ it becomes a sidebar that the user can show or hide (`sidebarAdaptable`).
- Tabs: Home (`house`), Library (`square.stack`), Music (`music.note`), Downloads (`arrow.down.circle`), and **Search with `role="search"`**. On iOS 26 the search tab shows as a separate round button at the trailing end.
- Tint: `accent`. Labels: system.
- Downloads tab badge: the number of active downloads; a red dot when one has failed.
- Tab switches are instant: keep each tab's stack mounted, and show cached data first.
- Tapping the active tab scrolls to the top, then pops to the root.
- **iPad sidebar content:** the five tabs, then a "Libraries" section with one entry per library (Movies, Shows, Music, Recitations) that opens Library filtered to it. Width 280. Hover: `surface2` background. Selected: `accentSoft` background, accent icon and text.

### 7.2 Mini player

- Shows when audio or video plays in the background. Height 52, capsule, `floating` shadow, `material.chrome` glass.
- On iOS 26, place it in the tab bar's **bottom accessory** slot when the native tabs API provides it. If it does not, float it 8 pt above the tab bar, inset by the gutter, and add its height to the bottom content inset of every scroll view.
- Content: art 38 × 38 (radius 8), title (`tileTitle`), artist/series (`caption1`, `text2`), play/pause and next (44 × 44 targets). A 2-pt progress line on the bottom edge in `accent`.
- Tap: open the full player. Swipe up: open the full player and follow the finger. Swipe left/right on it: next/previous track (with `selection` haptic).
- iPad/Mac: centred at the bottom of the content area, max width 400.

### 7.3 Tiles

All tiles use one `MediaTile` component with `kind: 'poster' | 'thumb' | 'square' | 'circle'`. The image comes from `resolveImage(item, variant)` only.

- **Image:** `expo-image`, `contentFit="cover"`, `recyclingKey={item.Id}`, `placeholder={{ blurhash }}`, `transition={{ duration: 160 }}` on first load only, `cachePolicy="memory-disk"`. Request the image at tile size × screen scale (`fillWidth`, `fillHeight`, `quality=90`, `tag`).
- **Placeholder:** BlurHash when the server has one, else the generated art (§7.5). Never an empty `surface` block for more than one frame.
- **Hairline:** an inner 0.5-pt border, white 8 % (dark) or black 8 % (light), so dark posters do not melt into the canvas.
- **Title below the tile** for posters, squares and circles: `tileTitle` 1 line, metadata `caption1` `text2` 1 line (year, artist, "S1 · E5").
- **Title on the tile** for thumbs in Continue Watching: bottom scrim, title `tileTitle` 15, metadata `caption1` white 78 %.
- **Progress:** 4-pt bar, 10 pt from the bottom and sides, track white 28 %, fill white. (White, not accent, reads on any artwork.) On a detail page the resume bar uses `accent`.
- **Badges** (22 × 22 circle, black 60 % with blur, white 13-pt glyph, top-trailing, 6-pt inset): Played (`checkmark`), Downloaded (`arrow.down`), Unplayed count for series (pill with number). Maximum one badge on a tile.
- **States:** pressed (§6.2); hover on pointer devices: scale 1.03, `raised` shadow, white 8 % overlay, 160 ms; keyboard focus: 2-pt `focusRing` with a 2-pt `bg` gap outside the tile radius, plus the hover scale.
- **Accessibility:** one element per tile. Label = "Title, year, 58 minutes left, downloaded". Long press = context menu (also exposed as accessibility actions).

### 7.4 Rows (Home shelves)

- Header: `title3` + chevron (`text3`). The whole header is a button that opens the full list. No "See all" text.
- Horizontal FlashList, `horizontal`, `showsHorizontalScrollIndicator={false}`, gutter as content inset, `tileGap` between tiles. Estimated item size = tile width.
- Rows lazy-load: a row below the fold fetches when it is 1 screen away.
- Home order: Continue Watching (thumb), Next Up (thumb), then one "Recently added in {Library}" row per library (poster for video, square for music), then extension rows.
- Empty rows hide. If all rows are empty, show the Home empty state.

### 7.5 Generated-art fallback tile

Used when `resolveImage` finds no image, and as the placeholder when there is no BlurHash. The same title gives the same art on every device.

**Algorithm** (`fallbackArt(title, itemId)` in `theme.ts`):

1. `key = title.normalize('NFKC').trim().toLowerCase()`. If `key` is empty, use the item id.
2. `h = FNV-1a-32(key)` over UTF-16 code units: start `0x811c9dc5`; for each unit `h ^= unit; h = Math.imul(h, 0x01000193) >>> 0`.
3. `hue = h % 360`.
4. `shift = 24 + ((h >>> 9) % 33)` (24–56°). `sign = (h >>> 17) & 1 ? +1 : −1`. `hue2 = (hue + sign·shift + 360) % 360`.
5. `angle = [135, 160, 200, 225][(h >>> 20) & 3]` (CSS degrees).
6. `from = hsl(hue, 42 %, 31 %)`, `to = hsl(hue2, 38 %, 16 %)`.
7. Glow: `hsl(hue, 60 %, 55 %)` at 35 % alpha to 0 % at 70 % radius, centred at `x = (20 + ((h >>> 24) % 61)) %`, `y = 18 %`.
8. Draw: linear gradient `from → to` at `angle`, glow on top. On native, use RN `experimental_backgroundImage` with the returned `css` string, or `expo-linear-gradient` with the returned `start`/`end` points.
9. Content on top:
   - Type glyph, centred at 38 % of the height, size 34 % of the tile width, white 50 %: `film` (movie), `tv` (series, episode), `music.note` (song, album), `music.mic` (artist), `waveform` (audiobook, recitation, long audio), `person` (person), `folder` (folder or collection), `play.rectangle` (other video).
   - Title: `headline`-weight 15/19 (posters ≥ 112 wide), 13/17 below that. White. Up to 3 lines (2 for thumbs). 10-pt inset, bottom aligned. Direction from `textDirection(title)`, alignment from the same direction (it is a standalone block). Arabic line height × 1.18.
   - Circles (people): the initials (first letter of the first two words), `title2`, centred, instead of glyph and title.
10. The gradient has no scrim. White text on `from` is at least 5.19:1 for all 360 hues, and higher on `to`.

The generated tile is a real tile (same press, hover and badge rules). It is not an error state.

### 7.6 Detail page hero (movie, series, episode)

- **Backdrop** full bleed under the status bar, height `min(0.56 × window height, 520)` on iPhone. Image: Backdrop → Thumb → Primary (resolver order). Below the image, a gradient from transparent at 45 % to `bg` at 100 %, plus a 35 % black gradient over the top 22 % so the status bar and the glass buttons stay readable.
- Parallax: on pull-down, scale the backdrop from the top (stretch) using scroll offset. On scroll up, the backdrop moves at 0.5× speed. Turn both off with Reduce Motion.
- Navigation bar: transparent with glass back and more buttons (40 × 40) at first. It gets the native material and the title when the title scrolls under it.
- **Title:** the server's Logo image when it exists (max 280 × 100, centred), else text in `display`, centred, max 3 lines. Arabic titles use content alignment (centred stays centred).
- **Metadata line:** `footnote` `text2`, tabular: year · genre · runtime · rating · resolution · HDR.
- **Primary action:** full-width 50-pt `accent` button: "Play", "Resume 1:02:14" or "Play S1 E5". Under it, a 3-pt resume bar in `accent` when there is progress.
- **Secondary actions:** one row of 44-pt round buttons with 11-pt labels: Download (shows progress ring while downloading), Add to playlist, Played, Favourite, Audio & Subtitles. Overflow goes into the More menu.
- **Overview:** `subheadline` `text2`, 3 lines with "More" in `accent` that expands in place.
- Below: Seasons (segmented pager for series), Episodes list, Cast & Crew (circle row), Chapters (thumb row), More like this (poster row).
- **iPad (≥ 900 content width):** two columns. Left: poster tile (raised), the column as wide as the poster. Right, the rest of the page: title, metadata, Play (poster width), the round actions, overview (max `readableWidth` 640), then lists. The actions get the text column's width, so all of them fit in one row. TV keeps a 40 % left column with Play and the actions under the poster, where the focus starts. The backdrop stays full width behind, height 420.

### 7.7 Segmented sub-tab pager (Music, Library sections, Seasons)

- Strip: horizontal labels in `subheadline` 600 weight, 22-pt gaps, 38-pt height, hairline under it. Selected: `text`. Others: `text2`. If the labels do not fit, the strip scrolls and keeps the selected label in view.
- Pages: `react-native-pager-view` (native UIPageViewController / ViewPager2), or a Gesture Handler pan with Reanimated where pager-view does not exist (web). Horizontal swipe changes the page. Pages keep their scroll position.
- **Indicator that tracks the swipe:** a 3-pt `accent` bar with rounded ends at the bottom of the strip.
  - Measure each label with `onLayout`: `x[i]`, `w[i]`.
  - Pager gives `position` (index) and `offset` (0–1) on each frame (`onPageScroll`, as a Reanimated shared value through `useEvent`/`useHandler`). Let `p = position + offset`, `i = floor(p)`, `t = p − i`.
  - `indicatorX = x[i] + (x[i+1] − x[i]) · t`; `indicatorW = w[i] + (w[i+1] − w[i]) · t`.
  - Label colour interpolates `text2 → text` with `t` for the target and the reverse for the source.
  - This runs on the UI thread with no React render. On release, the pager settles; the indicator follows the same value, so it settles with it (no separate spring).
- Tap a label: animate the pager to that page (the indicator follows). `selection` haptic when the page index changes.
- The pager must not take vertical scroll, and the leftmost page lets the iOS back-swipe edge gesture win (`failOffsetX` on the first page at the screen edge).
- Accessibility: the strip is a `tablist`; each label is a `tab` with selected state. VoiceOver users change pages by the labels, not by swipe.
- Keyboard (iPad/Mac/web): ⌘[ / ⌘] or ←/→ when the strip has focus.

### 7.8 Video player (full screen)

- Black background. Controls float over the video. Controls show on tap and on any input, and hide after 3 s of no input while playing (never while paused or scrubbing). Fade 160 ms.
- **Top bar** (gutter-inset, in the safe area): close (44, glass), title (`headline`) and chapter or episode (`footnote` white 72 %), then a glass pill with AirPlay, PiP, Audio & Subtitles, Settings (quality, speed).
- **Centre:** skip back 10 (64 glass circle, `gobackward.10`), play/pause (84 glass circle, 48 glyph), skip forward 10. Gaps 56. Double-tap the left or right third to skip ±10 s with a ripple label "−10 s" (counts up on repeated taps).
- **Bottom:** scrubber 6 pt tall (expands to 10 while dragged), track white 28 %, buffered white 45 %, played white. Thumb 16 pt white circle. Chapter marks: 2-pt gaps in the track. Times under the track: elapsed left, remaining (−) right, `mono`.
- **Scrubbing:** the centre controls hide. A trickplay preview (160 × 90, radius 10, 1.5-pt white border, `raised` shadow) follows the thumb, clamped to the gutters, with the time under it. Without trickplay, show only the time bubble. `selection` haptic when the thumb crosses a chapter mark.
- **Skip Intro / Skip Credits:** a solid white pill (`#FFFFFF` 90 %, ink text, `headline` 15) at bottom trailing, above the scrubber. It shows during the segment even when the controls are hidden. **Next episode:** the same position, a card with the next episode thumb and a 10-s countdown ring; "Play now" and "Cancel".
- **Track sheet (Audio & Subtitles):** a native sheet (medium detent) with two sections; the selected row has a checkmark. Subtitle style links to Settings.
- Gestures: vertical swipe down on the video to close (follows the finger, `sheet` spring). Pinch to switch between fit and fill.
- Keyboard: Space play/pause, ←/→ ±10 s, ⇧←/⇧→ ±30 s (or chapter), F full screen (web), M mute, C subtitles, Esc close.
- Status bar and home indicator hide with the controls (`prefersHomeIndicatorAutoHidden`).

### 7.9 Full music player

- Always dark. Background: blurred artwork (§3). A grabber at the top. The player opens from the mini player with a shared-element-like move: the mini art grows into the large art (`smooth` spring). Swipe down to dismiss with velocity (`sheet` spring).
- **Artwork:** width = screen width − 48, square, radius 20, `raised` shadow. When paused, it scales to 0.88 (`smooth` spring), as in Apple Music, so the state is visible at a glance.
- **Title row:** title `title2` white, artist `title3` 400 white 70 % (tappable, opens the artist). Favourite and More glass buttons (36) at the trailing end.
- **Scrubber:** same component as video, with format info centred under it (`caption2`, "FLAC · 24/96") when known.
- **Transport:** previous, play/pause (58 glyph), next. 44 × 44 minimum targets; play target 80.
- **Volume:** system volume slider (MPVolumeView via a native view; hidden on web).
- **Bottom row:** Lyrics, AirPlay route picker, Queue. Shuffle and repeat live at the top of the queue.
- **Long-form audio variant** (audiobooks, recitations, items over 20 min or from a library marked as long-form): the transport becomes previous chapter · −15 s · play/pause · +30 s · next chapter. A row of glass pills adds Speed (0.75–2.0×, tabular), Sleep timer (off, 5/15/30/45/60 min, end of chapter; shows remaining time), AirPlay and Chapters. The scrubber caption reads "Resumes where you left off" for 4 s after resume.
- **Lyrics:** full-screen over the blurred art. Synced lines: current line `title2` white, others white 45 %; auto-scroll keeps the current line at 35 % from the top. Tapping a line seeks. Arabic lyrics align right.
- **iPad (≥ 900):** artwork and controls on the left half; queue or lyrics on the right half.

### 7.10 Queue

- Sections: "Now playing" (one row), "Up next" (user-added, "Play next" items), "Playing from {Album}".
- Rows: 44-pt art, title, artist, a drag handle (`line.3.horizontal`) at the trailing end. Long press or handle drag to reorder (`medium` haptic on pick-up, rows move with `smooth` spring). Swipe left to remove.
- Header controls: Shuffle and Repeat toggles (selected = `accent` fill with `onAccent` glyph, not only a colour change) and Clear.
- Keyboard: select a row with ↑/↓, ⌥↑/⌥↓ to move, ⌫ to remove.

### 7.11 Download row with progress

- Row height 76. Thumb 70 × 40 (video) or 48 × 48 (audio), radius 6.
- Title `callout` 500. Status line `footnote` `text2` tabular: "812 MB of 1.4 GB · 8.6 MB/s · 1 min left". Progress bar 4 pt, track `surface3`, fill `accent`. Update the bar on the UI thread at most 4 times per second; animate between values with 240 ms linear so it never jumps.
- Trailing control (36 circle, `surface2`): Pause (in progress), Resume (paused), × Cancel (queued). Failed: `danger` icon and reason in the status line ("Server not reachable", "Not enough space"), with a "Retry" pill in `accent`.
- Done: the row moves from "In progress" to "On this device" with a 240 ms fade and a `success` haptic (once per batch, not per file).
- **Downloads screen:** no title (tab root), a storage bar (8 pt, segments: Zoggyfin in `accent`, Other in `controlBorder`, free in `surface3`) with a legend line, then "In progress · N" with "Pause all", then "On this device" grouped by series/album with count and size. Swipe left to delete; Edit for multi-select. Destructive confirms state the size.

### 7.12 Action sheet and context menu

- **Context menu** on long press (and right-click / two-finger click on iPad, Mac and web): native (`@react-native-menu/menu` or the expo-router / Zeego native menu). Preview: the tile itself. Order: Play, Play next, Add to queue, Add to playlist… , Download, Mark played, Favourite, Go to artist / series, then extension actions, then destructive actions in red.
- **Add to playlist:** a native sheet (medium detent). The first row is "New playlist" with an inline text field (Return creates and adds, `success` haptic, toast "Added to {name}"). Then recent playlists (max 5), then all playlists A–Z. Two taps from any item.
- **Confirm dialogs** for destructive actions only. Use the native alert, with the destructive button in red and the exact object and size in the message.

### 7.13 Empty, loading and error states

- **Loading (skeletons):** show the real layout with `surface2` blocks at the real tile sizes and radii, plus 12-pt text bars (60 % and 40 % width). Shimmer: a `surface3` band that moves across in 1400 ms, linear, synced across all blocks (one shared value). Show skeletons only after 150 ms. With cached data, show the cache and no skeleton. Reduce Motion: no shimmer.
- **Empty:** centred in the available space. A 48-pt SF Symbol in `text3`, title `headline`, one sentence `subheadline` `text2` (max 300 wide), and at most one action button (tonal). Example: Downloads empty: `arrow.down.circle` / "No downloads yet" / "Tap the download button on any movie, episode or album." / Browse Library.
- **Error (whole screen):** the same layout with `wifi.exclamationmark` or `exclamationmark.triangle`, a plain title ("Could not load Movies"), the reason ("The server did not respond."), and a "Retry" button in `accent`. With cached data, show the cache and an inline banner instead.
- **Error (inline / row):** a row with a `danger` icon, the message and a Retry link. Never a blank area.
- **Offline banner:** under the navigation bar: `surface2`, "Offline. Showing downloaded and cached items." Dismissible, returns on the next offline change.

### 7.14 Toasts

- Position: top, under the status bar (iPhone); top trailing (iPad/Mac/web). They do not cover the tab bar or the mini player.
- Capsule, `material.chrome` glass, `floating` shadow, min height 44, max width 360. Leading icon (17), text `subheadline` 500, optional action (`accent`, "Undo", "View").
- Enter: slide 12 pt + fade, `smooth` spring. Exit: fade 160 ms. Auto-dismiss after 3.2 s (6 s with an action). Swipe up to dismiss. Max 1 on screen; a new one replaces the old.
- VoiceOver announces the text (`AccessibilityInfo.announceForAccessibility`).

### 7.15 Settings rows

- Native-style inset grouped list on `bgGrouped`: groups on `surface` with radius 14, 16-pt gutter, 44-pt minimum row height, hairline separators inset to the text.
- Row: optional leading icon in a 29 × 29 rounded square (radius 7) with a neutral fill (`surface3` dark / ink-grey light) and a white glyph. Do not use a rainbow of icon colours. Title `body`. Trailing value `body` `text2`, then a chevron (`text3`) for navigation, or a native `Switch` (on-tint `accent`), or a checkmark in `accent` for selection.
- Group header `footnote` uppercase `text2` with 0.4 tracking; footer `footnote` `text2`.
- Destructive rows (Sign out, Clear cache): `danger` text, centred, in their own group.
- The account row at the top: 60-pt row with the avatar, user name and server name.

### 7.16 Search

- The Search tab opens with the field focused only when the user tapped the tab (not on app start).
- Field: native search bar in the navigation bar (`headerSearchBarOptions`), or a 40-pt rounded field (`surface2`, radius 12) on web. Cancel in `accent`.
- Debounce 250 ms. Cancel the previous request (AbortController). Show results grouped by type: Top result (a card with art and a Play/Resume button), Movies, Shows, Episodes, Songs, Albums, Artists, People. Each group shows up to 8, with a header button to see all.
- Filter chips under the field: All, Movies, Shows, Episodes, Music, People (selected chip: `text` fill with `bg` text).
- Before typing: recent searches (max 10, with clear) and quick links to libraries.
- Offline: search runs over downloaded items and says so in a section footer.
- Highlight the matched part of titles in `text` 600 with the rest in 400. Arabic matching uses the normalisation in §4.3.
- No results: "No results for "{query}"" with a hint to check spelling or switch filter.
- Keyboard: ⌘F focuses search anywhere (iPad/Mac/web). ↓ moves into results, Return opens.

### 7.17 Buttons and chips

| Kind | Height | Fill | Text |
|---|---|---|---|
| Primary | 50 | `accent` | `onAccent`, `headline` |
| Tonal | 50 | `surface2` | `accent` (on album pages) or `text`, `headline` |
| Small | 32 | `accent` or `surface2` | `subheadline` 600, pill |
| Icon round | 44 (36 in dense rows) | `surface2` or glass | icon `md` |
| Text | 44 target | none | `accent` `body` |
| Chip | 32 | `surface2`; selected `text` | `subheadline` 500; selected `bg` |

Disabled: 40 % opacity, `accessibilityState={{ disabled: true }}`, no press feedback.

### 7.18 Update card (Mac app, Android TV)

- Only in the desktop app and the sideloaded Android TV app (EAS profile `tv`). Nothing shows
  in a browser, on iPhone and iPad, on Android phones or in the Google Play TV build.
- Place: bottom trailing, over the content, 16 pt from the edge, and above the mini player
  (84 pt from the bottom). Width 340 (less in a narrow window). It does not block the page.
- Card: solid `surface` with a hairline `separator` border (not glass: the notes must stay
  legible over artwork), radius 14, `floating` shadow, 16-pt padding. Leading badge 29 × 29 (radius 7) on `accentSoft` with an `accent` glyph;
  on an error, `surface3` with a `danger` glyph.
- Text: title `headline` ("Zoggyfin 0.1.2 is available"), then `footnote` `text2`
  ("You have version 0.1.1."). Release notes as bullets in `subheadline`, at most 4 lines,
  then "Show all (n)" in `accent`.
- Buttons, trailing: Small tonal "Later" and Small primary "Install and restart". After an
  error: "Later" (or "Close") and "Try again", with the error text in `footnote` `danger`.
- Download: a 4-pt bar (`accent` on `surface3`, pill), with "12.3 MB of 40.0 MB" in
  `footnote` tabular `text2`. Install: a small spinner and "Installing. Zoggyfin restarts."
  During the download and the install, no button closes the card.
- A manual check ("Check for Updates…" in the app menu and in Settings) shows "Checking…",
  then the result. "Zoggyfin is up to date" closes after 4 s.
- An automatic check opens the card only for a new version, and not for a version that the
  user put off with "Later". It does not take the focus. A manual check focuses the main
  button. Esc in the card is "Later".
- Motion: in with a 12-pt slide and a fade (`smooth` spring), out with a 160-ms fade.
  Reduced motion: the fade only. VoiceOver reads the title.
- **TV:** the same content in the centred TV panel of the sheets (`Sheet` on TV), which holds the remote's
  focus. The main button ("Install", "Try again", "Open Settings") takes the focus, also when the
  panel opens by itself: on a TV no one types, and a card the remote cannot reach is of no use.
  Back is "Later". The panel waits while the video or the music player is open. "Install"
  downloads with the same bar, then shows "The system installer opens. Confirm the update there."
  When Zoggyfin may not install apps yet, the title is "Allow Zoggyfin to install the update",
  one `footnote` line says where the switch is, and the buttons are "Later" and "Open Settings".

### 7.19 TV focus

A focused control on TV shows **one** focus mark, never two (a ring around a fill reads as two
things in focus). `Touchable` applies the mark from its `kind`, so screens do not draw their own.

| Control | `kind` | TV focus mark |
|---|---|---|
| Tile (poster, thumb, square) | `tile` | White 3-pt ring with a 3-pt gap, and the focus scale (1.1). No shadow |
| Round tile (person, artist) | `plain`, ring on the circle | The same ring and scale, on the circle only |
| Button, chip, icon button, round detail button | `button`, `icon` | White ring and the focus scale |
| Row and list item (Settings, sheets, Live TV groups and channels, search results, admin) | `row` | `tvRowFocus` fill (white 22 %) under the content. No ring, no scale. The text keeps its colours |
| Side menu item | own `Pressable` | Solid `text` fill with `bg` text (the navigation is the strongest mark on screen) |
| Text field | `TextField` | White 3-pt border |
| Player pill button (over video) | own `Pressable` | White 35 % fill |

- A row that is also *selected* (the current group, a checked option) keeps its selected look
  (`accentSoft` fill or a check mark); the focus fill goes on top of it.
- Phones, iPad, the Mac app and the web keep the keyboard focus ring of §8 on every control.

### 7.20 TV safe area (overscan)

Many TVs crop the edges of the picture (Fire TV does by default), and a TV reports no safe-area
insets. Every control, text and focus mark stays inside 5 % of each edge: 96 x 54 points on the
1920-point TV design width (48 x 27 dp at 1080p). Backgrounds and artwork may bleed to the edges.

- One inset: `tv.safeX` and `tv.safeY` (`theme/layout.ts`), as `useLayout().safe`.
- `TvSafeArea` (root layout) reports it as the safe-area insets on TV. Everything that keeps clear
  of the insets (the video player's controls and overlays, toasts, sheets, Now Playing) is inside
  with no TV code of its own.
- The tab pages sit inside it at the top and the bottom (the side menu's content guide). Home is
  the exception at the top: its billboard art runs to the top edge, and its text starts lower.
- The side menu items, their focus fill and the menu glyph start at `safeX` and `safeY`. The page
  margin (`tv.gutter`) is the same 5 %, so the trailing edge of a page is inside too.
- Horizontal rows may run off the trailing edge (a part of the next tile shows that the row
  scrolls). Their focused tile never does.
- Full-width list rows (tracks, episodes, IPTV episodes) stop one gutter before the trailing edge
  on TV, so their focus fill stays inside. `tvRowInset(gutter)` gives the margins and the padding
  that keep the row's content on the page edge.

### 7.21 Live TV

TV first (TiviMate style), then the same parts in other windows.

- **TV:** a header (Live TV, the provider and its channel count; provider chips when there is more
  than one; Search, reload and Providers buttons), then three columns: the browse column (200 pt),
  the channel list, and the details panel (290 pt, `surface`, radius `lg`) for the focused channel.
- **Browse column** (`iptv/browse.ts`): Search; Favourites when it has channels; Recently watched
  when it has channels; All channels; Favourites when it is empty; Films and Series when the provider has them (
  `features/iptv/sections.ts`); a GROUPS heading and the provider's groups; Providers last. The
  selected entry has the `accentSoft` fill and an accent icon. It takes the first focus on TV.
- **Channel row** (64 pt on TV, 72 pt elsewhere): number (tabular, right-aligned), logo plate, name
  (`headline`), the programme now (`subheadline`, `text2`) with a 36-pt progress bar. A heart button
  at the end; a small filled heart after the name on TV. The playing channel is in `accent`. Narrow
  and wide windows with no details panel show the next programme as a third line.
- **Details panel:** the logo, number and name (`title3`), Favourite and the group; NOW with its
  times, the title (`headline`), a progress bar with the time left and the description; NEXT with
  its start and title; a hint for Select and the menu key at the bottom.
- **Search:** one step from anywhere. TV: the Search entry and the header button open a field at the
  top of the list and the keyboard at once (`disableFullscreenUI`, so the results show above the
  keyboard). Elsewhere: the field in the toolbar. Results follow each key press: the channel number
  first (exact, then numbers that start with the query, lowest first), then names that start with
  the query, then a word that starts with it, then anywhere. Recent searches show as chips while the
  field is empty; a search is kept when one of its channels plays. Back leaves the search.
- **Favourites:** the heart, the menu key on a focused row (TV), and a long press (touch).
- **States:** no provider (a 72-pt `accentSoft` circle with the TV glyph, two buttons), loading
  (skeleton rows and one line), failed (the reason, Try again, Edit provider), an empty group or no
  results (an icon, a title and one sentence; above the keyboard during a search).
- **Narrow windows:** the toolbar (field, reload, Providers), chips for the lists, sections and
  groups, and the list.
- **Live player (TV, TiviMate style):**
  - Up and Down change the channel while the controls are hidden, on the channel card, or with no
    control focused; CH+ and CH- always do. On a button, Up and Down move the focus. Left and
    Right never seek: they show the controls, and on the card they go to Play.
  - **Zap banner** (`LiveChannelCard`, the bottom of the safe area): number, logo plate, name and
    group, NOW with its times, the title, a progress bar and the time left, and NEXT. Quick presses
    step through the channels in the banner; the player tunes 700 ms after the last press
    (`player/zap.ts`), at once on Select. Back drops the choice. After a tune the banner stays 3 s.
  - **Channel card:** the same card takes the scrubber's place in the controls and the first focus
    (white 3-pt border on TV). Select opens the channel list.
  - **Channel list:** the focused row's channel shows in the same card above the list, from the
    guide. No preview opens a second stream (providers often allow one connection). "Search
    channels" at the top stops the stream and opens the Live TV search.

---

## 8. iPad, Mac, keyboard and pointer

- **Layouts follow width, not device** (§2.2). Test in Split View at 1/3, 1/2 and 2/3, and in Stage Manager windows.
- **Pointer hover** (iPad with trackpad, Mac, web): tiles lift (§7.3), rows and sidebar items get `surface2`, buttons get `surface3`, 160 ms. On iOS, use the New Architecture pointer events (`onPointerEnter` / `onPointerLeave`) or a native `UIPointerInteraction` wrapper with a highlight effect. On web, use `Pressable`'s hovered state and `cursor: pointer`.
- **Keyboard focus:** every interactive element can take focus. The focus ring is 2 pt `focusRing` with a 2-pt gap, following the element radius. Focus never hides under the mini player or a sticky bar (scroll it into view).
- **Global shortcuts** (register with a `UIKeyCommand` wrapper on iOS, `keydown` on web, and show them in the iPad ⌘-hold menu):

| Key | Action |
|---|---|
| Space | Play / pause (when no text field has focus) |
| ← / → | Seek −10 / +10 s (video), previous/next is ⌘← / ⌘→ (music) |
| ↑ / ↓ | Volume (Mac, web) |
| ⌘F | Search |
| ⌘1…⌘5 | Switch tab |
| ⌘[ / ⌘] | Back / forward; in a pager, previous / next page |
| ⌘L | Lyrics (music player) |
| Esc | Close player or sheet |
| Return | Open the focused item |

- **Right-click** opens the same context menu as long press.
- **Drag and drop (Mac/iPad):** items can be dragged onto a playlist in the sidebar (phase 2).
- Mac window minimum: 700 × 500; below that, the compact layout applies.

---

## 9. Performance rules that affect design

- Tile components are memoised (`React.memo`) and take primitive props. No inline functions in `renderItem`.
- Images are requested at tile pixel size. Never load a full-size poster for a 112-pt tile.
- Shadows on scrolling tiles are off (`flat`). Shadows appear only on hover or focus.
- Blur only on fixed chrome (mini player, toolbars), never on cells.
- Text measurement: set fixed line counts on tiles so FlashList gets stable sizes.
- Animate only `transform` and `opacity`, on the UI thread.

## 10. Accessibility checklist

- All text pairs pass AA (§1.2). Meaningful icons and borders pass 3:1.
- Touch targets are at least 44 × 44 (expand with `hitSlop` when the glyph is smaller).
- Dynamic Type: test at XXXL and at AX3. Nothing clips; tiles grow; button groups stack.
- VoiceOver: one stop per tile; rows read title, subtitle and state; player controls have labels and values ("Playback position, 1 minute 34 seconds of 4 minutes 5 seconds", adjustable by swipe up/down ±15 s).
- Reduce Motion (§6.4), Reduce Transparency (§3), Increase Contrast (use `text` instead of `text2` for metadata, and `controlBorder` around tiles), Bold Text (system font handles it).
- Swipe-only actions have a button or menu alternative (pager labels, row menus, queue Edit mode).
