/**
 * A vertical TV page that glides to the focused view (Android TV).
 *
 * Android's own focus scroll jumped at once to the focused view, and on Down
 * past the last control it scrolled on past the end and cut the rows off.
 * `tvDrivenScroll` turns it off; this page scrolls instead: when a view in it
 * takes the focus, the page measures it in the content and glides to the
 * offset from `focusScrollOffset`, which never leaves the content. A row of
 * tiles (`TvShelf`) claims the scroll for the whole row with its title.
 *
 * Use `TvScrollView` in place of a vertical `ScrollView`, or spread
 * `useTvPageScroll().props` on a `FlatList` and provide `page` to its rows.
 * On phones, the web and tvOS both are plain scroll views.
 */
import { type ComponentRef, type ReactNode, type Ref, type RefObject, useCallback, useMemo, useRef } from 'react';
import { type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, Platform, ScrollView, type ScrollViewProps } from 'react-native';

import { isNativeTV } from '@/platform/tv';

import type { FocusTarget } from './focus';
import { FOCUS_SCROLL_MARGIN, focusScrollOffset } from './focus-scroll';
import { tvDrivenScroll } from './scroll';
import { type TvRowPage, TvRowScroll } from './shelf';

const driven = isNativeTV && Platform.OS === 'android';

type ScrollHandle = ComponentRef<typeof ScrollView>;

/** FlashList types its scroll view as the component; at run time it is the instance. */
export const flashScroll = (v: unknown): ScrollHandle | null => (v as ScrollHandle | null) ?? null;

type OwnProps = Pick<ScrollViewProps, 'onLayout' | 'onContentSizeChange' | 'onScroll'>;
type PageProps = OwnProps & Pick<ScrollViewProps, 'onFocusCapture'> & typeof tvDrivenScroll;

/** How long a glide (`scrollAnimationDuration`) and its last scroll events take. */
const GLIDE_MS = 450;

/**
 * The scroll for a page. `scrollView` (a stable callback) gives the page's
 * ScrollView (for a FlatList: `getNativeScrollRef()`). `props` go on the
 * scroll view, merged with its own `onLayout`, `onContentSizeChange` and
 * `onScroll`; `page` goes to `TvRowScroll`. The page keeps the offset it
 * glides to, and takes the real one again after a scroll it did not start
 * (a list that jumps back to its top).
 */
export function useTvPageScroll(
  scrollView: () => ScrollHandle | null | undefined,
  own: OwnProps = {},
): { props: PageProps | Record<string, never>; page: TvRowPage | null } {
  const goal = useRef(0);
  const glidingUntil = useRef(0);
  const size = useRef({ viewport: 0, content: 0 });
  const pending = useRef<{ target: FocusTarget | null; row: FocusTarget | null } | null>(null);

  // Runs after the focus event: a row's tile claims the scroll during it.
  const flush = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    const sv = scrollView();
    const view = p?.row ?? p?.target;
    const content = sv?.getInnerViewRef();
    if (!sv || !view || !content || typeof view.measureLayout !== 'function') return;
    view.measureLayout(
      content,
      (_x, y, _w, h) => {
        const { viewport, content: height } = size.current;
        if (!viewport) return;
        const next = focusScrollOffset({ offset: goal.current, top: y, bottom: y + h, viewport, content: height, margin: Math.round(viewport * FOCUS_SCROLL_MARGIN) });
        if (Math.abs(next - goal.current) < 1) return;
        goal.current = next;
        glidingUntil.current = Date.now() + GLIDE_MS;
        sv.scrollTo({ y: next, animated: true });
      },
      () => undefined,
    );
  }, [scrollView]);

  const queue = useCallback(
    (target: FocusTarget | null, row: FocusTarget | null) => {
      const first = !pending.current;
      pending.current = { target: target ?? pending.current?.target ?? null, row: row ?? pending.current?.row ?? null };
      if (first) setTimeout(flush, 0);
    },
    [flush],
  );

  const { onLayout, onContentSizeChange, onScroll } = own;
  const props = useMemo<PageProps>(
    () => ({
      ...tvDrivenScroll,
      onLayout: (e: LayoutChangeEvent) => {
        size.current.viewport = e.nativeEvent.layout.height;
        onLayout?.(e);
      },
      onContentSizeChange: (w: number, h: number) => {
        size.current.content = h;
        // The content got shorter: the page is at its end now.
        goal.current = Math.min(goal.current, Math.max(0, h - size.current.viewport));
        onContentSizeChange?.(w, h);
      },
      onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (Date.now() > glidingUntil.current) goal.current = e.nativeEvent.contentOffset.y;
        onScroll?.(e);
      },
      onFocusCapture: (e) => queue(e.target as unknown as FocusTarget, null),
    }),
    [onContentSizeChange, onLayout, onScroll, queue],
  );
  const page = useMemo<TvRowPage>(() => ({ scrollTo: (row) => queue(null, row), track: () => () => undefined }), [queue]);

  return driven ? { props, page } : { props: {}, page: null };
}

/** A vertical ScrollView whose TV focus scroll glides and stops at the end. */
export function TvScrollView({ ref, children, onLayout, onContentSizeChange, onScroll, ...rest }: ScrollViewProps & { ref?: Ref<ScrollHandle>; children?: ReactNode }) {
  const own = useRef<ScrollHandle | null>(null);
  const tv = useTvPageScroll(useCallback(() => own.current, []), { onLayout, onContentSizeChange, onScroll });
  const setRef = useCallback(
    (v: ScrollHandle | null) => {
      own.current = v;
      if (typeof ref === 'function') ref(v);
      else if (ref) (ref as RefObject<ScrollHandle | null>).current = v;
    },
    [ref],
  );
  return (
    <ScrollView ref={setRef} onLayout={onLayout} onContentSizeChange={onContentSizeChange} onScroll={onScroll} {...rest} {...tv.props}>
      {tv.page ? <TvRowScroll.Provider value={tv.page}>{children}</TvRowScroll.Provider> : children}
    </ScrollView>
  );
}
