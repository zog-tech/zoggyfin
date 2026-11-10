import { ANDROID_SYMBOLS, isIconName } from '../icon-names';
import { WEB_ICON_NAMES } from '../icon.web';

/** The names an extension button can use for common states (thumbs, bell, clock, bookmark, star, eye, flag). */
const EXTENSION_ICONS = [
  'hand.thumbsup',
  'hand.thumbsup.fill',
  'hand.thumbsdown',
  'hand.thumbsdown.fill',
  'bell',
  'bell.fill',
  'bell.slash',
  'clock',
  'clock.fill',
  'bookmark',
  'bookmark.fill',
  'star',
  'star.fill',
  'eye',
  'eye.slash',
  'flag',
  'square.and.arrow.up',
  'text.badge.plus',
  'play.rectangle',
  'play.rectangle.fill',
  'list.bullet',
  'xmark.circle',
  'hand.raised',
];

const webNames = new Set<string>(WEB_ICON_NAMES);

describe('icon names for extension buttons', () => {
  it.each(EXTENSION_ICONS)('%s is known, has a Material Symbol and a web icon', (name) => {
    expect(isIconName(name)).toBe(true);
    const material = (ANDROID_SYMBOLS as Record<string, string>)[name];
    expect(material).toBeTruthy();
    expect(webNames.has(name)).toBe(true);
  });

  it('every icon name has a web icon', () => {
    for (const name of Object.keys(ANDROID_SYMBOLS)) {
      expect([name, webNames.has(name)]).toEqual([name, true]);
    }
  });
});
