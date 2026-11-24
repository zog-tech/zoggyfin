import { DEFAULT_PLAYBACK_SETTINGS, readPlaybackSettings } from '../playback';

jest.mock('@/storage/json', () => ({ readJson: jest.fn(() => null), writeJson: jest.fn() }));

describe('readPlaybackSettings', () => {
  it('gives the defaults for nothing saved or bad data', () => {
    expect(readPlaybackSettings(null)).toEqual(DEFAULT_PLAYBACK_SETTINGS);
    expect(readPlaybackSettings('x')).toEqual(DEFAULT_PLAYBACK_SETTINGS);
  });

  it('keeps older saved settings and turns the whole-video load on', () => {
    const old = { wifiBitrate: 20_000_000, cellularBitrate: 4_000_000, skipBackSeconds: 5, skipForwardSeconds: 30, autoplayNext: false, downloadQuality: 720 };
    expect(readPlaybackSettings(old)).toEqual({ ...old, loadWholeVideo: true, loadWholeVideoChosen: false, previews: true, liteMode: 'auto', autoplaySimilar: true, fadeSeconds: 0, holdSeekTop: 240 });
  });

  it('ignores an "off" saved before the user chose it', () => {
    expect(readPlaybackSettings({ loadWholeVideo: false }).loadWholeVideo).toBe(true);
  });

  it('keeps the user\'s choice and drops a value of the wrong type', () => {
    expect(readPlaybackSettings({ loadWholeVideo: false, loadWholeVideoChosen: true }).loadWholeVideo).toBe(false);
    expect(readPlaybackSettings({ loadWholeVideo: true, loadWholeVideoChosen: true }).loadWholeVideo).toBe(true);
    expect(readPlaybackSettings({ loadWholeVideo: 'yes', skipBackSeconds: '5' })).toEqual(DEFAULT_PLAYBACK_SETTINGS);
  });

  it('keeps a Lite mode choice and drops an unknown one', () => {
    expect(readPlaybackSettings({ liteMode: 'off' }).liteMode).toBe('off');
    expect(readPlaybackSettings({ liteMode: 'turbo' }).liteMode).toBe('auto');
  });

  it('keeps a known fade length and drops an unknown one', () => {
    expect(readPlaybackSettings({ fadeSeconds: 6 }).fadeSeconds).toBe(6);
    expect(readPlaybackSettings({ fadeSeconds: 7 }).fadeSeconds).toBe(0);
    expect(readPlaybackSettings({ autoplaySimilar: false }).autoplaySimilar).toBe(false);
  });

  it('keeps a known hold-to-seek top speed and drops an unknown one', () => {
    expect(readPlaybackSettings({ holdSeekTop: 60 }).holdSeekTop).toBe(60);
    expect(readPlaybackSettings({ holdSeekTop: 12 }).holdSeekTop).toBe(240);
    expect(readPlaybackSettings({}).holdSeekTop).toBe(240);
  });
});
