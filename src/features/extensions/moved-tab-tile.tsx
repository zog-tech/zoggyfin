/**
 * Where a replaced tab stays one tap away on a phone ("On this phone",
 * placement.ts). An extension page that takes the place of Music,
 * Downloads or Search leaves a neutral tile for that tab in the Library
 * grid, like the Live TV tile: the tab's icon and name. It opens the tab's
 * first screen in the Library stack (`(library)/more/`). When the page
 * takes the place of Library itself, the Home header shows a Library
 * button instead (`LibraryHeaderButton`), which opens the grid in the Home
 * stack. The routes are in `lib/tab-destination.ts`. The Downloads tile
 * shows the Downloads tab badge (`downloads/badge.ts`): the tab is hidden,
 * so the tile is where active and failed downloads stay visible. TV has no
 * downloads and no badge.
 */
import { router, type Href } from 'expo-router';
import { type ReactElement, useCallback, useMemo } from 'react';
import { Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { Icon } from '@/components/icon';
import { TileCaption, TileFocusFill } from '@/components/tile-caption';
import { Touchable } from '@/components/touchable';
import { useDownloadsBadge } from '@/downloads/use-badge';
import { destinationOf, type ReplaceableTab, TAB_INFO, tabRootHref } from '@/lib/tab-destination';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, mediaColors, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

import { usePagePlacement, useReplacedTab } from './use-placement';

type RenderTile = (item: BaseItemDto, tile: { width: number; preferredFocus: boolean }) => ReactElement | null;

/** The Id of a moved tab's tile in the Library grid. Not a Jellyfin Id. */
export const MOVED_TAB_TILE_ID = 'zoggyfin.tab';

/** The Library grid's items with the tile of a replaced tab (Music, Downloads, Search), and its renderer (else `inner`). */
export function useMovedTabTile(views: readonly BaseItemDto[], inner?: RenderTile) {
  const placement = usePagePlacement();
  const moved = placement.replaces && placement.replaces !== '(library)' ? placement.replaces : null;
  const items = useMemo(
    () => (moved ? [...views, { Id: MOVED_TAB_TILE_ID, Name: TAB_INFO[moved].title, Type: 'UserView' } as BaseItemDto] : [...views]),
    [views, moved],
  );
  const by = placement.tab?.title ?? null;
  const renderTile = useCallback<RenderTile>(
    (item, tile) => {
      if (moved && item.Id === MOVED_TAB_TILE_ID) return <MovedTabTile tab={moved} by={by} width={tile.width} preferredFocus={tile.preferredFocus} />;
      return inner ? inner(item, tile) : null;
    },
    [moved, by, inner],
  );
  return { items, renderTile };
}

function MovedTabTile({ tab, by, width, preferredFocus }: { tab: ReplaceableTab; by: string | null; width: number; preferredFocus: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const info = TAB_INFO[tab];
  const height = (width * 9) / 16;
  const sub = by ? `Tab bar shows ${by}` : undefined;
  const downloads = useDownloadsBadge();
  const badge = tab === '(saved)' && !isTV ? downloads : null;
  const label = badge === null ? info.title : badge === '!' ? `${info.title}, a download failed` : `${info.title}, ${badge} active`;
  return (
    <Touchable
      kind="tile"
      radius={radius.md}
      ring={!isTV}
      firstFocus={preferredFocus}
      onPress={() => router.push(tabRootHref(destinationOf(tab), tab) as Href)}
      accessibilityRole="button"
      accessibilityLabel={label}
      containerStyle={{ width }}>
      <TileFocusFill artHeight={height} radius={radius.md} />
      <View style={[s.art, { width, height }]} accessibilityIgnoresInvertColors>
        {/* In a View: on the web a bare svg can paint under a sibling. */}
        <View>
          <Icon name={info.icon} size={Math.round(width * 0.2)} color={c.text2} />
        </View>
        {badge !== null ? (
          <View style={s.badge}>
            <Text style={s.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <TileCaption title={info.title} sub={sub} />
    </Touchable>
  );
}

/** The Home header button that opens the Library grid while an extension tab takes the place of Library. Null otherwise. */
export function LibraryHeaderButton() {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const replaced = useReplacedTab();
  if (replaced !== '(library)') return null;
  return (
    <Touchable
      onPress={() => router.push(tabRootHref('library', replaced) as Href)}
      radius={16}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Library"
      accessibilityHint="Opens your libraries"
      style={s.headerButton}>
      <Icon name={TAB_INFO['(library)'].icon} size={16} color={c.accent} weight="semibold" />
      <Text style={s.headerLabel}>Library</Text>
    </Touchable>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  art: {
    borderRadius: radius.md,
    borderCurve: 'continuous' as const,
    overflow: 'hidden' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: c.surface2,
  },
  /** The tile badge of the design system (`components/tile.tsx`). */
  badge: {
    position: 'absolute' as const,
    top: sizes.badgeInset,
    right: sizes.badgeInset,
    minWidth: scaled(sizes.badge),
    height: scaled(sizes.badge),
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: mediaColors.badgeFill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  badgeText: { ...font(type.caption2, { tabular: true }), color: mediaColors.white },
  headerButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    minHeight: 32,
    borderRadius: radius.pill,
    backgroundColor: c.accentSoft,
  },
  headerLabel: { ...font(type.subheadline), fontWeight: '600' as const, color: c.accent },
}));
