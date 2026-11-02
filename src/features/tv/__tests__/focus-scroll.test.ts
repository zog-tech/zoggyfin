import { focusScrollOffset } from '../focus-scroll';

// A 540 dp page with 2000 dp of content and an 80 dp margin.
const page = { viewport: 540, content: 2000, margin: 80 };

describe('focusScrollOffset', () => {
  it('stays put while the view shows with its margin', () => {
    expect(focusScrollOffset({ ...page, offset: 300, top: 500, bottom: 600 })).toBe(300);
  });

  it('moves down just enough to keep the margin under the view', () => {
    expect(focusScrollOffset({ ...page, offset: 300, top: 700, bottom: 800 })).toBe(800 - 540 + 80);
  });

  it('moves up just enough to keep the margin over the view', () => {
    expect(focusScrollOffset({ ...page, offset: 1000, top: 900, bottom: 1000 })).toBe(820);
  });

  it('goes back to the top near it, so the title above the first control shows', () => {
    expect(focusScrollOffset({ ...page, offset: 400, top: 340, bottom: 400 })).toBe(0);
  });

  it('goes to the end near it, so text after the last control shows', () => {
    // max = 1460: the view at 1600 keeps its top margin there.
    expect(focusScrollOffset({ ...page, offset: 1100, top: 1600, bottom: 1700 })).toBe(1460);
  });

  it('never scrolls past the end of the content', () => {
    expect(focusScrollOffset({ ...page, offset: 1460, top: 1900, bottom: 2000 })).toBe(1460);
    expect(focusScrollOffset({ ...page, content: 400, offset: 0, top: 300, bottom: 390 })).toBe(0);
  });

  it('shows the top of a view taller than the page', () => {
    expect(focusScrollOffset({ ...page, offset: 0, top: 600, bottom: 1200 })).toBe(520);
  });
});
