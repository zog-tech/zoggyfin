/**
 * The store per account: the move from `extensions.v1` on the first bind,
 * two accounts with their own lists, and secrets that stay where they are.
 */
const mockKv = new Map<string, string>();
const mockSecure = new Map<string, string>();

jest.mock('@/storage/json', () => ({
  readJson: (k: string, fb: unknown) => {
    const v = mockKv.get(k);
    if (v === undefined) return fb;
    try {
      return JSON.parse(v);
    } catch {
      return fb;
    }
  },
  writeJson: (k: string, v: unknown) => void mockKv.set(k, JSON.stringify(v)),
}));
jest.mock('@/storage/secure', () => ({
  secureStore: { get: (k: string) => mockSecure.get(k) ?? null, set: (k: string, v: string) => void mockSecure.set(k, v), remove: (k: string) => void mockSecure.delete(k) },
}));

// eslint-disable-next-line import/first
import { accountExtensions, bindAccount, extensionsState, getExtension, removeExtension, resetExtensionsForTests, setEnabled, setSkipMode, setTabPage, setValue, upsertExtension } from '../store';
// eslint-disable-next-line import/first
import { manifest } from '../test-utils/fixtures';
// eslint-disable-next-line import/first
import type { InstalledExtension } from '../types';

const A = 'srv1.userA';
const B = 'srv1.userB';

const ext = (id: string, at = 1): InstalledExtension => ({ manifestUrl: `http://192.0.2.10/${id}.json`, manifest: { ...manifest(), id }, enabled: true, grants: { itemPath: false, jellyfinToken: false }, installedAt: at });
const ids = () => extensionsState().list.map((e) => e.manifest.id);
const saved = () => JSON.parse(mockKv.get('extensions.v2') ?? 'null');

beforeEach(() => {
  mockKv.clear();
  mockSecure.clear();
  resetExtensionsForTests();
});

describe('extension store per account', () => {
  it('moves the device list to every saved account on the first bind, and keeps v1 and the secrets', () => {
    const v1 = JSON.stringify({ list: [ext('com.example.hello')], values: { 'com.example.hello': { apiKey: '•' } }, auto: {}, options: {} });
    mockKv.set('extensions.v1', v1);
    mockSecure.set('ext.com.example.hello.apiKey', 'secret');
    bindAccount(A, [A, B]);
    expect(ids()).toEqual(['com.example.hello']);
    expect(Object.keys(saved().accounts)).toEqual([A, B]);
    expect(mockKv.get('extensions.v1')).toBe(v1);
    expect(mockSecure.get('ext.com.example.hello.apiKey')).toBe('secret');
    bindAccount(B, [A, B]);
    expect(ids()).toEqual(['com.example.hello']);
    expect(extensionsState().values['com.example.hello']).toEqual({ apiKey: '•' });
  });

  it('survives a v1 value that is not JSON', () => {
    mockKv.set('extensions.v1', '{not json');
    expect(() => bindAccount(A, [A])).not.toThrow();
    expect(ids()).toEqual([]);
  });

  it('keeps a list per account', () => {
    bindAccount(A, [A, B]);
    upsertExtension(ext('one'));
    bindAccount(B, [A, B]);
    expect(ids()).toEqual([]);
    upsertExtension(ext('two'));
    setEnabled('two', false);
    bindAccount(A, [A, B]);
    expect(ids()).toEqual(['one']);
    expect(accountExtensions(B).list.map((e) => [e.manifest.id, e.enabled])).toEqual([['two', false]]);
    // A restart reads both lists back.
    resetExtensionsForTests();
    bindAccount(B, [A, B]);
    expect(ids()).toEqual(['two']);
    expect(getExtension('one')).toBeUndefined();
  });

  it('shows nothing and saves nothing when signed out', () => {
    bindAccount(A, [A]);
    upsertExtension(ext('one'));
    bindAccount(null, [A]);
    expect(ids()).toEqual([]);
    upsertExtension(ext('stray'));
    expect(saved().accounts[A].list.map((e: InstalledExtension) => e.manifest.id)).toEqual(['one']);
  });

  it('removes a secret only when no other account has the extension', () => {
    const field = manifest().contributes.settings!.find((f) => f.key === 'apiKey')!;
    bindAccount(A, [A, B]);
    upsertExtension(ext('com.example.hello'));
    setValue('com.example.hello', field, 'secret');
    bindAccount(B, [A, B]);
    upsertExtension(ext('com.example.hello'));
    removeExtension('com.example.hello');
    expect(mockSecure.get('ext.com.example.hello.apiKey')).toBe('secret');
    bindAccount(A, [A, B]);
    removeExtension('com.example.hello');
    expect(mockSecure.has('ext.com.example.hello.apiKey')).toBe(false);
  });

  it('saves the tab page and the skip choices with the account', () => {
    bindAccount(A, [A]);
    upsertExtension(ext('one'));
    setTabPage('one', 'main');
    setSkipMode('one', 'promo', 'auto');
    expect(getExtension('one')?.tab).toBe('main');
    setTabPage('one', undefined);
    expect(getExtension('one')).not.toHaveProperty('tab');
    expect(saved().accounts[A].skip).toEqual({ 'one:promo': 'auto' });
    removeExtension('one');
    expect(extensionsState().skip).toEqual({});
  });
});
