import { blocksBrowserMenu, isTextTarget, takesContextMenu } from '../context-menu';

const img = { tagName: 'IMG', isContentEditable: false };
const div = { tagName: 'DIV', isContentEditable: false };
const on = { longPress: true, disabled: false };

describe('takesContextMenu', () => {
  it('takes a right click on a control with a long press (the image inside a tile too)', () => {
    expect(takesContextMenu({ defaultPrevented: false, target: div }, on)).toBe(true);
    expect(takesContextMenu({ defaultPrevented: false, target: img }, on)).toBe(true);
  });

  it('keeps the browser menu on a control with no long press', () => {
    expect(takesContextMenu({ defaultPrevented: false, target: img }, { longPress: false, disabled: false })).toBe(false);
  });

  it('keeps the browser menu on a disabled control', () => {
    expect(takesContextMenu({ defaultPrevented: false, target: div }, { longPress: true, disabled: true })).toBe(false);
  });

  it('lets an inner control take the right click once', () => {
    expect(takesContextMenu({ defaultPrevented: true, target: div }, on)).toBe(false);
  });

  it('keeps the text field menu', () => {
    expect(takesContextMenu({ defaultPrevented: false, target: { tagName: 'INPUT' } }, on)).toBe(false);
    expect(takesContextMenu({ defaultPrevented: false, target: { tagName: 'textarea' } }, on)).toBe(false);
    expect(takesContextMenu({ defaultPrevented: false, target: { tagName: 'DIV', isContentEditable: true } }, on)).toBe(false);
  });
});

describe('isTextTarget', () => {
  it('reads only real targets', () => {
    expect(isTextTarget(null)).toBe(false);
    expect(isTextTarget('INPUT')).toBe(false);
    expect(isTextTarget({})).toBe(false);
    expect(isTextTarget({ tagName: 'SELECT' })).toBe(true);
  });
});

describe('blocksBrowserMenu (Mac app)', () => {
  it('hides the browser menu on an image or a plain view', () => {
    expect(blocksBrowserMenu({ defaultPrevented: false, target: img }, '')).toBe(true);
    expect(blocksBrowserMenu({ defaultPrevented: false, target: div }, '  ')).toBe(true);
  });

  it('keeps it in text fields and on selected text', () => {
    expect(blocksBrowserMenu({ defaultPrevented: false, target: { tagName: 'textarea' } }, '')).toBe(false);
    expect(blocksBrowserMenu({ defaultPrevented: false, target: div }, 'Grey')).toBe(false);
  });

  it('leaves an event that a control took', () => {
    expect(blocksBrowserMenu({ defaultPrevented: true, target: img }, '')).toBe(false);
  });
});
