/**
 * Navigation to a tab that an extension page may have replaced on this
 * phone. The rules are in `lib/tab-destination.ts` (pure, tested); this file
 * gives them the current choice from the extension store. Use it for every
 * jump to a tab root ("Go to Downloads", "Browse library") and for every
 * push into a tab's stack by name (the music player's "open" actions).
 */
import { type Href, router, useFocusEffect, useSegments } from 'expo-router';
import { useCallback } from 'react';

import { isPushedRoot, type ReplaceableTab, rewriteTabPath, type TabDestination, tabGroupFor, tabRootHref } from '@/lib/tab-destination';

import { replacedTabNow, useReplacedTab } from './use-placement';

/** The route of a tab's first screen now. */
export function tabRootNow(dest: TabDestination): Href {
  return tabRootHref(dest, replacedTabNow()) as Href;
}

/** Opens a tab's first screen: its tab, or the screen's place in another stack when the tab is replaced. */
export function openTabRoot(dest: TabDestination): void {
  router.navigate(tabRootNow(dest));
}

/** The stack to push a shared detail route into, for a page that belongs to `group`. */
export function tabGroupNow<G extends string>(group: G): G | '(home)' | '(library)' {
  return tabGroupFor(group, replacedTabNow());
}

/** A system path that never lands in a replaced tab (`+native-intent.tsx`). */
export function rewriteSystemPath(path: string): string {
  return rewriteTabPath(path, replacedTabNow());
}

/**
 * For a tab's first screen. Returns true when it shows in another stack
 * (`more/`): the screen then takes a back button instead of the root
 * options. When it is focused in its own tab while that tab is replaced (a
 * stale link), it opens itself in its new place.
 */
export function useTabRootPlace(own: ReplaceableTab, dest: TabDestination): boolean {
  const segments = useSegments() as string[];
  const replaced = useReplacedTab();
  const pushed = isPushedRoot(own, segments);
  const stale = !pushed && replaced === own && segments.includes(own);
  useFocusEffect(
    useCallback(() => {
      if (stale) router.replace(tabRootHref(dest, own) as Href);
    }, [stale, dest, own]),
  );
  return pushed;
}
