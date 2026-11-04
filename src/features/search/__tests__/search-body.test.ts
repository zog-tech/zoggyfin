import { searchBody } from '../group-results';

const base = { active: true, localOnly: false, pending: false, placeholder: false, error: false, hasData: true, sections: 2 };

describe('searchBody', () => {
  it('shows the start state with no words and no genre', () => {
    expect(searchBody({ ...base, active: false })).toBe('idle');
  });
  it('shows loading rows for the first search', () => {
    expect(searchBody({ ...base, pending: true, hasData: false, sections: 0 })).toBe('loading');
  });
  it('does not flash "No results" while a new search loads after an empty one', () => {
    expect(searchBody({ ...base, placeholder: true, sections: 0 })).toBe('loading');
  });
  it('keeps the last results on screen while a new search loads', () => {
    expect(searchBody({ ...base, placeholder: true, sections: 3 })).toBe('results');
  });
  it('shows "No results" when the search ends with nothing', () => {
    expect(searchBody({ ...base, sections: 0 })).toBe('empty');
  });
  it('shows the error only when there is nothing to show', () => {
    expect(searchBody({ ...base, error: true, hasData: false, sections: 0 })).toBe('error');
    expect(searchBody({ ...base, error: true })).toBe('results');
  });
  it('searches downloads at once when offline', () => {
    expect(searchBody({ ...base, localOnly: true, pending: true, sections: 0 })).toBe('empty');
    expect(searchBody({ ...base, localOnly: true, pending: true, sections: 1 })).toBe('results');
  });
});
