/**
 * Where a panel's `openPage` goes. When the page is already in the stack
 * under the panel (or is the root of the extension tab that shows), the
 * app goes back to that screen instead of pushing a second copy.
 *
 * Rules:
 * - Only the stack of the tab that shows under the panel counts: a copy of
 *   the page in another tab is not "under the panel".
 * - A page route matches when its `ext` and `page` params match and it has
 *   no `section` (a "See all" screen is another screen). The top-most match
 *   wins; `pop` is the number of screens above it.
 * - The root of the extension tab (`ext-tab`) matches when the page fills
 *   the tab slot.
 *
 * Pure, so it is unit-tested.
 */
export interface NavRoute {
  name: string;
  params?: object;
  state?: NavState;
}

export interface NavState {
  type?: string;
  index?: number;
  routes: NavRoute[];
}

export interface PageRef {
  extId: string;
  pageId: string;
}

const PAGE_ROUTE = 'ext/[ext]/[page]';
const TAB_ROOT_ROUTE = 'ext-tab';
const EXT_TAB = '(ext)';

function param(route: NavRoute, key: string): string | undefined {
  const v = (route.params as Record<string, unknown> | undefined)?.[key];
  return typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;
}

function isPage(route: NavRoute, target: PageRef): boolean {
  return route.name.endsWith(PAGE_ROUTE) && param(route, 'ext') === target.extId && param(route, 'page') === target.pageId && !param(route, 'section');
}

/** The focused route of a state, or the route under the panel when the panel is focused there. */
function focusedBelow(state: NavState, panelRoute: string): NavRoute | undefined {
  let i = state.index ?? state.routes.length - 1;
  while (i >= 0 && state.routes[i]?.name === panelRoute) i--;
  return state.routes[i];
}

/**
 * The page under the panel: how many screens to go back to reach it, or null
 * when it is not there (then the app pushes it). `panelRoute` is the name of
 * the panel's route, left out when it is on top of the root stack.
 */
export function findOpenPage(root: NavState | undefined, target: PageRef, opts: { panelRoute: string; tabSlot?: PageRef | null }): { pop: number } | null {
  if (!root?.routes.length) return null;
  // Follow the focused chain down to the deepest stack, taking the route
  // under the panel wherever the panel is the focused one (the root stack
  // can sit inside a wrapper route, so this is checked at every level).
  let route: NavRoute | undefined = focusedBelow(root, opts.panelRoute);
  let stack: NavState | null = null;
  let inExtTab = false;
  while (route) {
    if (route.name === EXT_TAB) inExtTab = true;
    const st: NavState | undefined = route.state;
    if (!st?.routes.length) break;
    if (st.type === 'stack') stack = st;
    route = focusedBelow(st, opts.panelRoute);
  }
  if (stack) {
    for (let j = stack.routes.length - 1; j >= 0; j--) {
      if (isPage(stack.routes[j], target)) return { pop: stack.routes.length - 1 - j };
    }
  }
  const slot = opts.tabSlot;
  if (inExtTab && slot && slot.extId === target.extId && slot.pageId === target.pageId) {
    if (!stack) return { pop: 0 };
    const rootIdx = stack.routes.findIndex((r) => r.name.endsWith(TAB_ROOT_ROUTE));
    if (rootIdx >= 0) return { pop: stack.routes.length - 1 - rootIdx };
  }
  return null;
}
