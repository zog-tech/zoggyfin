import {
  cueCss,
  DEFAULT_SUBTITLE_APPEARANCE,
  mpvSubtitleProperties,
  normalizeSubtitleAppearance,
  optionLabel,
  SUBTITLE_BACKGROUND_OPTIONS,
  SUBTITLE_COLORS,
  subtitleBottom,
  subtitleLineGap,
  subtitleTextStyle,
  type SubtitleAppearance,
} from '../subtitle-style';

const base = DEFAULT_SUBTITLE_APPEARANCE;
const props = (a: SubtitleAppearance) => Object.fromEntries(mpvSubtitleProperties(a));

describe('normalizeSubtitleAppearance', () => {
  it('gives the defaults for nothing saved or a damaged value', () => {
    expect(normalizeSubtitleAppearance(undefined)).toEqual(base);
    expect(normalizeSubtitleAppearance(null)).toEqual(base);
    expect(normalizeSubtitleAppearance('large')).toEqual(base);
    expect(normalizeSubtitleAppearance(42)).toEqual(base);
  });

  it('keeps known values and replaces unknown ones field by field', () => {
    expect(normalizeSubtitleAppearance({ version: 1, size: 'xlarge', color: 'pink', background: 'outline', position: 7 })).toEqual({
      size: 'xlarge',
      color: 'white',
      background: 'outline',
      position: 'normal',
    });
  });

  it('drops extra fields', () => {
    expect(Object.keys(normalizeSubtitleAppearance({ ...base, version: 1, other: true })).sort()).toEqual(['background', 'color', 'position', 'size']);
  });
});

describe('subtitleTextStyle', () => {
  it('keeps the look from before the setting for the defaults', () => {
    const s = subtitleTextStyle(base);
    expect(s).toMatchObject({ fontSize: 20, lineHeight: 25, color: '#FFFFFF', backgroundColor: SUBTITLE_COLORS.box, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 });
  });

  it('scales the size choices', () => {
    expect(subtitleTextStyle({ ...base, size: 'small' }).fontSize).toBe(16);
    expect(subtitleTextStyle({ ...base, size: 'large' }).fontSize).toBe(25);
    expect(subtitleTextStyle({ ...base, size: 'xlarge' }).fontSize).toBe(30);
  });

  it('scales for TV 10-foot sizes, box padding included', () => {
    const s = subtitleTextStyle({ ...base, size: 'large' }, 1.8);
    expect(s.fontSize).toBe(45);
    expect(s.lineHeight).toBe(56);
    expect(s.paddingHorizontal).toBe(14);
    expect(subtitleLineGap(1.8)).toBe(7);
  });

  it('draws yellow text', () => {
    expect(subtitleTextStyle({ ...base, color: 'yellow' }).color).toBe(SUBTITLE_COLORS.yellow);
  });

  it('has no box and no shadow for no background', () => {
    const s = subtitleTextStyle({ ...base, background: 'none' });
    expect(s.backgroundColor).toBeUndefined();
    expect(s.textShadowColor).toBeUndefined();
  });

  it('draws an outline as a tight dark shadow with no box', () => {
    const s = subtitleTextStyle({ ...base, background: 'outline' });
    expect(s.backgroundColor).toBeUndefined();
    expect(s.textShadowColor).toBe(SUBTITLE_COLORS.outline);
    expect(s.textShadowRadius).toBeGreaterThanOrEqual(2);
  });
});

describe('subtitleBottom', () => {
  it('adds a tenth of the video height when raised', () => {
    expect(subtitleBottom(base, 40, 800)).toBe(40);
    expect(subtitleBottom({ ...base, position: 'raised' }, 40, 800)).toBe(120);
  });
});

describe('cueCss', () => {
  it('styles the browser cues for each choice', () => {
    expect(cueCss(base)).toContain(`background-color: ${SUBTITLE_COLORS.box}`);
    expect(cueCss(base)).toContain('font-size: 100%');
    expect(cueCss({ ...base, size: 'xlarge', color: 'yellow' })).toMatch(/color: #FFD60A.*font-size: 150%/);
    expect(cueCss({ ...base, background: 'none' })).toContain('background-color: transparent; text-shadow: none');
    expect(cueCss({ ...base, background: 'outline' })).toContain('text-shadow: 0 0 3px');
  });

  it('moves the cue box only when raised', () => {
    expect(cueCss(base)).not.toContain('translateY');
    expect(cueCss({ ...base, position: 'raised' })).toContain('video::-webkit-media-text-track-container { transform: translateY(-10%); }');
  });
});

describe('mpvSubtitleProperties', () => {
  it('maps size, colour and position', () => {
    expect(props(base)).toMatchObject({ 'sub-scale': '1', 'sub-color': '#FFFFFFFF', 'sub-margin-y': '34' });
    expect(props({ ...base, size: 'small', color: 'yellow', position: 'raised' })).toMatchObject({ 'sub-scale': '0.8', 'sub-color': '#FFFFD60A', 'sub-margin-y': '106' });
  });

  it('sets every border property that a choice depends on', () => {
    expect(props(base)).toMatchObject({ 'sub-border-style': 'background-box', 'sub-back-color': '#8C000000', 'sub-outline-size': '0' });
    expect(props({ ...base, background: 'outline' })).toMatchObject({ 'sub-border-style': 'outline-and-shadow', 'sub-outline-size': '2.5', 'sub-shadow-offset': '1' });
    expect(props({ ...base, background: 'none' })).toMatchObject({ 'sub-border-style': 'outline-and-shadow', 'sub-outline-size': '0', 'sub-shadow-offset': '0' });
  });
});

it('labels each option', () => {
  expect(optionLabel(SUBTITLE_BACKGROUND_OPTIONS, 'box')).toBe('Translucent box');
});
