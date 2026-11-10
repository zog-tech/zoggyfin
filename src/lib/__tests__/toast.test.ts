import { toastLook, toastDuration, toastTakesFocus } from '../toast';

const action = { label: 'Undo', onPress: () => undefined };

describe('toast timing', () => {
  it('keeps phone timing unchanged', () => {
    expect(toastDuration({})).toBe(3200);
    expect(toastDuration({ action })).toBe(6000);
  });

  it('gives an action toast more time on TV', () => {
    expect(toastDuration({ action }, true)).toBe(10_000);
    expect(toastDuration({}, true)).toBe(3200);
  });
});

describe('toast focus (TV)', () => {
  it('focuses an action toast on TV', () => {
    expect(toastTakesFocus({ action }, true, false)).toBe(true);
  });

  it('never takes the focus from a text field', () => {
    expect(toastTakesFocus({ action }, true, true)).toBe(false);
  });

  it('leaves the focus alone off TV and for toasts with no action', () => {
    expect(toastTakesFocus({ action }, false, false)).toBe(false);
    expect(toastTakesFocus({}, true, false)).toBe(false);
  });
});

describe('toast look', () => {
  const c = { text: '#111111', textOnMedia: '#FFFFFF' };

  it('follows the app theme on app screens', () => {
    expect(toastLook(false, c)).toEqual({ glass: 'auto', text: '#111111' });
  });

  it('is dark with light text in a player (over video, in any app theme)', () => {
    expect(toastLook(true, c)).toEqual({ glass: 'dark', text: '#FFFFFF' });
  });
});
