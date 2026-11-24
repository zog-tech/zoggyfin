/**
 * TV: the music player, in the style of the music apps on TV. The art on the
 * left, the song on the right with a progress line, one row of large round
 * transport buttons (Play/Pause has the focus when the player opens) and one
 * row of pills: Up next, Lyrics, Like and More. The queue and the lyrics
 * take the place of the art when their pill is pressed, so they are focus
 * stops only while they are open; Back closes them, and Back again closes the
 * player (the music keeps playing). The remote's Play/Pause key works through
 * the system media session everywhere, so the screen does not handle it.
 *
 * The phone, iPad, web and Mac player (`now-playing-screen.tsx`) is a
 * different layout with touch gestures; TV uses this one.
 *
 * TV Modern look (§7.22, spec 2.9): the same layout in TV units: art 600 u
 * at the safe edge, the song from x = 792 u, bare transport glyphs with the
 * focus plate, and one row of text actions that never wraps.
 */
import { type Href, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { ItemImage } from '@/components/item-image';
import { ToastHost } from '@/components/toast-host';
import { tabGroupNow } from '@/features/extensions/tab-nav';
import { openAddToPlaylist } from '@/features/playlists/add-to-playlist';
import { TvButton, TvIconButton } from '@/features/tv/tv-button';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { useTvBack } from '@/features/tv/use-tv-back';
import { itemHref } from '@/lib/navigation';
import { artistLine } from '@/player/audio/item';
import { queueSections } from '@/player/audio/queue';
import { audioSession } from '@/player/audio/session';
import { useAudioStore } from '@/player/audio/store';
import { useShowsPause } from '@/player/control-gate';
import { playerState, setPlayerState, usePlayerStore } from '@/player/store';
import { formatTime } from '@/player/timeline';
import { type AppTheme, createStyles, font, mediaColors, radius, scaled, scriptStyle, spacing, tvFont, tvm, type, u, useLayout, useStyles } from '@/theme';

import { PlayerSheet, type SheetSection } from '../player/player-sheet';
import { c } from '../player/tokens';
import { ArtBackground } from './art-background';
import { LyricsPanel } from './lyrics-panel';
import { useLike } from './use-like';
import { QueuePanel } from './queue-panel';

type Panel = 'none' | 'queue' | 'lyrics';

const MODERN = isTV && isTvModern;

/** A transport button's size: Classic the circle in points; Modern the box and the glyph in TV units. */
function transport(classic: number, box: number, glyph: number): { size: number; glyph?: number } {
  return MODERN ? { size: box, glyph } : { size: classic };
}

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export function TvNowPlaying() {
  const s = useNowPlayingStyles();
  const l = useLayout();
  const now = usePlayerStore((st) => st.now);
  const status = usePlayerStore((st) => st.status);
  const error = usePlayerStore((st) => st.error);
  const showsPause = useShowsPause();
  const longForm = useAudioStore((st) => st.longForm);
  const queue = useAudioStore((st) => st.queue);
  const lyricsState = useAudioStore((st) => st.lyrics);
  const session = audioSession();
  const [panel, setPanel] = useState<Panel>('none');
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setPlayerState({ presentation: 'full' });
    return () => {
      if (playerState().presentation === 'full') setPlayerState({ presentation: playerState().now ? 'mini' : 'hidden' });
    };
  }, []);
  // Playback stopped (Stop in More, or the queue ran out): leave.
  useEffect(() => {
    if (!now && status === 'idle') leave();
  }, [now, status]);
  // Back closes an open queue or lyrics first; with none open the stack closes the player.
  useTvBack(panel !== 'none', () => setPanel('none'));

  const item = now?.item;
  // Before the early return: hooks run on every render.
  const like = useLike(item);
  if (!now || !item) return <View style={s.root} />;

  const lyrics = lyricsState?.status === 'ready' && lyricsState.itemId === item.Id ? lyricsState.lyrics : null;
  const shown: Panel = panel === 'lyrics' && !lyrics ? 'none' : panel;
  const artist = artistLine(item);
  const from = queue.source?.name ?? item.Album ?? null;
  const upcoming = (() => {
    const q = queueSections(queue);
    return q.upNext.length + q.rest.length + q.autoplay.length;
  })();
  const isFav = like.liked;
  const toggleFavourite = like.toggle;
  const go = (target: BaseItemDto) => {
    const href = itemHref(tabGroupNow('(music)'), target);
    leave();
    if (href) setTimeout(() => router.push(href as Href), 50);
  };
  const artistItem = item.ArtistItems?.[0] ?? item.AlbumArtists?.[0];

  const side = MODERN ? u(ART) : Math.round(l.height * 0.6);
  const sections: SheetSection[] = [
    {
      title: item.Name ?? 'Now playing',
      rows: [
        ...(item.AlbumId ? [{ key: 'album', label: 'Go to album', selected: false, onPress: () => go({ Id: item.AlbumId ?? '', Name: item.Album, Type: 'MusicAlbum' }) }] : []),
        ...(artistItem?.Id ? [{ key: 'artist', label: 'Go to artist', selected: false, onPress: () => go({ Id: artistItem.Id ?? '', Name: artistItem.Name, Type: 'MusicArtist' }) }] : []),
        { key: 'playlist', label: 'Add to playlist…', selected: false, onPress: () => openAddToPlaylist(item) },
        { key: 'mix', label: 'Instant mix from this song', selected: false, onPress: () => void session.instantMix(item) },
        { key: 'stop', label: 'Stop playback', selected: false, onPress: () => void session.stop() },
      ],
    },
  ];

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <ArtBackground item={item} />
      <View style={[s.body, MODERN ? modernStyles.bodyPad : { paddingHorizontal: l.gutter * 1.5, gap: l.gutter }]}>
        <View style={{ width: side, height: side }}>
          {shown === 'queue' ? (
            <QueuePanel selectedKey={selected} onSelect={setSelected} toolbar={false} />
          ) : shown === 'lyrics' && lyrics ? (
            <LyricsPanel lyrics={lyrics} />
          ) : (
            <View style={s.art}>
              <ItemImage item={item} variant="square" width={side} aspectRatio={1} rounded={MODERN ? u(ART_RADIUS) : radius.lg} hideArtTitle={false} />
            </View>
          )}
        </View>
        <View style={s.info}>
          {from ? (
            <Text style={[s.from, scriptStyle(from, s.from, true)]} numberOfLines={1}>
              {`Playing from ${from}`}
            </Text>
          ) : null}
          <Text style={[s.title, scriptStyle(item.Name, s.title, true)]} numberOfLines={2} accessibilityRole="header">
            {item.Name}
          </Text>
          {artist ? (
            <Text style={[s.artist, scriptStyle(artist, s.artist, true)]} numberOfLines={1}>
              {artist}
            </Text>
          ) : null}
          <Progress error={status === 'error' ? (error ?? 'Playback failed') : null} />
          <View style={s.transport}>
            {longForm ? (
              <TvIconButton icon="gobackward.15" label="Back 15 seconds" {...transport(56, 80, 40)} plain onPress={() => session.skip(-15)} />
            ) : (
              <TvIconButton icon="shuffle" label={queue.shuffle ? 'Shuffle on' : 'Shuffle off'} {...transport(56, 80, 40)} plain active={queue.shuffle} onPress={() => session.toggleShuffle()} />
            )}
            <TvIconButton icon="backward.fill" label="Previous" {...transport(64, 96, 52)} plain onPress={() => (longForm ? session.chapterStep(-1) : session.previous())} />
            <TvIconButton icon={showsPause ? 'pause.fill' : 'play.fill'} label={showsPause ? 'Pause' : 'Play'} {...transport(88, 112, 72)} firstFocus onPress={() => session.togglePlay()} />
            <TvIconButton icon="forward.fill" label="Next" {...transport(64, 96, 52)} plain onPress={() => (longForm ? session.chapterStep(1) : session.next())} />
            {longForm ? (
              <TvIconButton icon="goforward.30" label="Forward 30 seconds" {...transport(56, 80, 40)} plain onPress={() => session.skip(30)} />
            ) : (
              <TvIconButton
                icon={queue.repeat === 'one' ? 'repeat.1' : 'repeat'}
                label={queue.repeat === 'off' ? 'Repeat off' : queue.repeat === 'all' ? 'Repeat all' : 'Repeat one'}
                {...transport(56, 80, 40)}
                plain
                active={queue.repeat !== 'off'}
                onPress={() => session.cycleRepeat()}
              />
            )}
          </View>
          <View style={s.pills}>
            <TvButton
              label={upcoming ? `Up next · ${upcoming}` : 'Up next'}
              icon="list.bullet"
              active={shown === 'queue'}
              onPress={() => setPanel((p) => (p === 'queue' ? 'none' : 'queue'))}
            />
            {lyrics ? (
              <TvButton label="Lyrics" icon="quote.bubble" active={shown === 'lyrics'} onPress={() => setPanel((p) => (p === 'lyrics' ? 'none' : 'lyrics'))} />
            ) : null}
            <TvButton label={isFav ? 'Liked' : 'Like'} icon={isFav ? 'heart.fill' : 'heart'} active={isFav} onPress={() => void toggleFavourite()} />
            <TvButton label="More" icon="ellipsis" onPress={() => setMore(true)} />
          </View>
        </View>
      </View>
      <PlayerSheet visible={more} title="More" sections={sections} onClose={() => setMore(false)} />
      <ToastHost overlay />
    </View>
  );
}

