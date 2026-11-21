/**
 * The tab stack a screen belongs to, given by each tab's stack layout.
 *
 * The tab-group hooks (`useTabGroup`, `useLiveGroup`, `useExtGroup`) read this
 * before the global route segments. The segments name the focused tab, so a
 * screen in a tab that is not focused (kept mounted under another tab) saw a
 * new group on every tab switch: its open-item callbacks changed and every tile
 * in its rows rendered again, which held the TV for seconds per switch. A
 * screen's own tab never changes, so its callbacks stay the same.
 *
 * Screens outside the tab stacks (the players, modals) have no value here and
 * keep the segments.
 */
import { createContext, useContext } from 'react';

export const OwnTab = createContext<string | null>(null);

/** The tab group of the stack this screen is in, as `(home)`, or null outside the tab stacks. */
export function useOwnTab(): string | null {
  return useContext(OwnTab);
}

/** `own` when it is one of `groups`, else the first of `groups` in the route segments. Pure, so it is unit-tested. */
export function pickGroup<G extends string>(own: string | null, segments: readonly string[], groups: readonly G[]): G | undefined {
  const isGroup = (s: string): s is G => (groups as readonly string[]).includes(s);
  if (own && isGroup(own)) return own;
  return segments.find(isGroup);
}
