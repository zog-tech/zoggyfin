/**
 * TV: the action button of the item page and the Home billboard, in the style
 * of the streaming apps on TV. At rest it is a translucent pill with white
 * text; focused it fills white with dark text and grows a little. The fill is
 * the one focus mark (no ring). Its colour and scale run on the UI thread
 * from the Touchable's focus mark, so a focus move does no React render.
 *
 * TV Modern look (design system §7.22): no capsule, no chip and no circle.
 * Controls are flat and text-led, with one focus shape, the focus plate (a
 * white rectangle, radius 8 u) behind the control. The primary action is an
 * Ember rectangle at rest; a text action is a glyph and a label with no
 * container. Toolbar items (`TvToolbarItem`) and tabs (`TvTab`) use the same
 * plate. Classic keeps the pills of before: each export picks its drawing
 * once, from the look of the run.
 */
import { type ReactElement, type ReactNode, useContext } from 'react';
import { type StyleProp, StyleSheet, Text, type TextStyle, View, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, type SharedValue, useAnimatedStyle, useReducedMotion } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/icon';
import { TouchFocusMark, Touchable } from '@/components/touchable';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { type AppTheme, createStyles, dark, font, iconSize, mediaColors, radius, scaled, spacing, tvFont, tvm, type, u, useStyles, withAlpha } from '@/theme';

const MODERN = isTV && isTvModern;

/** The rest and focus colours (media colours: the button sits on art). */
const REST_FILL = mediaColors.tvButtonRest;
const FOCUS_FILL = mediaColors.white;
const REST_TEXT = mediaColors.white;
const FOCUS_TEXT = mediaColors.tvButtonFocusText;

export interface TvButtonProps {
  label: string;
  icon?: IconName;
  onPress: () => void;
  /** This button takes the first focus of the page. */
  firstFocus?: boolean;
  /** A resume bar under the label, 0..1. */
  progress?: number | null;
  /**
   * A toggle that is on (My List, Played): the icon shows it (pass the filled
   * icon name). Modern also sets the label in weight 700.
   */
  active?: boolean;
  accessibilityLabel?: string;
  onFocus?: () => void;
  /**
   * Modern: 'primary' is the Ember rectangle (Play, Resume: one per row),
   * 'text' (default) a glyph and label with no container. Classic ignores it.
   */
  variant?: 'primary' | 'text';
}

/** The action button of the TV item page and billboard: the Classic pill, or the Modern primary or text action. */
export const TvButton: (props: TvButtonProps) => ReactElement = MODERN ? ModernTvButton : ClassicTvButton;

function ClassicTvButton({ label, icon, onPress, firstFocus, progress, active, accessibilityLabel, onFocus }: TvButtonProps) {
  const s = useStyles(makeStyles);
  return (
    <Touchable
      kind="plain"
      ring={false}
      firstFocus={firstFocus}
      hasTVPreferredFocus={firstFocus}
      onFocus={onFocus}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={active === undefined ? undefined : { selected: active }}>
      {progress != null ? (
        // A resume bar under the label: a taller pill, so the bar has its own line and never touches the text.
        <Fill tall>
          <View style={s.stack}>
            <View style={s.line}>
              {icon ? <TvButtonIcon name={icon} /> : null}
              <TvButtonLabel style={s.label}>{label}</TvButtonLabel>
            </View>
            <View style={s.track}>
              <View style={[s.trackFill, { width: `${Math.max(3, Math.round(progress * 100))}%` }]} />
            </View>
          </View>
        </Fill>
      ) : (
        <Fill>
          {icon ? <TvButtonIcon name={icon} /> : null}
          <TvButtonLabel style={s.label}>{label}</TvButtonLabel>
        </Fill>
      )}
    </Touchable>
  );
}

/**
 * TV: a round icon button in the same style (the music player's transport). The focus fills the
 * circle white. `active` marks a toggle that is on (shuffle, repeat) with a dot under it; the
 * dot sits inside the button's box, so nothing hangs outside it and nothing is clipped.
 */