/** The position line and times. Its own component: the position ticks several times a second. */
function Progress({ error }: { error: string | null }) {
  const s = useNowPlayingStyles();
  const position = usePlayerStore((st) => st.position);
  const duration = usePlayerStore((st) => st.duration);
  const fraction = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  return (
    <View style={s.progress}>
      <View style={s.track}>
        <View style={[s.fill, { width: `${fraction * 100}%` }]} />
      </View>
      <View style={s.times}>
        <Text style={s.time}>{formatTime(position)}</Text>
        {error ? (
          <Text style={s.error} numberOfLines={1}>
            {error}
          </Text>
        ) : null}
        <Text style={s.time}>{`−${formatTime(Math.max(0, duration - position))}`}</Text>
      </View>
    </View>
  );
}

const makeStyles = createStyles((_t: AppTheme) => ({
  root: { flex: 1, backgroundColor: mediaColors.black },
  body: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' as const, alignItems: 'center' as const },
  art: { borderRadius: radius.lg, overflow: 'hidden' as const },
  info: { flex: 1, gap: spacing.sm },
  from: { ...font(type.footnote), color: c.textOnMediaSecondary, textTransform: 'uppercase' as const, letterSpacing: 1 },
  title: { ...font(type.title1), color: c.textOnMedia },
  artist: { ...font(type.title3), fontWeight: '400' as const, color: c.textOnMediaSecondary },
  progress: { marginTop: spacing.lg, gap: spacing.xs },
  track: { height: scaled(4), borderRadius: radius.pill, backgroundColor: mediaColors.tvTrack, overflow: 'hidden' as const },
  fill: { height: '100%' as const, backgroundColor: mediaColors.white, borderRadius: radius.pill },
  times: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: spacing.md },
  time: { ...font(type.footnote, { tabular: true }), color: c.textOnMediaSecondary },
  error: { ...font(type.footnote), color: c.textOnMedia, flexShrink: 1 },
  transport: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xl, marginTop: spacing.md },
  pills: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.md, marginTop: spacing.md },
}));

