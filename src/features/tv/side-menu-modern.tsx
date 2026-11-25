/**
 * TV Modern look (design system §7.22): the drawing of the side menu. The
 * rules (open and close, Back, Right, the selected entry, the clip that
 * slides with the panel) stay in `side-menu.tsx`; this file draws only.
 *
 * Closed, the rail has no surface and no line: a soft fade under the icons
 * keeps them readable on the art that runs under the rail. Open, a wide fade
 * covers the page (the page does not move and does not lay out again), and
 * the entries show their labels. A focused entry has the focus plate (a
 * white rectangle, radius 8 u), the same shape as every other focused text
 * control; the current entry has a small Ember mark, never a circle or a fill.
 * Nothing changes size while the menu moves: the fades and the labels follow
 * the open progress on the UI thread.
 *
 * The rail has few entries and a focus move in it is rare, so the entries
 * read their focus as React state (as in Classic), not from a shared value.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode, RefObject } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import LOGO from '@/assets/images/logo-mark.png';
import type { BaseItemDto } from '@/api/types';
import { Icon, type IconName } from '@/components/icon';
import { ItemImage } from '@/components/item-image';
import { dark, tvFont, tvm, u, webPressable, withAlpha } from '@/theme';

import type { FocusTarget } from './focus';

/** TV is always dark. */
const C = dark;
const S = tvm.size;

/** The rail and the open menu (the clip that slides with the panel). */
export const MODERN_RAIL_WIDTH = u(S.rail);
export const MODERN_MENU_WIDTH = u(S.menuWidth);

const ENTRY_X = u(32);
const ENTRY_H = u(S.menuItemHeight);
const ENTRY_W = u(396);
/** The icon box: a 60 u square at x = 34 (2 u inside the entry). */
const ICON_BOX = u(S.railItem);
const ICON_PAD = u(34) - ENTRY_X;
const ICON = u(S.railIcon);
/** The label starts 22 u after the icon box. */
const LABEL_GAP = u(22);
/** The Ember mark: 12 u left of the icon box, vertically centred. */
const MARK_W = u(S.railMark.width);
const MARK_H = u(S.railMark.height);
const MARK_LEFT = ICON_PAD - u(12) - MARK_W;
/** The brand mark (44 u at x = 42, y = 54) and the word after it (x = 102, y = 58). */
const BRAND = u(44);
const BRAND_X = u(42);
const BRAND_Y = u(54);
const WORD_X = u(102);
const WORD_Y = u(58);
/** Settings sits apart, 54 u from the bottom. */
const BOTTOM = u(54);

const SCREEN_W = Dimensions.get('window').width;

/**
 * Behind the entries: the closed rail's fade, the open menu's fade over the
 * page, and the brand. None of it takes a touch or the focus.
 */
export function ModernRailBackdrop({ progress }: { progress: SharedValue<number> }) {
  const open = useAnimatedStyle(() => ({ opacity: progress.get() }));
  return (
    <>
      {/* Closed: a fade 240 u wide under the icons, so they read on bright art. */}
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(C.bg, 0.8), withAlpha(C.bg, 0)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.fill, { width: u(S.railScrimWidth) }]}
      />
      {/* Open: a fade 1100 u wide over the page, so the labels never sit on the page's text. */}
      <Animated.View pointerEvents="none" style={[styles.fill, { width: Math.min(u(S.menuScrimWidth), SCREEN_W) }, open]}>
        <LinearGradient
          colors={[withAlpha(C.bg, 0.98), withAlpha(C.bg, 0.96), withAlpha(C.bg, 0)]}
          locations={[0, 0.46, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <View pointerEvents="none" style={styles.brand} accessible={false}>
        <Image source={LOGO} style={styles.brandMark} contentFit="contain" accessible={false} />
      </View>
      <Animated.Text pointerEvents="none" style={[styles.word, open]} numberOfLines={1} accessible={false}>
        zoggyfin
      </Animated.Text>
    </>
  );
}

/** The entries: the main group in the middle of the screen, Settings apart at the bottom. */
export function ModernRailEntries({ main, bottom }: { main: ReactNode; bottom: ReactNode }) {
  return (
    <>
      <View style={styles.main}>{main}</View>
      <View style={styles.bottom}>{bottom}</View>
    </>
  );
}