export interface TvIconButtonProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** Classic: the circle's diameter in points (before the screen scale). Modern: the square box in TV units. */
  size: number;
  firstFocus?: boolean;
  active?: boolean;
  /** Classic: no fill at rest (the secondary transport buttons): only the focus fills the circle. No meaning in Modern. */
  plain?: boolean;
  /** Modern: the glyph size in TV units (default about half the box). Classic ignores it. */
  glyph?: number;
}

/** A transport button: the Classic circle, or the Modern bare glyph with a square plate on focus. */
export const TvIconButton: (props: TvIconButtonProps) => ReactElement = MODERN ? ModernTvIconButton : ClassicTvIconButton;

function ClassicTvIconButton({ icon, label, onPress, size, firstFocus, active, plain }: TvIconButtonProps) {
  const d = scaled(size);
  return (
    <Touchable
      kind="plain"
      ring={false}
      firstFocus={firstFocus}
      hasTVPreferredFocus={firstFocus}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active === undefined ? undefined : { selected: active }}>
      <View style={{ alignItems: 'center', gap: scaled(4) }}>
        <Fill round={d} plain={plain}>
          <TvButtonIcon name={icon} size={Math.round(d * 0.46)} />
        </Fill>
        <View style={[dotStyle, { opacity: active ? 1 : 0 }]} />
      </View>
    </Touchable>
  );
}

const dotStyle = { width: 5, height: 5, borderRadius: 3, backgroundColor: mediaColors.white } as const;

/** The pill (or a circle of diameter `round`): its fill and scale follow the focus mark. */
function Fill({ children, round, plain, tall }: { children: ReactNode; round?: number; plain?: boolean; tall?: boolean }) {
  const s = useStyles(makeStyles);
  const mark = useContext(TouchFocusMark);
  const rest = plain ? mediaColors.tvButtonClear : REST_FILL;
  const style = useAnimatedStyle(() => {
    const m = mark ? mark.get() : 0;
    return { backgroundColor: interpolateColor(m, [0, 1], [rest, FOCUS_FILL]), transform: [{ scale: 1 + 0.06 * m }] };
  });
  return (
    <Animated.View style={[round ? { width: round, height: round, borderRadius: round / 2, alignItems: 'center', justifyContent: 'center' } : [s.pill, tall && s.pillTall], style]}>
      {children}
    </Animated.View>
  );
}

function TvButtonLabel({ children, style }: { children: string; style: object }) {
  const mark = useContext(TouchFocusMark);
  const color = useAnimatedStyle(() => ({ color: interpolateColor(mark ? mark.get() : 0, [0, 1], [REST_TEXT, FOCUS_TEXT]) }));
  return (
    <Animated.Text style={[style, color]} numberOfLines={1}>
      {children}
    </Animated.Text>
  );
}

/** The icon in two colours, cross-faded on the focus mark (an icon's colour is not animatable). */
function TvButtonIcon({ name, size: sizeIn }: { name: IconName; size?: number }) {
  const mark = useContext(TouchFocusMark);
  const size = sizeIn ?? scaled(iconSize.sm);
  const lit = useAnimatedStyle(() => ({ opacity: mark ? mark.get() : 0 }));
  const dim = useAnimatedStyle(() => ({ opacity: mark ? 1 - mark.get() : 1 }));
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, dim]}>
        <Icon name={name} size={size} color={REST_TEXT} weight="semibold" />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, lit]}>
        <Icon name={name} size={size} color={FOCUS_TEXT} weight="semibold" />
      </Animated.View>
    </View>
  );
}

/** A plain text line in the TV button style, for a hint next to the buttons. */
export function TvButtonHint({ children }: { children: string }) {
  const s = useStyles(makeStyles);
  return <Text style={s.hint}>{children}</Text>;
}

// ---------------------------------------------------------------------------
// Modern look (design system §7.22). TV is always dark, so the colours are the dark tokens.
// ---------------------------------------------------------------------------

