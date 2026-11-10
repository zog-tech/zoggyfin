import { findOpenPage, type NavState } from '../open-page';

const page = (ext: string, p: string, extra: object = {}) => ({ name: 'ext/[ext]/[page]', params: { ext, page: p, ...extra } });
const panel = { name: 'extension-panel', params: { ext: 'x', panel: 'account' } };
const tabs = (active: string, stack: NavState['routes'] | null, other: Record<string, NavState['routes']> = {}): NavState => {
  const names = ['(home)', '(library)', '(search)', '(ext)'];
  return {
    type: 'tab',
    index: names.indexOf(active),
    routes: names.map((n) => {
      const routes = n === active ? stack : other[n];
      return routes ? { name: n, state: { type: 'stack', index: routes.length - 1, routes } } : { name: n };
    }),
  };
};
const root = (t: NavState): NavState => ({ type: 'stack', index: 1, routes: [{ name: '(tabs)', state: t }, panel] });
const target = { extId: 'x', pageId: 'p' };
const opts = { panelRoute: 'extension-panel' };

describe('findOpenPage', () => {
  it('goes back to the page right under the panel with no pop', () => {
    expect(findOpenPage(root(tabs('(home)', [{ name: 'index' }, page('x', 'p')])), target, opts)).toEqual({ pop: 0 });
  });

  it('pops the screens above the page in the same stack', () => {
    const r = root(tabs('(home)', [{ name: 'index' }, page('x', 'p'), { name: 'settings' }, { name: 'extensions/[id]', params: { id: 'x' } }]));
    expect(findOpenPage(r, target, opts)).toEqual({ pop: 2 });
  });

  it('takes the top-most copy, and skips a "See all" screen and other pages', () => {
    const r = root(tabs('(home)', [page('x', 'p'), page('x', 'p', { section: 'all' }), page('x', 'other'), page('y', 'p')]));
    expect(findOpenPage(r, target, opts)).toEqual({ pop: 3 });
  });

  it('pushes when the page is only in another tab', () => {
    const r = root(tabs('(search)', [{ name: 'search' }], { '(home)': [{ name: 'index' }, page('x', 'p')] }));
    expect(findOpenPage(r, target, opts)).toBeNull();
  });

  it('goes back to the root of the extension tab when the page fills it', () => {
    const slot = { extId: 'x', pageId: 'p' };
    expect(findOpenPage(root(tabs('(ext)', null)), target, { ...opts, tabSlot: slot })).toEqual({ pop: 0 });
    expect(findOpenPage(root(tabs('(ext)', [{ name: 'ext-tab' }, { name: 'ext/[ext]/entry/[entry]' }])), target, { ...opts, tabSlot: slot })).toEqual({ pop: 1 });
    expect(findOpenPage(root(tabs('(ext)', null)), target, { ...opts, tabSlot: { extId: 'x', pageId: 'q' } })).toBeNull();
    expect(findOpenPage(root(tabs('(home)', null)), target, { ...opts, tabSlot: slot })).toBeNull();
  });

  it('reads array params and an empty state', () => {
    const r = root(tabs('(home)', [{ name: 'ext/[ext]/[page]', params: { ext: ['x'], page: ['p'] } }]));
    expect(findOpenPage(r, target, opts)).toEqual({ pop: 0 });
    expect(findOpenPage(undefined, target, opts)).toBeNull();
    expect(findOpenPage({ routes: [] }, target, opts)).toBeNull();
  });
});
