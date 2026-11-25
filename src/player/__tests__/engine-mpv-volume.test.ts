import { MpvEngine } from '../engine-mpv';

// jest.mock is hoisted over the import; the factory reads mockSet lazily.
const mockSet = jest.fn((_name: string, _value: unknown) => Promise.resolve());

jest.mock('@/platform/desktop', () => ({
  mpv: { set: (name: string, value: unknown) => mockSet(name, value), command: jest.fn(() => Promise.resolve()), get: jest.fn(), subscribe: jest.fn(() => () => undefined) },
  nowPlaying: { update: jest.fn(() => Promise.resolve()), clear: jest.fn(() => Promise.resolve()), onRemote: jest.fn(() => () => undefined) },
  desktopWindow: { toggleFullscreen: jest.fn() },
  localPath: (u: string) => u,
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('libmpv volume', () => {
  beforeEach(() => mockSet.mockClear());

  it('sets the volume property in percent, once per change', async () => {
    const e = new MpvEngine();
    e.setVolume(1);
    e.setVolume(0.5);
    e.setVolume(0.5);
    e.setVolume(0);
    await flush();
    const calls = mockSet.mock.calls.filter(([name]) => name === 'volume').map(([, v]) => v);
    // The first level always goes: libmpv may have kept another volume from an earlier page.
    expect(calls).toEqual([100, 50, 0]);
  });
});
