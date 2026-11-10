jest.mock('@/storage/kv', () => {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getString: (k: string) => map.get(k),
      set: (k: string, v: string) => void map.set(k, v),
      remove: (k: string) => void map.delete(k),
    },
  };
});

// eslint-disable-next-line import/first
import { onSkipChoicesChange, replaceSkipChoices, setSkipMode, skipChoices } from '../playback';
// eslint-disable-next-line import/first
import { EMPTY_SKIP_SETTINGS, migrateSkipSettings, skipKey, skipModeFor, withSkipMode } from '../skip-modes';

describe('skip modes (pure)', () => {
  it('reads nothing, damaged values and a list as empty', () => {
    expect(migrateSkipSettings(undefined)).toEqual(EMPTY_SKIP_SETTINGS);
    expect(migrateSkipSettings('auto')).toEqual(EMPTY_SKIP_SETTINGS);
    expect(migrateSkipSettings([])).toEqual(EMPTY_SKIP_SETTINGS);
    expect(migrateSkipSettings({ version: 1, modes: [] })).toEqual(EMPTY_SKIP_SETTINGS);
  });

  it('keeps the valid entries of a version 1 value, and of a newer one', () => {
    const raw = {
      version: 1,
      modes: {
        'jellyfin:intro': { mode: 'auto', at: 5 },
        'org.example.media:promo': { mode: 'off' },
        'no-scope': { mode: 'auto', at: 1 },
        'jellyfin:outro': { mode: 'sometimes', at: 1 },
        'jellyfin:recap': null,
      },
    };
    expect(migrateSkipSettings(raw)).toEqual({ version: 1, modes: { 'jellyfin:intro': { mode: 'auto', at: 5 }, 'org.example.media:promo': { mode: 'off', at: 0 } } });
    expect(migrateSkipSettings({ ...raw, version: 7 }).modes['jellyfin:intro']).toEqual({ mode: 'auto', at: 5 });
  });

  it('the user choice wins, then the manifest default, then ask', () => {
    const modes = { 'org.example.media:promo': { mode: 'off' as const, at: 1 } };
    expect(skipModeFor(modes, 'org.example.media', 'promo', { promo: 'auto' })).toBe('off');
    expect(skipModeFor({}, 'org.example.media', 'promo', { promo: 'auto' })).toBe('auto');
    expect(skipModeFor({}, 'org.example.media', 'other', { promo: 'auto' })).toBe('ask');
    expect(skipModeFor({}, 'jellyfin', 'intro')).toBe('ask');
  });

  it('sets and clears a choice; the same object when nothing changes', () => {
    const one = withSkipMode(EMPTY_SKIP_SETTINGS, skipKey('jellyfin', 'intro'), 'auto', 10);
    expect(one.modes).toEqual({ 'jellyfin:intro': { mode: 'auto', at: 10 } });
    expect(withSkipMode(one, 'jellyfin:intro', 'auto', 20)).toBe(one);
    expect(withSkipMode(one, 'bad', 'auto', 20)).toBe(one);
    expect(withSkipMode(one, 'jellyfin:intro', null, 20)).toEqual(EMPTY_SKIP_SETTINGS);
    expect(withSkipMode(EMPTY_SKIP_SETTINGS, 'jellyfin:intro', null, 20)).toBe(EMPTY_SKIP_SETTINGS);
  });
});

const mockKv = (jest.requireMock('@/storage/kv') as { map: Map<string, string> }).map;

describe('skip modes store', () => {
  it('saves versioned, tells listeners, and takes a synced set', () => {
    const seen: string[][] = [];
    const off = onSkipChoicesChange((m) => seen.push(Object.keys(m)));
    setSkipMode('org.example.media:promo', 'auto', 100);
    expect(skipChoices()).toEqual({ 'org.example.media:promo': { mode: 'auto', at: 100 } });
    expect(JSON.parse(mockKv.get('settings.skip') ?? '{}')).toEqual({ version: 1, modes: { 'org.example.media:promo': { mode: 'auto', at: 100 } } });
    setSkipMode('org.example.media:promo', 'auto', 200);
    replaceSkipChoices({ 'jellyfin:intro': { mode: 'off', at: 3 } });
    setSkipMode('jellyfin:intro', null);
    off();
    setSkipMode('jellyfin:recap', 'auto');
    expect(seen).toEqual([['org.example.media:promo'], ['jellyfin:intro'], []]);
  });
});
