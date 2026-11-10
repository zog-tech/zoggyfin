/**
 * Where extension pages live: `ext/[ext]/[page]` and
 * `ext/[ext]/entry/[entry]`, shared by the Home, Library and Search stacks
 * (`src/app/(tabs)/(home,library,search)/ext/`), so a page stays in the tab
 * that opened it. A page opened from Settings or a Home row is in Home.
 */
import { type Href, useSegments } from 'expo-router';

export type ExtGroup = '(home)' | '(library)' | '(search)';

const GROUPS: readonly ExtGroup[] = ['(home)', '(library)', '(search)'];

/** The stack the user is in, for pushes that stay in it. */
export function useExtGroup(): ExtGroup {
  const segments = useSegments() as string[];
  return segments.find((s): s is ExtGroup => (GROUPS as readonly string[]).includes(s)) ?? '(home)';
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
