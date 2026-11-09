/**
 * TV focus helpers. The side menu needs to send the focus back to the
 * content it came from (Back or Right), each page of a tab stack keeps the
 * focus on itself while it is visible (Android TV), and some views must keep
 * the focus inside them (the player). Web and phones get plain views.
 */
import { type ComponentRef, createContext, type ReactElement, type Ref, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, TextInput, TVFocusGuideView, View, type ViewProps } from 'react-native';

import type { TvKey } from '@/player/tv-keys';
import { isNativeTV, isTV } from '@/platform/tv';

import { claimTarget, type ClaimReason, createPageRegistry, type KeyMemory, NO_KEY, pageShouldTakeFocus } from './page-focus';

/** A host view. react-native-tvos adds `requestTVFocus`; on web it is a DOM element with `focus`. */
export type FocusTarget = ComponentRef<typeof View>;

type FocusMethods = { requestTVFocus?: () => void; focus?: () => void };

let lastContent: FocusTarget | null = null;

/** A control in the content (not the side menu) took the focus. */
export function rememberContentFocus(view: FocusTarget | null): void {
  if (isTV && view) lastContent = view;
}

/** A remembered control went away. */
export function forgetContentFocus(view: FocusTarget | null): void {
  if (view && lastContent === view) lastContent = null;
}

/** Moves the focus to a view. False when the view cannot take it. */
export function focusView(view: FocusTarget | null | undefined): boolean {
  const v = view as (FocusTarget & FocusMethods) | null | undefined;
  if (!v) return false;
  try {
    if (typeof v.requestTVFocus === 'function') {
      v.requestTVFocus();
      return true;
    }
    if (typeof v.focus === 'function') {
      v.focus();
      return true;
    }
  } catch {
    // The view was unmounted.
  }
  return false;
}

/** Sends the focus back to the last focused control in the content. */
export function restoreContentFocus(): boolean {
  return focusView(lastContent);
}

let contentGuide: FocusTarget | null = null;
let menuFocused = false;
let lastKey: KeyMemory = NO_KEY;

/** The focus guide around the tab content (the side menu layout owns it). */
export function setContentGuide(view: FocusTarget | null): void {
  contentGuide = view;
}

/** An item of the side menu took or lost the focus. */
export function setMenuFocused(focused: boolean): void {
  menuFocused = focused;
}

/** The side menu has the focus. */
export function isMenuFocused(): boolean {
  return menuFocused;
}

/** A remote key came (the side menu layout listens to every key). */
export function noteRemoteKey(key: TvKey): void {
  lastKey = { key, at: Date.now() };
}

/**
 * Android TV: each page of a tab stack sits in its own focus guide, and the
 * registry knows the visible one. Apple TV, the web preview and phones do
 * not use it.
 */
const pageFocus = isNativeTV && Platform.OS === 'android';

/** Android TV: the tab pages manage their own first focus (see TvPage). */
export const tvPageFocus = pageFocus;

/** A page of a tab stack: its focus guide, and the control that asks for the page's first focus. */
export interface TvPageHandle {
  guide: { current: FocusTarget | null };
  preferred: { current: FocusTarget | null };
  /** When the page last became the visible one (ms). */
  openedAt: { current: number };
}

export const tvPages = createPageRegistry<TvPageHandle>();

/** The page a control is on (null outside the tab stacks: the side menu, the player, root pages). */
export const TvPageContext = createContext<TvPageHandle | null>(null);

/**
 * Sends the focus to the visible page: the control that had it there last,
 * else the page's first control. Without a visible page, to the tab content.
 */
export function focusActivePage(): boolean {
  const page = tvPages.active();
  if (page?.guide.current) return focusView(page.guide.current);
  return focusView(contentGuide);
}

/** A Touchable control has the focus, and its page (null outside the tab stacks: the mini player, the player). */
let controlFocused = false;
let focusPage: TvPageHandle | null = null;

