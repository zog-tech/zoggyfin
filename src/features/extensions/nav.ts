/**
 * Where extension pages live: `ext/[ext]/[page]` and
 * `ext/[ext]/entry/[entry]`, shared by the Home, Library, Search and
 * extension tab stacks (`src/app/(tabs)/(home,library,search,ext)/ext/`), so
 * a page stays in the tab that opened it. A page opened from Settings or a
 * Home row is in Home. The `(ext)` tab shows the page that fills the tab slot
 * (`placement.ts`) at `(ext)/ext-tab`.
 */
import { type Href, useSegments } from 'expo-router';

export type ExtGroup = '(home)' | '(library)' | '(search)' | '(ext)';

const GROUPS: readonly ExtGroup[] = ['(ext)', '(home)', '(library)', '(search)'];

/** The group of a route's segments, or Home. */
export function extGroupOf(segments: readonly string[]): ExtGroup {
  return segments.find((s): s is ExtGroup => (GROUPS as readonly string[]).includes(s)) ?? '(home)';
}

/** The stack the user is in, for pushes that stay in it. */
export function useExtGroup(): ExtGroup {
  return extGroupOf(useSegments() as string[]);
}

/** An extension page; with `section`, that section on its own ("See all"). */
export function pageHref(group: ExtGroup, extId: string, pageId: string, section?: string): Href {
  const params: Record<string, string> = { ext: extId, page: pageId };
  if (section) params.section = section;
  return { pathname: `/(tabs)/${group}/ext/[ext]/[page]`, params } as unknown as Href;
}

/**
 * The page of one entry. `detail` is the entry's detail URL (checked again
 * against the extension's origin when the route opens); `title` lets the
 * page show a title before the detail loads.
 */
export function entryHref(group: ExtGroup, extId: string, entry: { key: string; detail: string; title?: string }): Href {
  const params: Record<string, string> = { ext: extId, entry: entry.key, detail: entry.detail };
  if (entry.title) params.title = entry.title;
  return { pathname: `/(tabs)/${group}/ext/[ext]/entry/[entry]`, params } as unknown as Href;
}

/** The pathname (no groups) of a page, as `usePathname()` gives it: the TV side menu marks its entry with it. */
export function pagePathname(extId: string, pageId: string): string {
  return `/ext/${extId}/${pageId}`;
}
