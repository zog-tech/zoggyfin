import { DEFAULT_TAB_BAR_SETTINGS, readTabBarSettings, tabBarMinimizeBehavior } from '../tab-bar';

jest.mock('@/storage/json', () => ({ readJson: jest.fn(() => null), writeJson: jest.fn() }));

describe('readTabBarSettings', () => {
  it('keeps the tab bar in place by default', () => {
    expect(readTabBarSettings(null)).toEqual(DEFAULT_TAB_BAR_SETTINGS);
    expect(DEFAULT_TAB_BAR_SETTINGS.collapseOnScroll).toBe(false);
  });

  it('keeps a saved choice and ignores a wrong type', () => {
    expect(readTabBarSettings({ collapseOnScroll: true }).collapseOnScroll).toBe(true);
    expect(readTabBarSettings({ collapseOnScroll: 'yes' }).collapseOnScroll).toBe(false);
    expect(readTabBarSettings('on').collapseOnScroll).toBe(false);
  });
});

describe('tabBarMinimizeBehavior', () => {
  it('collapses on scroll only when the setting is on', () => {
    expect(tabBarMinimizeBehavior({ collapseOnScroll: false })).toBe('never');
    expect(tabBarMinimizeBehavior({ collapseOnScroll: true })).toBe('onScrollDown');
  });
});
