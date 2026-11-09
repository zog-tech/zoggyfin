import {
  beginAdd,
  beginRename,
  closeAddSheet,
  closeRenameSheet,
  endAdd,
  endRename,
  openAddToPlaylist,
  openRenamePlaylist,
  startNaming,
  useSheets,
} from '../sheet-store';

const a = { Id: 'a', Name: 'A' };
const b = { Id: 'b', Name: 'B' };
const add = () => useSheets.getState().add;

beforeEach(() => {
  closeAddSheet();
  closeRenameSheet();
});

describe('add sheet', () => {
  it('opens only for items with an Id', () => {
    openAddToPlaylist({ Name: 'no id' });
    expect(add().name).toBe('closed');
    openAddToPlaylist(a);
    expect(add()).toMatchObject({ name: 'choosing', items: [a] });
  });

  it('closes after a successful submit', () => {
    openAddToPlaylist(a);
    const run = beginAdd('p1');
    expect(add()).toMatchObject({ name: 'submitting', target: 'p1' });
    expect(endAdd(run!.token, true)).toBe(true);
    expect(add().name).toBe('closed');
  });

  it('goes back to the phase before the submit after a failure', () => {
    openAddToPlaylist(a);
    startNaming();
    const run = beginAdd('new');
    expect(endAdd(run!.token, false)).toBe(true);
    expect(add()).toMatchObject({ name: 'naming', items: [a] });
  });

  it('refuses a second submit while one runs', () => {
    openAddToPlaylist(a);
    expect(beginAdd('p1')).not.toBeNull();
    expect(beginAdd('p2')).toBeNull();
    startNaming();
    expect(add().name).toBe('submitting');
  });

  it('a late result after Cancel does not touch the next open', () => {
    openAddToPlaylist(a);
    const old = beginAdd('p1')!;
    closeAddSheet();
    openAddToPlaylist(b);
    const now = add();
    expect(endAdd(old.token, true)).toBe(false);
    expect(add()).toBe(now);
    expect(add()).toMatchObject({ name: 'choosing', items: [b] });
  });

  it('a late failure after Cancel does not open the sheet again', () => {
    openAddToPlaylist(a);
    const old = beginAdd('p1')!;
    closeAddSheet();
    expect(endAdd(old.token, false)).toBe(false);
    expect(add().name).toBe('closed');
  });
});

describe('rename sheet', () => {
  it('saves, and a late save does not close a newer rename', () => {
    openRenamePlaylist(a);
    const old = beginRename()!;
    expect(beginRename()).toBeNull();
    closeRenameSheet();
    openRenamePlaylist(b);
    expect(endRename(old.token, true)).toBe(false);
    expect(useSheets.getState().rename).toMatchObject({ name: 'editing', playlist: b });
    const run = beginRename()!;
    expect(endRename(run.token, true)).toBe(true);
    expect(useSheets.getState().rename.name).toBe('closed');
  });
});
