/**
 * Which hero an item page uses. Pure, so it is unit-tested.
 *
 * - `backdrop`: a tall full-bleed backdrop (movies and shows with a real
 *   backdrop, or a portrait poster).
 * - `wide`: the image at its own 16:9 shape, full width. For items whose best
 *   image is wide (episodes, home videos, web videos with only a wide
 *   thumbnail). A tall crop of a wide image would show a narrow slice of it.
 * - `square`: album and playlist art, centred.
 * - `circle`: artists and people.
 */
import type { BaseItemDto } from '@/api/types';

export type HeroLayout = 'backdrop' | 'wide' | 'square' | 'circle';

const SQUARE = new Set(['MusicAlbum', 'Playlist', 'Audio', 'AudioBook', 'MusicGenre', 'Genre']);
const CIRCLE = new Set(['MusicArtist', 'Person']);

/** Wider than 1.2:1 counts as wide (16:9 is 1.78, a poster is 0.67). */
export const WIDE_RATIO = 1.2;

export function heroLayout(item: BaseItemDto): HeroLayout {
  const type = item.Type ?? '';
  if (SQUARE.has(type)) return 'square';
  if (CIRCLE.has(type)) return 'circle';
  if (type === 'Episode') return 'wide';
  const hasBackdrop = !!item.BackdropImageTags?.length || (!!item.ParentBackdropItemId && !!item.ParentBackdropImageTags?.length);
  if (hasBackdrop) return 'backdrop';
  const ratio = item.PrimaryImageAspectRatio;
  const hasPrimary = !!item.ImageTags?.Primary;
  if (hasPrimary && typeof ratio === 'number' && ratio > WIDE_RATIO) return 'wide';
  if (!hasPrimary && item.ImageTags?.Thumb) return 'wide';
  if (!hasPrimary && (type === 'Video' || type === 'MusicVideo')) return 'wide';
  return 'backdrop';
}

/** Hero height on a phone: min(0.56 × window height, 520) for a backdrop, 16:9 of the width for a wide image. */
export function heroHeight(layout: HeroLayout, width: number, height: number, wideWindow: boolean): number {
  if (layout === 'wide') return Math.round(Math.min(width * (9 / 16), wideWindow ? 520 : height * 0.5));
  if (layout === 'backdrop') return Math.round(wideWindow ? Math.min(420, height * 0.5) : Math.min(height * 0.56, 520));
  return 0;
}

/**
 * The round actions under the hero that fit in one row of `width`. The gap
 * gets smaller first (from the first to the last value of `gaps`). When the
 * row is still too wide, actions marked `spare` (they are also in the More
 * sheet) leave the row, last first. Before the first layout (width 0) all
 * actions show. Pure.
 */
export function fitRoundActions<T extends { spare?: boolean }>(items: readonly T[], width: number, itemWidth: number, gaps: readonly number[]): { items: T[]; gap: number } {
  const all = [...items];
  const gap = gaps[0] ?? 0;
  if (width <= 0 || !gaps.length) return { items: all, gap };
  const fits = (n: number, g: number) => n * itemWidth + Math.max(0, n - 1) * g <= width;
  for (const g of gaps) if (fits(all.length, g)) return { items: all, gap: g };
  const last = gaps[gaps.length - 1] ?? 0;
  const kept = [...all];
  for (let i = kept.length - 1; i >= 0 && !fits(kept.length, last); i--) {
    if (kept[i]?.spare) kept.splice(i, 1);
  }
  return { items: kept, gap: last };
}

/**
 * The scroll offset after which the transparent header of an item page gets
 * a solid bar. Over a media hero (backdrop or wide image) the back and More
 * buttons are white on the top scrim. When the hero scrolls out from under
 * the bar, the bar gets the page colour and the buttons the accent, so the
 * buttons never sit white on a white page or on top of the Play button. A
 * page with no hero gets the solid bar as soon as content moves under it.
 * The scroll handler compares the offset with this number. Pure.
 */
export function solidHeaderAfter(media: boolean, heroH: number, barH: number): number {
  return media ? Math.max(0, heroH - barH) : 1;
}
