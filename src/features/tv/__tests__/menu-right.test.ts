import { menuRightAction, TOGGLE_FOCUS_GRACE_MS } from '../menu-right';

describe('menuRightAction', () => {
  it('closes the menu from an ordinary item', () => {
    expect(menuRightAction(null, 0, 10_000)).toBe('close');
  });

  it('goes from the cover to the play/pause button', () => {
    expect(menuRightAction('cover', 0, 10_000)).toBe('focus-toggle');
  });

  it('stays when the play/pause button took the focus from this press', () => {
    expect(menuRightAction('toggle', 10_000, 10_000 + TOGGLE_FOCUS_GRACE_MS - 1)).toBe('stay');
  });

  it('closes on a later Right from the play/pause button', () => {
    expect(menuRightAction('toggle', 10_000, 10_000 + TOGGLE_FOCUS_GRACE_MS)).toBe('close');
  });
});
