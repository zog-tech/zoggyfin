/**
 * Route params of the extension page and entry routes, read back into the
 * manifest's pages and sections. Route params come from links too, so
 * every value is checked: an unknown page or section gives null, and a
 * detail URL that is not on the extension's origin is refused.
 *
 * Pure, so it is unit-tested.
 */
import { homeRowKey, pagesOf, type Manifest, type PageSpec, type SectionSpec } from '@/extensions/schema';
import { urlOnOrigin } from '@/extensions/match';

type Param = string | string[] | undefined;

/** The first value of a route param, or undefined when it is empty. */
export function firstParam(v: Param): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s ? s : undefined;
}

export interface PageRoute {
  page: PageSpec;
  /** The sections the screen shows, in order. */
  sections: SectionSpec[];
  /** Set when the screen shows one section on its own ("See all"). */
  section?: SectionSpec;
}

/** The page (and the section for "See all") that the params name, or null. */
export function resolvePageRoute(m: Pick<Manifest, 'contributes'> | undefined, params: { page?: Param; section?: Param }): PageRoute | null {
  if (!m) return null;
  const pageId = firstParam(params.page);
  const page = pagesOf(m).find((p) => p.id === pageId);
  if (!page) return null;
  const sectionId = firstParam(params.section);
  if (!sectionId) return { page, sections: page.sections };
  const section = page.sections.find((s) => s.id === sectionId);
  return section ? { page, sections: [section], section } : null;
}

/** The page and section behind a Home row id (`homeRowKey`), or null. */
export function resolveHomeRow(m: Pick<Manifest, 'contributes'> | undefined, rowKey: string): { page: PageSpec; section: SectionSpec } | null {
  if (!m) return null;
  for (const page of pagesOf(m)) {
    for (const sid of page.placement.home) {
      if (homeRowKey(page.id, sid) !== rowKey) continue;
      const section = page.sections.find((s) => s.id === sid);
      if (section) return { page, section };
    }
  }
  return null;
}

export interface EntryRoute {
  extId: string;
  entryId: string;
  /** The detail URL, on the extension's origin. */
  detail: string;
  /** The title the tile showed, so the screen has a title before the detail loads. */
  title?: string;
}

/** Reads the entry route params. Null when a value is missing or the detail URL is on another origin. */
export function parseEntryRoute(params: { ext?: Param; entry?: Param; detail?: Param; title?: Param }, baseUrl: string | undefined): EntryRoute | null {
  const extId = firstParam(params.ext);
  const entryId = firstParam(params.entry);
  const detail = baseUrl ? urlOnOrigin(baseUrl, firstParam(params.detail)) : undefined;
  if (!extId || !entryId || !detail) return null;
  const title = firstParam(params.title)?.slice(0, 200);
  return title ? { extId, entryId, detail, title } : { extId, entryId, detail };
}
