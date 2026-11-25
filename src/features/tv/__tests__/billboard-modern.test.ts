import { billboardEyebrow, billboardFacts, modernArtBox, modernArtRequest, modernBillboardHeight } from '../billboard-modern';

// The drawing is not under test: only the pure rules of the module (jest hoists the mocks).
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { View: 'View' } }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

const min = (m: number) => m * 60 * 10_000_000;
const strip = (s: string) => s.replace(/[⁨⁩]/g, '');

describe('Modern billboard sizes', () => {
  it('takes 52 % of the height for the box and 75 % for the art, across the whole width', () => {
    expect(modernBillboardHeight(1080)).toBe(562);
    expect(modernArtBox(1920, 1080)).toEqual({ width: 1920, height: 810 });
    expect(modernArtBox(960, 540)).toEqual({ width: 960, height: 405 });
  });

  it('asks for the art in pixels, at most 1920 x 1080, and keeps its shape', () => {
    expect(modernArtRequest({ width: 1920, height: 810 }, 1, false)).toEqual({ width: 1920, height: 810 });
    // Android TV: 960 x 405 dp at 2x.
    expect(modernArtRequest({ width: 960, height: 405 }, 2, false)).toEqual({ width: 1920, height: 810 });
    // A 4K web window: capped.
    expect(modernArtRequest({ width: 1920, height: 810 }, 2, false)).toEqual({ width: 1920, height: 810 });
  });

  it('asks for at most 1280 x 720 in Lite mode', () => {
    expect(modernArtRequest({ width: 960, height: 405 }, 2, true)).toEqual({ width: 1280, height: 540 });
  });
});

describe('billboardEyebrow', () => {
  it('shows the episode number and name in upper case', () => {
    expect(billboardEyebrow({ Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 5, Name: 'The Long Night' })).toBe('S1 · E5 · THE LONG NIGHT');
  });
  it('has none for a movie or a show', () => {
    expect(billboardEyebrow({ Type: 'Movie', Name: 'Sample' })).toBeNull();
    expect(billboardEyebrow({ Type: 'Series', Name: 'Sample' })).toBeNull();
  });
});

describe('billboardFacts', () => {
  it('puts the age rating apart and the time left before the community rating', () => {
    const f = billboardFacts({
      Type: 'Movie',
      OfficialRating: 'TV-14',
      ProductionYear: 2024,
      Genres: ['Sci-Fi', 'Drama', 'Mystery'],
      RunTimeTicks: min(100),
      UserData: { Key: 'k', PlaybackPositionTicks: min(69) },
      CommunityRating: 8.2,
    });
    expect(f.rating && strip(f.rating)).toBe('TV-14');
    expect(f.facts.map(strip)).toEqual(['2024', 'Sci-Fi, Drama', '31 min left', '★ 8.2']);
  });

  it('shows the length when nothing was watched, and no length for a show', () => {
    expect(billboardFacts({ Type: 'Movie', RunTimeTicks: min(95) }).facts.map(strip)).toEqual(['1 h 35 min']);
    expect(billboardFacts({ Type: 'Series', RunTimeTicks: min(45), ProductionYear: 2010 }).facts.map(strip)).toEqual(['2010']);
  });

  it('isolates each fact in its own text direction', () => {
    const f = billboardFacts({ Type: 'Movie', Genres: ['دراما'], ProductionYear: 2001 });
    expect(f.facts).toEqual(['⁨2001⁩', '⁨دراما⁩']);
    expect(f.rating).toBeNull();
  });
});
