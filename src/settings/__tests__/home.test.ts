import { DEFAULT_HOME_SETTINGS, readHomeSettings } from '../home';

jest.mock('@/storage/json', () => ({ readJson: jest.fn(() => null), writeJson: jest.fn() }));

describe('readHomeSettings', () => {
  it('shows music by default', () => {
    expect(readHomeSettings(null)).toEqual(DEFAULT_HOME_SETTINGS);
    expect(DEFAULT_HOME_SETTINGS.music).toBe(true);
  });
  it('keeps a saved choice and ignores a wrong type', () => {
    expect(readHomeSettings({ music: false }).music).toBe(false);
    expect(readHomeSettings({ music: 'no' }).music).toBe(true);
  });
});