const C = dark;
const PLATE_RADIUS = u(tvm.size.plateRadius);
const ACTION_ICON = u(tvm.size.actionIcon);
/** The gap between a glyph and its label, and between a toolbar label and its value. */
const INNER_GAP = u(14);
/** The resume bar of an action: 4 u under the label. */
const BAR_HEIGHT = u(4);
/** The rest colours of the resume bar on the Ember primary action. */
const BAR_TRACK_ON_ACCENT = withAlpha(C.onAccent, 0.3);

/**
 * Modern: the focus plate. A white rectangle (radius 8 u) under the content
 * of a focused control: always mounted, its opacity follows the Touchable's
 * focus mark on the UI thread. It fills its parent unless `style` places it.
 * Null in Classic and off TV.
 */
export function TvFocusPlate({ radius: r, style }: { radius?: number; style?: StyleProp<ViewStyle> }): ReactElement | null {
  const mark = useContext(TouchFocusMark);
  if (!MODERN || !mark) return null;
  return <Plate mark={mark} radius={r ?? PLATE_RADIUS} style={style} />;
}

function Plate({ mark, radius: r, style }: { mark: SharedValue<number>; radius: number; style?: StyleProp<ViewStyle> }) {
  const shown = useAnimatedStyle(() => ({ opacity: mark.get() }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: r, backgroundColor: tvm.color.plate }, style, shown]} />;
}

/** Text whose colour goes from `rest` to `focus` (default the plate text) with the focus mark, on the UI thread. */
export function TvPlateText({ children, style, rest, focus = tvm.color.plateText }: { children: string; style: StyleProp<TextStyle>; rest: string; focus?: string }): ReactElement {
  const mark = useContext(TouchFocusMark);
  const color = useAnimatedStyle(() => ({ color: interpolateColor(mark ? mark.get() : 0, [0, 1], [rest, focus]) }));
  return (
    <Animated.Text style={[style, color]} numberOfLines={1}>
      {children}
    </Animated.Text>
  );
}

/** A glyph in two colours, cross-faded on the focus mark (an icon's colour is not animatable). */
function PlateIcon({ name, size, rest, focus = tvm.color.plateText }: { name: IconName; size: number; rest: string; focus?: string }) {
  const mark = useContext(TouchFocusMark);
  const lit = useAnimatedStyle(() => ({ opacity: mark ? mark.get() : 0 }));
  const dim = useAnimatedStyle(() => ({ opacity: mark ? 1 - mark.get() : 1 }));
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, dim]}>
        <Icon name={name} size={size} color={rest} weight="semibold" />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, lit]}>
        <Icon name={name} size={size} color={focus} weight="semibold" />
      </Animated.View>
    </View>
  );
}

/** Modern: the box of an action or a transport glyph grows to `actionFocusScale` with the mark (none with Reduce Motion). */
function useActionScale(): ReturnType<typeof useAnimatedStyle> {
  const mark = useContext(TouchFocusMark);
  const reduced = useReducedMotion();
  return useAnimatedStyle(() => ({ transform: [{ scale: reduced ? 1 : 1 + (tvm.size.actionFocusScale - 1) * (mark ? mark.get() : 0) }] }));
}

function ModernTvButton({ label, icon, onPress, firstFocus, progress, active, accessibilityLabel, onFocus, variant = 'text' }: TvButtonProps) {
  return (
    <Touchable
      kind="plain"
      ring={false}
      firstFocus={firstFocus}
      hasTVPreferredFocus={firstFocus}
      onFocus={onFocus}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={active === undefined ? undefined : { selected: active }}>
      {variant === 'primary' ? <PrimaryAction label={label} icon={icon} progress={progress} /> : <TextAction label={label} icon={icon} progress={progress} active={!!active} />}
    </Touchable>
  );
}

