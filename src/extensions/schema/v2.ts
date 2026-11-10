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

export const pageSchema = z.object({
  id,
  title: label,
  /** An icon name of the app (`src/components/icon-names.ts`). Another name shows a default icon. */
  icon: z.string().max(60).optional(),
  placement: placementSchema.default({ tab: false, library: false, home: [] }),
  /** A search field on the page. The feed gets `query` and `cursor`. */
  search: z.object({ feed: path, placeholder: z.string().max(80).optional() }).optional(),
  sections: z.array(sectionSchema).min(1).max(MAX_SECTIONS_PER_PAGE),
});
export type PageSpec = z.infer<typeof pageSchema>;

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
