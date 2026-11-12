import { genreChipModel, genreOptions } from '../genre-chip';

describe('genreChipModel', () => {
  it('shows a plain Genre chip when none is chosen', () => {
    const m = genreChipModel({ genre: null, genreCount: 5, localOnly: false });
    expect(m).toMatchObject({ visible: true, label: 'Genre', selected: false, showClear: false });
  });
  it('shows the chosen genre as selected with a clear chip', () => {
    const m = genreChipModel({ genre: 'Drama', genreCount: 5, localOnly: false });
    expect(m).toMatchObject({ visible: true, label: 'Drama', selected: true, showClear: true, accessibilityLabel: 'Genre: Drama' });
  });
  it('hides with no genres or when only downloads are searched', () => {
    expect(genreChipModel({ genre: null, genreCount: 0, localOnly: false }).visible).toBe(false);
    expect(genreChipModel({ genre: null, genreCount: 3, localOnly: true }).visible).toBe(false);
  });
});

describe('genreOptions', () => {
  it('puts All genres first', () => {
    expect(genreOptions(['Drama', 'Comedy'])).toEqual([
      { value: null, label: 'All genres' },
      { value: 'Drama', label: 'Drama' },
      { value: 'Comedy', label: 'Comedy' },
    ]);
  });
});
