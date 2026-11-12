import { canSwipeDismiss, shouldDismiss, showsCloseButton } from '../mini-player-rules';

const base = { inline: false, isAudio: true, web: false, tv: false };

describe('mini player rules', () => {
  it('hides the close button for audio on a phone', () => {
    expect(showsCloseButton(base)).toBe(false);
    expect(canSwipeDismiss(base)).toBe(true);
  });
  it('keeps the button for video, web and TV', () => {
    expect(showsCloseButton({ ...base, isAudio: false })).toBe(true);
    expect(showsCloseButton({ ...base, web: true })).toBe(true);
    expect(showsCloseButton({ ...base, tv: true })).toBe(true);
    expect(canSwipeDismiss({ isAudio: true, web: true, tv: false })).toBe(false);
    expect(canSwipeDismiss({ isAudio: false, web: false, tv: false })).toBe(false);
  });
  it('never shows the button inline', () => {
    expect(showsCloseButton({ ...base, inline: true, isAudio: false })).toBe(false);
  });
  it('dismisses on distance or fling', () => {
    expect(shouldDismiss(20, 100)).toBe(false);
    expect(shouldDismiss(80, 0)).toBe(true);
    expect(shouldDismiss(10, 900)).toBe(true);
  });
});
