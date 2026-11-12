import { DEFAULT_PLAYBACK_SETTINGS, readPlaybackSettings } from '../playback';

jest.mock('@/storage/json', () => ({ readJson: jest.fn(() => null), writeJson: jest.fn() }));

describe('readPlaybackSettings', () => {
  it('gives the defaults for nothing saved or bad data', () => {
    expect(readPlaybackSettings(null)).toEqual(DEFAULT_PLAYBACK_SETTINGS);
    expect(readPlaybackSettings('x')).toEqual(DEFAULT_PLAYBACK_SETTINGS);
  });

  it('keeps older saved settings and turns the whole-video load on', () => {
    const old = { wifiBitrate: 20_000_000, cellularBitrate: 4_000_000, skipBackSeconds: 5, skipForwardSeconds: 30, autoplayNext: false, downloadQuality: 720 };
    expect(readPlaybackSettings(old)).toEqual({ ...old, loadWholeVideo: true, loadWholeVideoChosen: false });
  });

  it('ignores an "off" saved before the user chose it', () => {
    expect(readPlaybackSettings({ loadWholeVideo: false }).loadWholeVideo).toBe(true);
  });

  it('keeps the user\'s choice and drops a value of the wrong type', () => {
    expect(readPlaybackSettings({ loadWholeVideo: false, loadWholeVideoChosen: true }).loadWholeVideo).toBe(false);
    expect(readPlaybackSettings({ loadWholeVideo: true, loadWholeVideoChosen: true }).loadWholeVideo).toBe(true);
    expect(readPlaybackSettings({ loadWholeVideo: 'yes', skipBackSeconds: '5' })).toEqual(DEFAULT_PLAYBACK_SETTINGS);
  });
});
