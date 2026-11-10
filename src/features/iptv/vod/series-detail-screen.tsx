/**
 * The page of an IPTV series: Play or Resume (the last unfinished episode,
 * else the next one), Favourite, the seasons as chips and the episodes of
 * the picked season. An episode plays from its saved position; Next in the
 * player goes on through the seasons.
 */
import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { Chip, chipRowTV } from '@/components/chip';
import { Icon } from '@/components/icon';
import { PlainArt } from '@/components/plain-art';
import { Touchable } from '@/components/touchable';
import {
  type Episode,
  isVodFavourite,
  playedFractionOf,
  positionOf,
  resumeAt,
  seriesTarget,
  useActiveProviderId,
  useEnsureTitle,
  useVodInfo,
  useVodLists,
  useVodPlayer,
  useVodTitle,
  vod,
} from '@/iptv';
import { toast } from '@/lib/toast';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, iconSize, mediaColors, radius, scaled, scriptStyle, sizes, spacing, tvRowInset, type, useLayout, useStyles, useTheme } from '@/theme';

import { type VodAction, VodDetail } from './vod-detail';
import { episodeLine, factsOf } from './vod-view';

export function SeriesDetailScreen({ id, providerId: wanted }: { id: string; providerId?: string }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const inset = isTV ? tvRowInset(l.gutter) : null;
  const active = useActiveProviderId();
  const pid = wanted || active;
  const item = useVodTitle(pid, 'series', id);
  const info = useVodInfo(pid, 'series', id);
  const lists = useVodLists(pid);
  const player = useVodPlayer();
  const details = info.data;
  const allStatus = useEnsureTitle(pid, 'series', !item);
  const seasons = useMemo(() => details?.seasons ?? [], [details]);
  const target = useMemo(() => seriesTarget(seasons, lists), [seasons, lists]);
  const [picked, setPicked] = useState<number | null>(null);
  const seasonNo = picked ?? target?.episode.season ?? seasons[0]?.number ?? null;
  const season = seasons.find((x) => x.number === seasonNo) ?? seasons[0] ?? null;
  const name = item?.name ?? details?.name ?? '';
  const poster = item?.poster ?? details?.poster ?? null;
  const favourite = isVodFavourite(lists, 'series', id);
  const ref = { id, name, poster: poster ?? undefined };

  const play = (ep: Episode, start: number) => pid && player.playEpisode(pid, ref, seasons, ep, start);

  const actions: VodAction[] = [
    {
      icon: favourite ? 'heart.fill' : 'heart',
      label: 'Favourite',
      active: favourite,
      onPress: () => {
        if (!pid || !name) return;
        const on = vod.toggleFavourite(pid, { kind: 'series', id, name, ...(poster ? { poster } : {}) });
        toast(on ? `${name} is in Favourites` : `${name} is no longer in Favourites`, { icon: on ? 'heart.fill' : 'heart' });
      },
    },
    { icon: 'arrow.clockwise', label: 'Reload', onPress: () => pid && void vod.reloadInfo(pid, 'series', id) },
  ];
  if (target && target.start > 0) actions.unshift({ icon: 'arrow.counterclockwise', label: 'Start over', onPress: () => play(target.episode, 0) });

  const status =
    info.status === 'loading' && !details ? (
      <ActivityIndicator color={c.text2} style={s.spinner} />
    ) : info.status === 'error' && !details ? (
      <Text style={s.note}>{`The seasons did not load. ${info.error ?? ''}`.trim()}</Text>
    ) : details && !seasons.length ? (
      <Text style={s.note}>This series has no episodes at the provider yet.</Text>
    ) : null;

  const credits = [details?.director ? `Director: ${details.director}` : null, details?.cast ? `Cast: ${details.cast}` : null].filter((x): x is string => !!x);

  if (!name) {
    const gone = info.status === 'error' && allStatus !== 'loading' && allStatus !== 'idle';
    return (
      <View style={s.center}>
        <Stack.Screen options={{ title: '' }} />
        {gone ? <Text style={s.note}>{info.error ?? 'This series did not load.'}</Text> : <ActivityIndicator color={c.text2} />}
      </View>
    );
  }

  return (
    <VodDetail
      kind="series"
      id={id}
      title={name || 'Series'}
      poster={poster}
      backdrop={details?.backdrop ?? null}
      facts={factsOf('series', item, details)}
      overview={details?.plot ?? item?.plot}
      credits={credits}
      primary={target ? { label: target.label, onPress: () => play(target.episode, target.start), progress: playedFractionOf(positionOf(lists, 'episode', target.episode.id)) } : null}
      actions={actions}
      status={status}>
      {seasons.length ? (
        <View style={s.episodes}>
          {seasons.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.chips, chipRowTV(), { paddingHorizontal: l.gutter }]}>
              {seasons.map((x) => (
                <Chip key={x.number} label={x.name} selected={x.number === season?.number} onPress={() => setPicked(x.number)} />
              ))}
            </ScrollView>
          ) : (
            <Text style={[s.section, { paddingHorizontal: l.gutter }]} accessibilityRole="header">
              {season?.name}
            </Text>
          )}
          {season?.episodes.map((ep) => {
            const progress = playedFractionOf(positionOf(lists, 'episode', ep.id));
            const watched = positionOf(lists, 'episode', ep.id)?.finished ?? false;
            const playing = target?.episode.id === ep.id;
            return (
              <Touchable
                key={ep.id}
                kind="row"
                onPress={() => play(ep, resumeAt(lists, 'episode', ep.id))}
                accessibilityRole="button"
                accessibilityLabel={[ep.title, episodeLine(ep), watched ? 'watched' : null, progress !== null ? `${Math.round(progress * 100)} percent watched` : null].filter(Boolean).join(', ')}
                radius={inset ? radius.md : 0}
                containerStyle={inset ? { marginLeft: inset.marginLeft, marginRight: inset.marginRight } : undefined}
                style={({ pressed, hovered, focused }) => [s.episode, { paddingHorizontal: inset ? inset.padX : l.gutter }, (pressed || hovered || (focused && !isTV)) && s.active]}>
                <View>
                  <PlainArt uri={ep.still ?? poster} name={ep.title} id={ep.id} kind="episode" width={scaled(sizes.episodeThumb)} aspectRatio={16 / 9} rounded={radius.sm} showTitle={false} />
                  {progress !== null ? (
                    <View style={s.track}>
                      <View style={[s.fill, { width: `${Math.round(progress * 100)}%` }]} />
                    </View>
                  ) : null}
                  {watched ? (
                    <View style={s.badge}>
                      <Icon name="checkmark" size={iconSize.xs - 2} color={mediaColors.white} weight="bold" />
                    </View>
                  ) : null}
                </View>
                <View style={s.flex}>
                  <Text style={[s.epLabel, playing && { color: c.accent }]}>{episodeLine(ep)}</Text>
                  <Text style={[s.epTitle, scriptStyle(ep.title, s.epTitle)]} numberOfLines={2}>
                    {ep.title}
                  </Text>
                  {ep.plot ? (
                    <Text style={s.epPlot} numberOfLines={isTV ? 1 : 2}>
                      {ep.plot}
                    </Text>
                  ) : null}
                </View>
              </Touchable>
            );
          })}
        </View>
      ) : null}
    </VodDetail>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.bg },
  spinner: { alignSelf: 'flex-start' as const },
  note: { ...font(type.footnote), color: c.text2 },
  episodes: { marginTop: spacing.xl, gap: spacing.xs },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  section: { ...font(type.title3), color: c.text, marginBottom: spacing.xs },
  active: { backgroundColor: c.surface3 },
  episode: { flexDirection: 'row' as const, gap: spacing.md, paddingVertical: spacing.md, alignItems: 'flex-start' as const },
  epLabel: { ...font(type.caption1, { tabular: true }), color: c.text2 },
  epTitle: { ...font(type.headline), color: c.text, marginTop: sizes.tileMetaGap },
  epPlot: { ...font(type.footnote), color: c.text2, marginTop: spacing.xs },
  track: { position: 'absolute' as const, left: sizes.badgeInset, right: sizes.badgeInset, bottom: sizes.badgeInset, height: scaled(sizes.progress), borderRadius: radius.pill, backgroundColor: c.progressTrack, overflow: 'hidden' as const },
  fill: { height: '100%' as const, backgroundColor: mediaColors.white },
  badge: {
    position: 'absolute' as const,
    top: sizes.badgeInset,
    right: sizes.badgeInset,
    width: scaled(sizes.badge),
    height: scaled(sizes.badge),
    borderRadius: radius.pill,
    backgroundColor: mediaColors.badgeFill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
}));