/** The Ember rectangle at rest; the plate (white, dark text) with the focus. */
function PrimaryAction({ label, icon, progress }: { label: string; icon?: IconName; progress?: number | null }) {
  const mark = useContext(TouchFocusMark);
  const scale = useActionScale();
  const fill = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(mark ? mark.get() : 0, [0, 1], [C.accent, tvm.color.plate]) }));
  return (
    <Animated.View style={[m.box, m.primary, fill, scale]}>
      {icon ? <PlateIcon name={icon} size={ACTION_ICON} rest={C.onAccent} /> : null}
      <View>
        <TvPlateText style={m.primaryLabel} rest={C.onAccent}>
          {label}
        </TvPlateText>
        {progress != null ? <ResumeBar fraction={progress} onAccent /> : null}
      </View>
    </Animated.View>
  );
}

/** A glyph and a label with no container; the plate behind them with the focus. */
function TextAction({ label, icon, progress, active }: { label: string; icon?: IconName; progress?: number | null; active: boolean }) {
  const scale = useActionScale();
  return (
    <Animated.View style={[m.box, m.text, scale]}>
      <TvFocusPlate />
      {icon ? <PlateIcon name={icon} size={ACTION_ICON} rest={C.text} /> : null}
      <View>
        <TvPlateText style={[m.textLabel, active && m.on]} rest={C.text}>
          {label}
        </TvPlateText>
        {progress != null ? <ResumeBar fraction={progress} /> : null}
      </View>
    </Animated.View>
  );
}

/** The resume bar under an action's label. On the Ember rest fill it is dark; on the plate (and on a text action) grey and Ember. */
function ResumeBar({ fraction, onAccent }: { fraction: number; onAccent?: boolean }) {
  const mark = useContext(TouchFocusMark);
  const track = useAnimatedStyle(() => ({
    backgroundColor: onAccent ? interpolateColor(mark ? mark.get() : 0, [0, 1], [BAR_TRACK_ON_ACCENT, mediaColors.tvTrack]) : mediaColors.tvTrack,
  }));
  const fill = useAnimatedStyle(() => ({ backgroundColor: onAccent ? interpolateColor(mark ? mark.get() : 0, [0, 1], [C.onAccent, C.accent]) : C.accent }));
  return (
    <Animated.View style={[m.bar, track]}>
      <Animated.View style={[m.barFill, { width: `${Math.max(3, Math.round(fraction * 100))}%` }, fill]} />
    </Animated.View>
  );
}

function ModernTvIconButton({ icon, label, onPress, size, firstFocus, active, glyph }: TvIconButtonProps) {
  const box = u(size);
  const g = u(glyph ?? Math.round(size * 0.5));
  return (
    <Touchable
      kind="plain"
      ring={false}
      firstFocus={firstFocus}
      hasTVPreferredFocus={firstFocus}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active === undefined ? undefined : { selected: active }}>
      <TransportGlyph icon={icon} box={box} glyph={g} active={active} />
    </Touchable>
  );
}

/** A bare glyph in a square box; the plate fills the box with the focus. A toggle that is on has an Ember line under the glyph. */
function TransportGlyph({ icon, box, glyph, active }: { icon: IconName; box: number; glyph: number; active?: boolean }) {
  const scale = useActionScale();
  return (
    <Animated.View style={[m.square, { width: box, height: box }, scale]}>
      <TvFocusPlate />
      <PlateIcon name={icon} size={glyph} rest={active === false ? C.text2 : C.text} />
      {active ? <View style={[m.toggleLine, { bottom: Math.round((box - glyph) / 4) }]} /> : null}
    </Animated.View>
  );
}

/**
 * Modern: a toolbar item, "label + value" (a grid filter, the Search genre
 * control), with no container. A switch-type item has no label: off it is a
 * quiet word, on it has a check glyph and weight 700. The plate shows with
 * the focus; no scale.
 */
