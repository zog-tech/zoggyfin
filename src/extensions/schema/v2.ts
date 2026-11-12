/**
 * The manifest of schema version 2: native pages of feed sections, skip
 * labels for the player, and the `playback` and `downloads` permissions.
 * `homeSections` is gone: a Home row is a page section named in
 * `placement.home`. Pure, so it is unit-tested.
 */
import { z } from 'zod';

import { headersSchema, headFields, id, label, path, PERMISSIONS, SHAPES, v1Contributions } from './common';

export const MAX_PAGES = 5;
export const MAX_SECTIONS_PER_PAGE = 8;
export const MAX_SKIP_LABELS = 10;
export const MIN_TABS = 2;
export const MAX_TABS = 6;

export const LAYOUTS = ['row', 'grid', 'list'] as const;
export type Layout = (typeof LAYOUTS)[number];

/** One block of a page, filled from a paged feed. */
export const sectionSchema = z.object({
  id,
  title: label,
  /** `row`: one horizontal row. `grid` and `list` load more pages near the end. */
  layout: z.enum(LAYOUTS).default('row'),
  shape: z.enum(SHAPES).default('thumb'),
  /** A feed: `{ "items": [...], "next": "<cursor>" }` (see docs/extensions.md). */
  feed: path,
  /** Fetch the feed again after this many seconds (5 or more). */
  refreshSeconds: z.number().int().min(5).max(3600).optional(),
});
export type SectionSpec = z.infer<typeof sectionSchema>;

export const placementSchema = z.object({
  /** The page may show as a tab. */
  tab: z.boolean().default(false),
  /** The page shows as a tile in the Library grid. */
  library: z.boolean().default(false),
  /** Ids of this page's sections that also show as Home rows, in this order. */
  home: z.array(id).max(MAX_SECTIONS_PER_PAGE).default([]),
});
export type Placement = z.infer<typeof placementSchema>;

export const MAX_SEARCH_TITLE = 40;

/**
 * A search field. The feed gets `query` and `cursor`. `global`: the main
 * Search tab also sends its text to this feed and shows the results as a
 * section titled `title` (else the page title). Both are optional, so a
 * manifest without them reads as before, and an app version that does not
 * know them drops them.
 */
export const searchSchema = z.object({
  feed: path,
  placeholder: z.string().max(80).optional(),
  global: z.boolean().optional(),
  title: z.string().trim().min(1).max(MAX_SEARCH_TITLE).optional(),
});
export type SearchSpec = z.infer<typeof searchSchema>;

/** One tab of a page: its own sections and, optionally, its own search (else the page's). */
export const tabSchema = z.object({
  id,
  title: label,
  sections: z.array(sectionSchema).min(1).max(MAX_SECTIONS_PER_PAGE),
  search: searchSchema.optional(),
});
export type TabSpec = z.infer<typeof tabSchema>;
export const tabsSchema = z.array(tabSchema).min(MIN_TABS).max(MAX_TABS);

/**
 * A page as written. `sections`, `tabs` or both: with both, `tabs` wins and
 * `sections` is what an app version without tabs shows. `tabs` is read on
 * its own (`normalize.ts`), so a bad `tabs` falls back to `sections`
 * instead of refusing the manifest.
 */
export const pageSchema = z.object({
  id,
  title: label,
  /** An icon name of the app (`src/components/icon-names.ts`). Another name shows a default icon. */
  icon: z.string().max(60).optional(),
  /** Artwork for the page's Library tile: a path under `baseUrl` or a URL on its origin (another origin is left out). */
  image: path.optional(),
  placement: placementSchema.default({ tab: false, library: false, home: [] }),
  /** A search field on the page (on every tab that has none of its own). */
  search: searchSchema.optional(),
  sections: z.array(sectionSchema).min(1).max(MAX_SECTIONS_PER_PAGE).optional(),
  tabs: z.unknown().optional(),
});
export type PageInput = z.infer<typeof pageSchema>;

/**
 * A page in the app's model. `sections` is always set: the page's own, or
 * the first tab's when the page has only tabs (so a saved manifest stays
 * valid for an app version without tabs). `tabs`, when set, is valid and wins.
 */
export type PageSpec = Omit<PageInput, 'sections' | 'tabs'> & { sections: SectionSpec[]; tabs?: TabSpec[] };

export const SKIP_MODES = ['auto', 'ask', 'off'] as const;
export type SkipMode = (typeof SKIP_MODES)[number];

/** A kind of media segment the player can skip (`segments[].label` in a stream description). */
export const skipLabelSchema = z.object({
  id,
  title: label,
  default: z.enum(SKIP_MODES).default('ask'),
});
export type SkipLabelSpec = z.infer<typeof skipLabelSchema>;

const { homeSections: _v1Only, ...kept } = v1Contributions;

export const manifestSchemaV2 = z.object({
  schemaVersion: z.literal(2),
  ...headFields,
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).default(['network']),
  headers: headersSchema,
  contributes: z
    .object({
      ...kept,
      pages: z.array(pageSchema).max(MAX_PAGES).optional(),
      skipLabels: z.array(skipLabelSchema).max(MAX_SKIP_LABELS).optional(),
    })
    .default({}),
});
export type ManifestV2 = z.infer<typeof manifestSchemaV2>;
