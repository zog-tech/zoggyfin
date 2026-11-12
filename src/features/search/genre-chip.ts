/**
 * What the genre chip at the end of the Search filter row shows. Pure, so it is unit-tested.
 * The chip is hidden with no genres or with only downloads to search.
 */
export interface GenreChipModel {
  visible: boolean;
  label: string;
  selected: boolean;
  /** The chevron says the chip opens a list; a chosen genre also gets a clear chip beside it. */
  showClear: boolean;
  accessibilityLabel: string;
}

export const ALL_GENRES = 'All genres';

export function genreChipModel({ genre, genreCount, localOnly }: { genre: string | null; genreCount: number; localOnly: boolean }): GenreChipModel {
  const visible = genreCount > 0 && !localOnly;
  if (!genre) return { visible, label: 'Genre', selected: false, showClear: false, accessibilityLabel: 'Genre: all genres' };
  return { visible, label: genre, selected: true, showClear: true, accessibilityLabel: `Genre: ${genre}` };
}

/** The picker options: "All genres" (null) first, then every genre name. */
export function genreOptions(names: readonly string[]): { value: string | null; label: string }[] {
  return [{ value: null, label: ALL_GENRES }, ...names.map((n) => ({ value: n as string | null, label: n }))];
}