/** The pause after a page transition ends, so the page it covered has left the window. */
const SETTLE_MS = 60;

/** Asks for the focus for `page` after `delay`, if it is still the visible page and the rules allow it. */
function claimFocus(page: TvPageHandle, reason: ClaimReason, delay: number): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    if (tvPages.active() !== page) return;
    const textFocused = !!TextInput.State.currentlyFocusedInput();
    const take = pageShouldTakeFocus({
      reason,
      focusOnPage: controlFocused && focusPage === page,
      focusOnHiddenPage: controlFocused && tvPages.isHidden(focusPage),
      focusNowhere: !controlFocused && !menuFocused && !textFocused,
      menuFocused,
      last: lastKey,
      now: Date.now(),
      keyedSinceOpen: lastKey.at > page.openedAt.current,
      textFocused,
    });
    if (!take) return;
    const target = claimTarget(reason, controlFocused && focusPage === page, !!page.preferred.current);
    if (target === 'preferred' && focusView(page.preferred.current)) return;
    focusView(page.guide.current);
  }, delay);
}

/**
 * Android TV: the control that asks for its page's first focus mounted (on)
 * or went away (off). The page's claims give it the focus, so the first tile
 * of a grid wins over a chip above it, whichever mounts first. (A native
 * `hasTVPreferredFocus` asks before the view is laid out; in a grid that
 * mounts twice it left the focus search unable to enter the page.)
 */
export function notePreferredControl(page: TvPageHandle | null, view: FocusTarget | null, on: boolean): void {
  if (!pageFocus || !page || !view) return;
  if (!on) {
    if (page.preferred.current === view) page.preferred.current = null;
    return;
  }
  page.preferred.current = view;
  claimFocus(page, 'firstFocusMounted', SETTLE_MS);
}

/**
 * Android TV: a control took or lost the focus. A control of a page that is
 * not visible (a guide remembered it, or a preferred focus there mounted
 * again) gives the focus to the visible page instead: true when it did.
 */
export function noteControlFocus(page: TvPageHandle | null, focused: boolean): boolean {
  if (!pageFocus) return false;
  if (!focused) {
    if (focusPage === page) controlFocused = false;
    return false;
  }
  controlFocused = true;
  focusPage = page;
  return tvPages.isHidden(page) && focusActivePage();
}

/** Android TV: a control mounted. On the visible page, it takes the focus from a page nobody sees, or when nothing has it. */
export function noteControlMounted(page: TvPageHandle | null): void {
  // The page may become the visible one only after its controls mount: claimFocus checks when it runs.
  // A grid mounts many controls at once: one claim per page.
  if (!pageFocus || !page || mountClaims.has(page)) return;
  mountClaims.add(page);
  setTimeout(() => mountClaims.delete(page), SETTLE_MS);
  claimFocus(page, 'controlMounted', SETTLE_MS);
}

const mountClaims = new Set<TvPageHandle>();

/** What a page needs from its navigation object. */
interface PageNavigation {
  isFocused: () => boolean;
  addListener: (type: 'focus' | 'blur' | 'transitionEnd', fn: (e: { data?: { closing?: boolean } }) => void) => () => void;
}

/**
 * Android TV: one page of a tab stack, the only place for the focus while it
 * is visible. When it comes back (Back, its tab opened again, the player
 * closed), it takes the focus at once: the control it had last. A page that
 * opens keeps a preferred focus it has; else it takes the focus after a
 * short pause (its first control), and again when its transition ends: the
 * page that was covered or closed leaves the window only then, and Android
 * drops or moves a focus that was there. Content that loads later takes the
 * focus from a page nobody sees, or when nothing has it (noteControlMounted).
 * A focus the person moved into the side menu stays there.
 */