export function TvToolbarItem({
  label,
  value,
  on,
  onPress,
  firstFocus,
  accessibilityLabel,
}: {
  label?: string;
  value: string;
  on?: boolean;
  onPress: () => void;
  firstFocus?: boolean;
  accessibilityLabel?: string;
}): ReactElement {
  const toggle = label === undefined;
  return (
    <Touchable
      kind="plain"
      ring={false}
      firstFocus={firstFocus}
      hasTVPreferredFocus={firstFocus}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (label ? `${label}, ${value}` : value)}
      accessibilityState={toggle && on !== undefined ? { checked: on } : undefined}>
      <View style={m.toolbarItem}>
        <TvFocusPlate />
        {label !== undefined ? (
          <TvPlateText style={m.toolbarLabel} rest={C.text3} focus={tvm.color.plateText2}>
            {label}
          </TvPlateText>
        ) : null}
        {toggle && on ? <PlateIcon name="checkmark" size={u(24)} rest={C.text} /> : null}
        <TvPlateText style={[m.toolbarValue, toggle && !on && m.toolbarOff]} rest={toggle && !on ? C.text2 : C.text}>
          {value}
        </TvPlateText>
      </View>
    </Touchable>
  );
}

/**
 * Modern: a text tab (music tabs, the season control). The current tab is
 * white with an Ember underline as wide as its text, 10 u under the box; the
 * underline stays visible under the plate. No scale.
 */
export function TvTab({ label, selected, onPress, onFocus, firstFocus }: { label: string; selected: boolean; onPress: () => void; onFocus?: () => void; firstFocus?: boolean }): ReactElement {
  return (
    <Touchable
      kind="plain"
      ring={false}
      firstFocus={firstFocus}
      hasTVPreferredFocus={firstFocus}
      onPress={onPress}
      onFocus={onFocus}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected }}>
      <View style={m.tab}>
        <TvFocusPlate />
        <TvPlateText style={[m.tabLabel, selected && m.on]} rest={selected ? C.text : C.text2}>
          {label}
        </TvPlateText>
        {selected ? <View style={m.underline} /> : null}
      </View>
    </Touchable>
  );
}

const TOOLBAR_PAD = u(tvm.size.toolbarPadX);

const m = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: INNER_GAP, height: u(tvm.size.actionHeight), borderRadius: PLATE_RADIUS },
  primary: { paddingHorizontal: u(tvm.size.primaryPadX) },
  text: { paddingHorizontal: u(tvm.size.actionPadX) },
  primaryLabel: { ...tvFont(tvm.type.action), fontWeight: '700' },
  textLabel: { ...tvFont(tvm.type.action) },
  on: { fontWeight: '700' },
  bar: { height: BAR_HEIGHT, marginTop: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: BAR_HEIGHT / 2 },
  square: { alignItems: 'center', justifyContent: 'center' },
  toggleLine: { position: 'absolute', width: u(24), height: u(4), borderRadius: u(2), backgroundColor: C.accent },
  toolbarItem: { flexDirection: 'row', alignItems: 'center', gap: INNER_GAP, height: u(tvm.size.toolbarItemHeight), paddingHorizontal: TOOLBAR_PAD },
  toolbarLabel: { ...tvFont(tvm.type.toolbar), fontWeight: '500' },
  toolbarValue: { ...tvFont(tvm.type.toolbar) },
  toolbarOff: { fontWeight: '500' },
  tab: { justifyContent: 'center', height: u(tvm.size.toolbarItemHeight), paddingHorizontal: TOOLBAR_PAD },
  tabLabel: { ...tvFont(tvm.type.action) },
  underline: {
    position: 'absolute',
    left: TOOLBAR_PAD,
    right: TOOLBAR_PAD,
    bottom: -(u(tvm.size.underlineGap) + u(tvm.size.underline)),
    height: u(tvm.size.underline),
    borderRadius: u(tvm.size.underline) / 2,
    backgroundColor: C.accent,
  },
});

const makeStyles = createStyles(({ c }: AppTheme) => ({
  pill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingHorizontal: scaled(18),
    height: scaled(40),
    borderRadius: radius.sm,
  },
  pillTall: { height: scaled(52) },
  stack: { gap: scaled(6) },
  line: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  label: { ...font(type.headline), color: REST_TEXT },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: mediaColors.tvTrack,
    overflow: 'hidden' as const,
  },
  trackFill: { height: '100%' as const, backgroundColor: c.accent },
  hint: { ...font(type.footnote), color: mediaColors.white },
}));
