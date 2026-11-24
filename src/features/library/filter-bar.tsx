import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useFilters } from '@/api/queries';
import { Chip, chipRowTV } from '@/components/chip';
import { OptionSheet } from '@/components/option-sheet';
import { TV_TOOLBAR_GAP, TvToolbarRow } from '@/components/tv-page-header';
import { TvToolbarItem } from '@/features/tv/tv-button';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { spacing, useLayout } from '@/theme';

import { hasActiveFilters, SORT_OPTIONS, toggle, useFiltersFor, useLibraryFilters } from './filter-store';

type SheetName = 'sort' | 'played' | 'genre' | 'year' | null;

/** TV Modern: the filters are a one-line text toolbar, never chips (design system §7.22). */
const MODERN = isTV && isTvModern;

/** A multiple choice as a toolbar value: "Any", the one choice, or the first and how many more. */
function choiceValue(values: readonly (string | number)[]): string {
  if (values.length === 0) return 'Any';
  return values.length === 1 ? String(values[0]) : `${values[0]} +${values.length - 1}`;
}

/** Sort and filter chips for a library grid (a text toolbar in the TV Modern look). */
export function FilterBar({ libraryId, itemTypes }: { libraryId: string; itemTypes: readonly string[] }) {
  const f = useFiltersFor(libraryId);
  const update = useLibraryFilters((s) => s.update);
  const reset = useLibraryFilters((s) => s.reset);
  const [sheet, setSheet] = useState<SheetName>(null);
  const l = useLayout();
  const filters = useFilters(libraryId, itemTypes);

  const sortLabel = SORT_OPTIONS.find((o) => o.value === f.sortBy)?.label ?? 'Name';
  const playedLabel = f.played === 'played' ? 'Played' : f.played === 'unplayed' ? 'Unplayed' : 'All';

  return (
    <>
      {MODERN ? (
        <View style={styles.toolbar}>
          <TvToolbarRow inset={l.gutter}>
            <TvToolbarItem label="Sort" value={sortLabel} onPress={() => setSheet('sort')} />
            <TvToolbarItem
              label="Order"
              value={f.sortOrder === 'Ascending' ? 'Ascending' : 'Descending'}
              onPress={() => update(libraryId, { sortOrder: f.sortOrder === 'Ascending' ? 'Descending' : 'Ascending' })}
            />
            <TvToolbarItem label="Show" value={playedLabel} onPress={() => setSheet('played')} />
            <TvToolbarItem value="Favourites" on={f.favorites} onPress={() => update(libraryId, { favorites: !f.favorites })} />
            <TvToolbarItem label="Genre" value={choiceValue(f.genres)} onPress={() => setSheet('genre')} />
            <TvToolbarItem label="Year" value={choiceValue(f.years)} onPress={() => setSheet('year')} />
            {hasActiveFilters(f) ? <TvToolbarItem value="Clear filters" on={false} onPress={() => reset(libraryId)} /> : null}
          </TvToolbarRow>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.bar, { paddingHorizontal: l.gutter }, chipRowTV()]}
          style={[styles.scroll, { marginHorizontal: -l.gutter }]}>
          <Chip
            label={sortLabel}
            icon="arrow.up.arrow.down"
            onPress={() => setSheet('sort')}
            accessibilityLabel={`Sort by ${sortLabel}, ${f.sortOrder === 'Ascending' ? 'ascending' : 'descending'}`}
          />
          <Chip
            label={f.sortOrder === 'Ascending' ? 'Ascending' : 'Descending'}
            onPress={() => update(libraryId, { sortOrder: f.sortOrder === 'Ascending' ? 'Descending' : 'Ascending' })}
          />
          <Chip label={playedLabel} selected={f.played !== 'all'} onPress={() => setSheet('played')} />
          <Chip label="Favourites" selected={f.favorites} onPress={() => update(libraryId, { favorites: !f.favorites })} />
          <Chip label={f.genres.length ? `Genres · ${f.genres.length}` : 'Genre'} selected={f.genres.length > 0} onPress={() => setSheet('genre')} />
          <Chip label={f.years.length ? `Years · ${f.years.length}` : 'Year'} selected={f.years.length > 0} onPress={() => setSheet('year')} />
          {hasActiveFilters(f) ? <Chip label="Clear" icon="xmark" onPress={() => reset(libraryId)} accessibilityLabel="Clear filters" /> : null}
        </ScrollView>
      )}

      <OptionSheet
        visible={sheet === 'sort'}
        title="Sort by"
        options={SORT_OPTIONS}
        selected={[f.sortBy]}
        onSelect={(v) => update(libraryId, { sortBy: v })}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'played'}
        title="Show"
        options={[
          { value: 'all' as const, label: 'All' },
          { value: 'unplayed' as const, label: 'Unplayed' },
          { value: 'played' as const, label: 'Played' },
        ]}
        selected={[f.played]}
        onSelect={(v) => update(libraryId, { played: v })}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'genre'}
        title="Genres"
        multiple
        options={(filters.data?.Genres ?? []).map((g) => ({ value: g, label: g }))}
        selected={f.genres}
        onSelect={(v) => update(libraryId, { genres: toggle(f.genres, v) })}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'year'}
        title="Years"
        multiple
        options={[...(filters.data?.Years ?? [])].sort((a, b) => b - a).map((y) => ({ value: y, label: String(y) }))}
        selected={f.years}
        onSelect={(v) => update(libraryId, { years: toggle(f.years, v) })}
        onClose={() => setSheet(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { marginBottom: spacing.md, flexGrow: 0 },
  bar: { gap: spacing.sm, paddingVertical: spacing.xs },
  toolbar: { marginBottom: TV_TOOLBAR_GAP },
});
