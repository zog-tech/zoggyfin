/**
 * The tile of an extension page in the Library grid: the page sits with the
 * server's libraries as one more source, like the Live TV tile. It has no
 * server image, so its art is the page's icon on a quiet surface, with the
 * page title and the extension's name in the caption. Which pages get a tile
 * is decided in placement.ts.
 */
import { router } from 'expo-router';
import { type ReactElement, useCallback, useMemo } from 'react';
import { View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { Icon } from '@/components/icon';
import { TileCaption, TileFocusFill } from '@/components/tile-caption';
import { Touchable } from '@/components/touchable';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, radius, useStyles, useTheme } from '@/theme';

import { pageHref, useExtGroup } from './nav';
import { type PlacedPage, pageTileId } from './placement';
import { usePagePlacement } from './use-placement';

type RenderTile = (item: BaseItemDto, tile: { width: number; preferredFocus: boolean }) => ReactElement | null;

/** The Library grid's items with a tile per placed page after them, and a renderer that draws those tiles (else `inner`). */
export function useExtensionPageTiles(views: readonly BaseItemDto[], inner?: RenderTile) {
  const pages = usePagePlacement().library;
  const byId = useMemo(() => new Map(pages.map((p) => [pageTileId(p), p])), [pages]);
  const items = useMemo(
    () => (pages.length ? [...views, ...pages.map((p): BaseItemDto => ({ Id: pageTileId(p), Name: p.title, Type: 'UserView' }))] : [...views]),
    [views, pages],
  );
  const renderTile = useCallback<RenderTile>(
    (item, tile) => {
      const page = item.Id ? byId.get(item.Id) : undefined;
      if (page) return <PageTile page={page} width={tile.width} preferredFocus={tile.preferredFocus} />;
      return inner ? inner(item, tile) : null;
    },
    [byId, inner],
  );
  return { items, renderTile };
}

function PageTile({ page, width, preferredFocus }: { page: PlacedPage; width: number; preferredFocus: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const height = (width * 9) / 16;
  // The Library stack, or Home when the grid shows there (Library replaced on a phone).
  const group = useExtGroup();
  return (
    <Touchable
      kind="tile"
      radius={radius.md}
      // TV: the lit caption strip is the focus mark (design system §7.19).
      ring={!isTV}
      firstFocus={preferredFocus}
      onPress={() => router.push(pageHref(group === '(home)' ? '(home)' : '(library)', page.extId, page.pageId))}
      accessibilityRole="button"
      accessibilityLabel={`${page.title}, ${page.extensionName}`}
      containerStyle={{ width }}>
      <TileFocusFill artHeight={height} radius={radius.md} />
      <View style={[s.art, { width, height }]} accessibilityIgnoresInvertColors>
        {/* In a View: on the web a bare svg can paint under a sibling. */}
        <View>
          <Icon name={page.icon} size={Math.round(width * 0.2)} color={c.accent} />
        </View>
      </View>
      <TileCaption title={page.title} sub={page.extensionName} />
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
    backgroundColor: c.accentSoft,
  },
}));
