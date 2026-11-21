import { pickGroup } from '../own-tab';

const GROUPS = ['(home)', '(library)', '(music)'] as const;

describe('pickGroup', () => {
  it('keeps the own tab when the route names another one', () => {
    expect(pickGroup('(home)', ['(tabs)', '(music)', 'music'], GROUPS)).toBe('(home)');
  });

  it('reads the segments outside the tab stacks', () => {
    expect(pickGroup(null, ['(tabs)', '(music)', 'music'], GROUPS)).toBe('(music)');
  });

  it('reads the segments when the own tab is not one of the groups', () => {
    expect(pickGroup('(ext)', ['(tabs)', '(library)', 'libraries'], GROUPS)).toBe('(library)');
  });

  it('gives nothing when neither names a group', () => {
    expect(pickGroup(null, ['now-playing'], GROUPS)).toBeUndefined();
  });
});