/** Modern (spec 2.9): the art and the gap to the song, in TV units. */
const ART = 600;
const ART_RADIUS = 20;
const SAFE_X = 96;

/** Modern TV: the keys that differ from Classic. Text actions and transport boxes shift left by their padding, so their text and glyphs start on the column edge. */
const modernStyles = StyleSheet.create({
  bodyPad: { paddingLeft: u(SAFE_X), paddingRight: u(SAFE_X), gap: u(SAFE_X) },
  art: { borderRadius: u(ART_RADIUS), overflow: 'hidden' },
  info: { flex: 1, gap: u(8) },
  from: { ...tvFont(tvm.type.eyebrow), color: tvm.color.onArt, textTransform: 'uppercase' },
  title: { ...tvFont(tvm.type.hero), fontSize: u(64), lineHeight: u(72), color: c.textOnMedia },
  artist: { ...tvFont(tvm.type.menu), fontSize: u(36), lineHeight: u(44), fontWeight: '500', color: c.text2 },
  progress: { marginTop: u(40), gap: u(12) },
  track: { height: u(8), borderRadius: u(4), backgroundColor: mediaColors.tvTrack, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: mediaColors.white, borderRadius: u(4) },
  times: { flexDirection: 'row', justifyContent: 'space-between', gap: u(24) },
  time: { ...tvFont(tvm.type.meta, { tabular: true }), color: c.text2 },
  error: { ...tvFont(tvm.type.meta), color: c.textOnMedia, flexShrink: 1 },
  // The shuffle box is 80 u around a 40 u glyph: shift by the 20 u inset.
  transport: { flexDirection: 'row', alignItems: 'center', gap: u(16), marginTop: u(32), marginLeft: -u(20) },
  // One row that never wraps (spec 2.3); the first label starts on the column edge.
  pills: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: u(tvm.size.actionGap), marginTop: u(24), marginLeft: -u(tvm.size.actionPadX) },
});

/** The styles of this look: Classic as before; Modern replaces the keys above. */
function useNowPlayingStyles() {
  const base = useStyles(makeStyles);
  return MODERN ? { ...base, ...modernStyles } : base;
}
