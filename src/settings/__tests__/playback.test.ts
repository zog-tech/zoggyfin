import { DEFAULT_PLAYBACK_SETTINGS, readPlaybackSettings } from '../playback';

jest.mock('@/storage/json', () => ({ readJson: jest.fn(() => null), writeJson: jest.fn() }));

describe('readPlaybackSettings', () => {
  it('gives the defaults for nothing saved or bad data', () => {
    expect(readPlaybackSettings(null)).toEqual(DEFAULT_PLAYBACK_SETTINGS);
    expect(readPlaybackSettings('x')).toEqual(DEFAULT_PLAYBACK_SETTINGS);
  });

  it('keeps older saved settings and turns the whole-video load off', () => {
    const old = { wifiBitrate: 20_000_000, cellularBitrate: 4_000_000, skipBackSeconds: 5, skipForwardSeconds: 30, autoplayNext: false, downloadQuality: 720 };
    expect(readPlaybackSettings(old)).toEqual({ ...old, loadWholeVideo: false });
  });

  it('reads the saved choice and drops a value of the wrong type', () => {
    expect(readPlaybackSettings({ loadWholeVideo: true }).loadWholeVideo).toBe(true);
    expect(readPlaybackSettings({ loadWholeVideo: 'yes', skipBackSeconds: '5' })).toEqual(DEFAULT_PLAYBACK_SETTINGS);
  });
});