function TvPage({ navigation, children }: { navigation: PageNavigation; children: ReactElement }) {
  const guide = useRef<FocusTarget | null>(null);
  const preferred = useRef<FocusTarget | null>(null);
  const openedAt = useRef(0);
  const [handle] = useState<TvPageHandle>(() => ({ guide, preferred, openedAt }));
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let seen = false;
    const onFocus = () => {
      openedAt.current = Date.now();
      tvPages.focus(handle);
      timers.push(seen ? claimFocus(handle, 'return', 0) : claimFocus(handle, 'open', SETTLE_MS));
      seen = true;
    };
    if (navigation.isFocused()) onFocus();
    const subs = [
      navigation.addListener('focus', onFocus),
      navigation.addListener('blur', () => tvPages.blur(handle)),
      navigation.addListener('transitionEnd', (e) => {
        if (!e.data?.closing) timers.push(claimFocus(handle, 'open', SETTLE_MS));
      }),
    ];
    return () => {
      subs.forEach((off) => off());
      timers.forEach(clearTimeout);
      tvPages.blur(handle);
    };
  }, [navigation, handle]);
  return (
    <TvPageContext.Provider value={handle}>
      <TvFocusGuide ref={guide} autoFocus style={styles.page}>
        {children}
      </TvFocusGuide>
    </TvPageContext.Provider>
  );
}

/** `screenLayout` for the tab stacks: on Android TV every page is its own focus scope. */
export const tvScreenLayout = pageFocus
  ? ({ navigation, children }: { navigation: unknown; children: ReactElement }) => (
      <TvPage navigation={navigation as PageNavigation}>{children}</TvPage>
    )
  : undefined;

type GuideOwnProps = 'destinations' | 'autoFocus' | 'safePadding' | 'trapFocusUp' | 'trapFocusDown' | 'trapFocusLeft' | 'trapFocusRight' | 'onFocusEnter' | 'onFocusLeave';

export interface TvFocusGuideProps extends Omit<ViewProps, GuideOwnProps> {
  ref?: Ref<FocusTarget>;
  /** Remember the last focused child and give the focus back to it when the focus comes in again. */
  autoFocus?: boolean;
  /** Where the focus goes when it comes into this view. */
  destinations?: (FocusTarget | null)[];
  /** Keep the focus inside this view in every direction. */
  trapFocus?: boolean;
  /** Keep the focus inside this view for Left and Right only. */
  trapHorizontal?: boolean;
  /** Keep the focus inside this view for Up and Down only. */
  trapVertical?: boolean;
  /** Keep the focus inside this view for Left. */
  trapLeft?: boolean;
  /** Keep the focus inside this view for Right. */
  trapRight?: boolean;
  onFocusEnter?: () => void;
  onFocusLeave?: () => void;
}

/**
 * A react-native-tvos focus guide on a real TV; a plain view elsewhere (the
 * web build has no focus guides). It has no `focusable` prop on purpose: on
 * Android TV `focusable` makes the guide itself a focus target, and taking
 * the prop away again blocks every child. Unmount what must not take focus.
 */
export function TvFocusGuide({
  autoFocus,
  destinations,
  trapFocus,
  trapHorizontal,
  trapVertical,
  trapLeft,
  trapRight,
  onFocusEnter,
  onFocusLeave,
  ...rest
}: TvFocusGuideProps) {
  if (!isNativeTV || !TVFocusGuideView) return <View {...rest} />;
  const dests = destinations?.filter((d): d is FocusTarget => !!d);
  return (
    <TVFocusGuideView
      {...rest}
      autoFocus={autoFocus}
      destinations={dests && dests.length ? dests : undefined}
      trapFocusUp={trapFocus || trapVertical}
      trapFocusDown={trapFocus || trapVertical}
      trapFocusLeft={trapFocus || trapHorizontal || trapLeft}
      trapFocusRight={trapFocus || trapHorizontal || trapRight}
      onFocusEnter={onFocusEnter}
      onFocusLeave={onFocusLeave}
    />
  );
}

const styles = StyleSheet.create({ page: { flex: 1 } });
