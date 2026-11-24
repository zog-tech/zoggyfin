import { spatialScore } from '../web-spatial-nav.web';

jest.mock('@/player/store', () => ({ playerState: () => ({ presentation: 'none' }) }));

/** A DOMRect-like box: Jest has no layout, so build the fields the score reads. */
function box(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => null };
}

describe('spatialScore', () => {
  it('prefers a target in the same column over a nearer centre that is off line', () => {
    // The first cast tile on the series page, an episode tile above it, and a rail entry up and to the left.
    const cast = box(184, 800, 176, 176);
    const episode = box(184, 420, 420, 236);
    const rail = box(40, 660, 48, 48);
    const toEpisode = spatialScore(cast, episode, 'up');
    const toRail = spatialScore(cast, rail, 'up');
    expect(toEpisode).not.toBeNull();
    expect(toRail).not.toBeNull();
    expect(toEpisode!).toBeLessThan(toRail!);
  });

  it('keeps the nearer centre among targets that are both in line', () => {
    const from = box(184, 800, 380, 214);
    const near = box(184, 500, 380, 214);
    const far = box(184, 100, 380, 214);
    expect(spatialScore(from, near, 'down')).toBeNull();
    expect(spatialScore(from, near, 'up')!).toBeLessThan(spatialScore(from, far, 'up')!);
  });

  it('still reaches an off-line target when nothing is in line', () => {
    const tile = box(184, 760, 380, 214);
    const railEntry = box(40, 380, 48, 48);
    expect(spatialScore(tile, railEntry, 'left')).not.toBeNull();
  });

  it('ignores targets behind the current control', () => {
    const from = box(600, 500, 100, 100);
    expect(spatialScore(from, box(400, 500, 100, 100), 'right')).toBeNull();
  });
});
