/**
 * The detail description of a feed entry (`GET entry.detail`): a title,
 * pictures, text, the media to play, buttons and more feed sections.
 *
 * Rules:
 * - `title` is required; without it the reply is not a detail and throws.
 * - Every other field, action, line and section is read on its own; a bad
 *   one is left out.
 *   An action or a section id used twice keeps the first.
 * - Every URL must be on the extension's origin. A picture on another origin
 *   is left out. An action whose request path, or a section whose feed, is on
 *   another origin is left out.
 * - An action with `state` is an on/off button. Its request can use
 *   `{{action.next}}`, the value the button asks for.
 *
 * Pure, so it is unit-tested.
 */
import { z } from 'zod';

import { ExtensionError } from '../http';
import { urlOnOrigin } from '../match';
import { confirmSchema, id, inputSchema, label, requestSchema } from '../schema/common';
import { MAX_SECTIONS_PER_PAGE, sectionSchema, type SectionSpec } from '../schema/v2';
import { type MediaRef, readMediaRef } from './entry';

export const MAX_DETAIL_ACTIONS = 6;
export const MAX_DETAIL_LINES = 6;

const stateSchema = z.object({
  on: z.boolean(),
  /** The title while the state is on. */
  onTitle: label.optional(),
  /** The icon while the state is on. */
  onIcon: z.string().max(60).optional(),
});
export type ActionState = z.infer<typeof stateSchema>;

export const detailActionSchema = z.object({
  id,
  title: label,
  icon: z.string().max(60).optional(),
  destructive: z.boolean().optional(),
  state: stateSchema.optional(),
  confirm: confirmSchema.optional(),
  inputs: z.array(inputSchema).max(5).optional(),
  request: requestSchema,
});
export type DetailAction = z.infer<typeof detailActionSchema>;

const titleSchema = z.string().min(1).max(200);
const eyebrowSchema = z.string().min(1).max(120);
const pictureSchema = z.string().min(1).max(1000);
const descriptionSchema = z.string().min(1).max(5000);
const progressSchema = z.number().min(0).max(1);

/** The value when it fits the schema, else undefined: one bad field never hides the rest. */
function pick<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const r = schema.safeParse(value);
  return r.success ? r.data : undefined;
}

export interface DetailDescription {
  title: string;
  eyebrow?: string;
  /** Full URLs on the extension's origin. */
  imageUrl?: string;
  backdropUrl?: string;
  /** Short facts under the title, for example "12 min". */
  lines: string[];
  description?: string;
  media?: MediaRef;
  progress?: number;
  actions: DetailAction[];
  sections: SectionSpec[];
}

function list(data: unknown, key: string): unknown[] {
  const v = (data as Record<string, unknown>)[key];
  return Array.isArray(v) ? v : [];
}

/** Reads a detail description. Throws `ExtensionError` (with no URL) when it is not one. */
export function parseDetail(data: unknown, baseUrl: string): DetailDescription {
  if (!data || typeof data !== 'object') throw new ExtensionError('The extension sent a page the app cannot read.');
  const d = data as Record<string, unknown>;
  const title = pick(titleSchema, d.title);
  if (!title) throw new ExtensionError('The extension sent a page the app cannot read.');
  const out: DetailDescription = { title, lines: [], actions: [], sections: [] };
  const eyebrow = pick(eyebrowSchema, d.eyebrow);
  if (eyebrow) out.eyebrow = eyebrow;
  const imageUrl = urlOnOrigin(baseUrl, pick(pictureSchema, d.image));
  if (imageUrl) out.imageUrl = imageUrl;
  const backdropUrl = urlOnOrigin(baseUrl, pick(pictureSchema, d.backdrop));
  if (backdropUrl) out.backdropUrl = backdropUrl;
  const description = pick(descriptionSchema, d.description);
  if (description) out.description = description;
  const progress = pick(progressSchema, d.progress);
  if (progress !== undefined) out.progress = progress;

  for (const line of list(data, 'lines')) {
    if (typeof line === 'string' && line.trim() && line.length <= 120 && out.lines.length < MAX_DETAIL_LINES) out.lines.push(line);
  }

  const media = (data as { media?: unknown }).media;
  if (media !== undefined) {
    const ref = readMediaRef(media, baseUrl);
    if (ref) out.media = ref;
  }

  for (const raw of list(data, 'actions')) {
    if (out.actions.length >= MAX_DETAIL_ACTIONS) break;
    const a = detailActionSchema.safeParse(raw);
    if (!a.success || out.actions.some((x) => x.id === a.data.id)) continue;
    if (!urlOnOrigin(baseUrl, a.data.request.path)) continue;
    out.actions.push(a.data);
  }

  for (const raw of list(data, 'sections')) {
    if (out.sections.length >= MAX_SECTIONS_PER_PAGE) break;
    const s = sectionSchema.safeParse(raw);
    if (!s.success || out.sections.some((x) => x.id === s.data.id)) continue;
    if (!urlOnOrigin(baseUrl, s.data.feed)) continue;
    out.sections.push(s.data);
  }
  return out;
}