/** One page of the menu: an icon, and with the menu open, its label. */
export function ModernMenuEntry({
  pressRef,
  label,
  icon,
  open,
  selected,
  focused,
  progress,
  onPress,
  onFocus,
  onBlur,
}: {
  pressRef: RefObject<FocusTarget | null>;
  label: string;
  icon: IconName;
  /** The menu is open (or still closing): the label shows. */
  open: boolean;
  selected: boolean;
  focused: boolean;
  progress: SharedValue<number>;
  onPress: () => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const labelStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const fg = focused ? tvm.color.plateText : selected ? C.text : C.text2;
  return (
    <Pressable
      ref={pressRef}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={[styles.entry, { width: open ? ENTRY_W : ICON_BOX + ICON_PAD }, webPressable]}>
      {focused ? <View style={styles.plate} /> : null}
      {selected && !focused ? <View style={styles.mark} /> : null}
      <View style={[styles.iconBox, !selected && !focused && styles.quiet]}>
        <Icon name={icon} size={ICON} color={fg} weight={selected || focused ? 'semibold' : 'regular'} />
      </View>
      {open ? (
        <Animated.Text
          style={[styles.label, { color: focused ? tvm.color.plateText : selected ? C.text : tvm.color.captionRest }, focused ? styles.labelFocused : selected ? styles.labelSelected : null, labelStyle]}
          numberOfLines={1}>
          {label}
        </Animated.Text>
      ) : null}
    </Pressable>
  );
}

/**
 * While music plays: the first entry, with the cover in place of an icon. Open, "NOW PLAYING" and
 * the song's name follow the cover, then the play/pause glyph (Right reaches it, menu-right.ts).
 */
export function ModernNowPlayingEntry({
  item,
  playing,
  open,
  cover,
  toggle,
  progress,
  toggleRef,
  onOpenPlayer,
  onTogglePlay,
  onCoverFocus,
  onToggleFocus,
  onBlur,
}: {
  item: BaseItemDto;
  playing: boolean;
  open: boolean;
  /** The cover part has the focus. */
  cover: boolean;
  /** The play/pause glyph has the focus. */
  toggle: boolean;
  progress: SharedValue<number>;
  toggleRef: (view: FocusTarget | null) => void;
  onOpenPlayer: () => void;
  onTogglePlay: () => void;
  onCoverFocus: () => void;
  onToggleFocus: () => void;
  onBlur: () => void;
}) {
  const labelStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  return (
    <View style={[styles.nowRow, { width: open ? ENTRY_W : ICON_BOX + ICON_PAD }]}>
      <Pressable
        onPress={onOpenPlayer}
        onFocus={onCoverFocus}
        onBlur={onBlur}
        accessibilityRole="menuitem"
        accessibilityLabel={`Now playing: ${item.Name ?? ''}. Opens the player`}
        style={[styles.nowCover, webPressable]}>
        {cover ? <View style={styles.plate} /> : null}
        <View style={styles.iconBox}>
          <ItemImage item={item} variant="square" width={ICON_BOX} aspectRatio={1} rounded={u(S.plateRadius)} hideArtTitle />
        </View>
        {open ? (
          <Animated.View style={[styles.nowText, labelStyle]}>
            <Text style={[styles.eyebrow, { color: cover ? tvm.color.plateText2 : C.text2 }]} numberOfLines={1}>
              NOW PLAYING
            </Text>
            <Text style={[styles.song, { color: cover ? tvm.color.plateText : C.text }]} numberOfLines={1}>
              {item.Name ?? ''}
            </Text>
          </Animated.View>
        ) : null}
      </Pressable>
      {open ? (
        <Animated.View style={labelStyle}>
          <Pressable
            ref={toggleRef}
            onPress={onTogglePlay}
            onFocus={onToggleFocus}
            onBlur={onBlur}
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause' : 'Play'}
            style={[styles.toggle, webPressable]}>
            {toggle ? <View style={styles.plate} /> : null}
            {/* In its own view, so it stacks over the plate on the web too. */}
            <View>
              <Icon name={playing ? 'pause.fill' : 'play.fill'} size={ICON} color={toggle ? tvm.color.plateText : C.text} />
            </View>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  brand: { position: 'absolute', left: BRAND_X, top: BRAND_Y, width: BRAND, height: BRAND },
  brandMark: { width: '100%', height: '100%' },
  word: { position: 'absolute', left: WORD_X, top: WORD_Y, ...tvFont(tvm.type.menu), fontSize: u(30), lineHeight: u(36), fontWeight: '700', color: C.text },
  main: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center', gap: u(S.menuItemGap) },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: BOTTOM },
  entry: { flexDirection: 'row', alignItems: 'center', marginLeft: ENTRY_X, height: ENTRY_H, paddingLeft: ICON_PAD, gap: LABEL_GAP },
  plate: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: u(S.plateRadius), backgroundColor: tvm.color.plate },
  mark: { position: 'absolute', left: MARK_LEFT, top: (ENTRY_H - MARK_H) / 2, width: MARK_W, height: MARK_H, borderRadius: u(2), backgroundColor: C.accent },
  iconBox: { width: ICON_BOX, height: ICON_BOX, alignItems: 'center', justifyContent: 'center' },
  quiet: { opacity: 0.85 },
  label: { ...tvFont(tvm.type.menu), flexShrink: 1 },
  labelSelected: { fontWeight: '700' },
  labelFocused: { fontWeight: '600' },
  nowRow: { flexDirection: 'row', alignItems: 'center', marginLeft: ENTRY_X, height: ENTRY_H, marginBottom: u(S.railItemGap) },
  nowCover: { flex: 1, flexDirection: 'row', alignItems: 'center', height: ENTRY_H, paddingLeft: ICON_PAD, gap: LABEL_GAP },
  nowText: { flex: 1 },
  eyebrow: { ...tvFont(tvm.type.eyebrow), textTransform: 'uppercase' },
  song: { ...tvFont(tvm.type.menu), fontSize: u(30), lineHeight: u(36), fontWeight: '600' },
  toggle: { width: ICON_BOX, height: ICON_BOX, alignItems: 'center', justifyContent: 'center' },
});
