/**
 * One internal model for manifests of schema version 1 and 2.
 *
 * Rules:
 * - A v1 `homeSections` entry becomes a page with one `row` section, no tab,
 *   no Library tile, and that section on Home. The page and the section take
 *   the id of the home section.
 * - The model keeps `contributes.homeSections` as a view of the Home rows, so
 *   the code that draws Home rows today reads v1 and v2 manifests the same way.
 *   For v2, a row's id is `homeRowKey(page, section)`.
 * - The model keeps the shape that the store saved before v2 existed (a v1
 *   manifest with no `pages`). `pagesOf()` reads such a saved manifest too.
 *
 * Pure, so it is unit-tested.
 */
import type { z } from 'zod';

import type { HomeSectionSpec, Permission } from './common';
import { manifestSchemaV1, type ManifestV1 } from './v1';
import { manifestSchemaV2, type ManifestV2, type PageSpec, type SectionSpec, type SkipLabelSpec } from './v2';

export const SCHEMA_VERSIONS = [1, 2] as const;
export type SchemaVersion = (typeof SCHEMA_VERSIONS)[number];
/** The newest schema version the app reads. */
export const SCHEMA_VERSION: SchemaVersion = 2;

type Contributes = ManifestV1['contributes'] & {
  pages?: PageSpec[];
  skipLabels?: SkipLabelSpec[];
};

/** The internal model of a manifest. The lists in `contributes` are left out when they are empty. */
export type Manifest = Omit<ManifestV1, 'schemaVersion' | 'permissions' | 'contributes'> & {
  /** The version the author wrote. The model is the same for both. */
  schemaVersion: SchemaVersion;
  permissions: Permission[];
  contributes: Contributes;
};

export type ParseResult = { ok: true; manifest: Manifest } | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue?.path.length ? issue.path.join('.') : 'manifest';
  return `${where}: ${issue?.message ?? 'not valid'}`;
}

function duplicate(keys: string[]): string | undefined {
  return keys.find((k, i) => keys.indexOf(k) !== i);
}

/** The key of a v2 section in the Home row view. Ids cannot hold ":", so keys never collide. */
export function homeRowKey(pageId: string, sectionId: string): string {
  return pageId === sectionId ? sectionId : `${pageId}:${sectionId}`;
}

/** The page that a v1 Home row becomes. */
export function pageFromHomeSection(sec: HomeSectionSpec): PageSpec {
  const section: SectionSpec = { id: sec.id, title: sec.title, layout: 'row', shape: sec.shape, feed: sec.feed };
  if (sec.refreshSeconds !== undefined) section.refreshSeconds = sec.refreshSeconds;
  return { id: sec.id, title: sec.title, placement: { tab: false, library: false, home: [sec.id] }, sections: [section] };
}

/** The Home rows of v2 pages, in page order and then in `placement.home` order. */
export function homeSectionsOfPages(pages: PageSpec[]): HomeSectionSpec[] {
  const out: HomeSectionSpec[] = [];
  for (const page of pages) {
    for (const sid of page.placement.home) {
      const sec = page.sections.find((s) => s.id === sid);
      if (!sec) continue;
      const row: HomeSectionSpec = { id: homeRowKey(page.id, sec.id), title: sec.title, feed: sec.feed, shape: sec.shape };
      if (sec.refreshSeconds !== undefined) row.refreshSeconds = sec.refreshSeconds;
      out.push(row);
    }
  }
  return out;
}

/** The pages of a manifest, also for a v1 manifest the store saved before `pages` existed. */
export function pagesOf(m: Pick<Manifest, 'contributes'>): PageSpec[] {
  return m.contributes.pages ?? (m.contributes.homeSections ?? []).map(pageFromHomeSection);
}

function fromV1(m: ManifestV1): Manifest {
  const contributes: Contributes = { ...m.contributes };
  if (m.contributes.homeSections?.length) contributes.pages = m.contributes.homeSections.map(pageFromHomeSection);
  return { ...m, contributes };
}

function fromV2(m: ManifestV2): Manifest {
  const contributes: Contributes = { ...m.contributes };
  const rows = homeSectionsOfPages(m.contributes.pages ?? []);
  if (rows.length) contributes.homeSections = rows;
  return { ...m, contributes };
}

/** Checks the rules zod cannot: unique ids in each list, and Home rows that name a section of the page. */
function checkV2Pages(m: ManifestV2): string | null {
  for (const [i, page] of (m.contributes.pages ?? []).entries()) {
    const ids = page.sections.map((s) => s.id);
    const dup = duplicate(ids);
    if (dup) return `contributes.pages.${i}.sections: the id "${dup}" is used twice`;
    const homeDup = duplicate(page.placement.home);
    if (homeDup) return `contributes.pages.${i}.placement.home: the id "${homeDup}" is used twice`;
    const missing = page.placement.home.find((h) => !ids.includes(h));
    if (missing) return `contributes.pages.${i}.placement.home: the page has no section "${missing}"`;
  }
  return null;
}

/**
 * Validates a manifest of schema version 1 or 2 and returns the internal
 * model. The error names the first field that is wrong.
 */
export function parseManifest(data: unknown): ParseResult {
  const version = data && typeof data === 'object' && 'schemaVersion' in data ? (data as { schemaVersion: unknown }).schemaVersion : undefined;
  if (version !== undefined && !SCHEMA_VERSIONS.includes(version as SchemaVersion)) {
    return { ok: false, error: `This app reads manifest schema versions ${SCHEMA_VERSIONS.join(' and ')}. The manifest has version ${String(version)}.` };
  }
  let m: Manifest;
  if (version === 2) {
    const r = manifestSchemaV2.safeParse(data);
    if (!r.success) return { ok: false, error: firstIssue(r.error) };
    const bad = checkV2Pages(r.data);
    if (bad) return { ok: false, error: bad };
    m = fromV2(r.data);
  } else {
    // No version at all: the v1 schema names `schemaVersion` as the wrong field.
    const r = manifestSchemaV1.safeParse(data);
    if (!r.success) return { ok: false, error: firstIssue(r.error) };
    m = fromV1(r.data);
  }
  // Ids must be unique inside each list, so a contribution has one stable key.
  // For v1, `pages` copies `homeSections`, so its check never fires first.
  for (const [name, list] of Object.entries(m.contributes) as [string, { id?: string; key?: string }[] | undefined][]) {
    const dup = duplicate((list ?? []).map((e) => e.id ?? e.key ?? ''));
    if (dup) return { ok: false, error: `contributes.${name}: the id "${dup}" is used twice` };
  }
  if (!m.permissions.includes('network')) m.permissions = ['network', ...m.permissions];
  return { ok: true, manifest: m };
}
