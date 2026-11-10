/**
 * `playMedia`: extension media opens the video player, and refuses in a
 * watch-together session with a message, like IPTV films.
 */
const mockNavigate = jest.fn();
const mockToast = jest.fn();
const mockPlayExternal = jest.fn(() => Promise.resolve());
const mockRequest = jest.fn();
const mockRouter = { active: false };

jest.mock('expo-router', () => ({ router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true, navigate: (p: string) => mockNavigate(p) } }));
jest.mock('@/auth/session-store', () => ({ useSessionStore: { getState: () => ({ session: { serverId: 's' } }) } }));
jest.mock('@/lib/toast', () => ({ toast: (...a: unknown[]) => mockToast(...a) }));
jest.mock('../session', () => ({ videoSession: () => ({ playExternal: mockPlayExternal, stop: jest.fn() }) }));
jest.mock('../audio/session', () => ({ audioSession: () => ({ stopForVideo: jest.fn() }) }));
jest.mock('../play-router', () => ({ playRouter: { get active() { return mockRouter.active; }, route: (r: unknown) => r, queueLock: () => null } }));
jest.mock('../control-gate', () => ({ controlGate: { active: false } }));
jest.mock('@/extensions/media/play', () => ({ extensionPlayRequest: (r: unknown) => mockRequest(r) }));

// eslint-disable-next-line import/first
import { playMedia, usePlayer } from '../index';

const ref = { extension: 'org.example.media', mediaId: 'e1', playback: 'https://media.example.org/api/e1/play', title: 'An entry' };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  mockRouter.active = false;
});

it('plays the request the adapter builds and opens the player', async () => {
  const request = { items: [], index: 0, source: {} };
  mockRequest.mockReturnValue({ request });
  usePlayer().playMedia(ref);
  await flush();
  expect(mockRequest).toHaveBeenCalledWith(ref);
  expect(mockPlayExternal).toHaveBeenCalledWith(request);
  expect(mockNavigate).toHaveBeenCalledWith('/player');
});

it('refuses in a watch-together session and says so', async () => {
  mockRouter.active = true;
  playMedia(ref);
  await flush();
  expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/watch-together session/), expect.anything());
  expect(mockRequest).not.toHaveBeenCalled();
  expect(mockPlayExternal).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('shows the adapter reason and does not open the player', async () => {
  mockRequest.mockReturnValue({ error: 'This extension cannot play media.' });
  playMedia(ref);
  await flush();
  expect(mockToast).toHaveBeenCalledWith('This extension cannot play media.', expect.anything());
  expect(mockNavigate).not.toHaveBeenCalled();
});
