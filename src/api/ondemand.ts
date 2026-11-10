/**
 * The answer of an optional server plugin that adds a music catalog
 * (`GET /OnDemand/Home`). Most servers do not have it, so the app treats
 * anything that does not fit the shape as "no plugin": the parser drops
 * malformed sections and items and never throws.
 *
 * The server chooses the sections, their titles and their order, so a new
 * row needs no app update. A newer `Version` still parses when its shape fits.
 *
 * Pure, so it is unit-tested.
 */
import type { BaseItemDto } from './types';

export interface OnDemandSection {
  id: string;
  title: string;
  /** The item type the server names for the row. A hint only: tiles follow the items. */
  itemType: string | undefined;
  items: BaseItemDto[];
}

export interface OnDemandHome {
  version: number;
  sections: OnDemandSection[];
}

/** The most items one row keeps. */
export const ONDEMAND_MAX_ITEMS = 50;
/** The most rows the page shows. */
export const ONDEMAND_MAX_SECTIONS = 12;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** An item needs an Id, a name and a type: the tile, the item page and playback read them. */
function parseItem(v: unknown): BaseItemDto | null {
  if (!isRecord(v) || !text(v.Id) || !text(v.Name) || !text(v.Type)) return null;
  return v as BaseItemDto;
}

function parseSection(v: unknown, maxItems: number): OnDemandSection | null {
  if (!isRecord(v) || !Array.isArray(v.Items)) return null;
  const id = text(v.Id);
  const title = text(v.Title);
  if (!id || !title) return null;
  const items: BaseItemDto[] = [];
  const seen = new Set<string>();
  for (const raw of v.Items) {
    const item = parseItem(raw);
    if (!item || seen.has(item.Id ?? '')) continue;
    seen.add(item.Id ?? '');
    items.push(item);
    if (items.length >= maxItems) break;
  }
  if (!items.length) return null;
  return { id, title, itemType: text(v.ItemType), items };
}

/** The plugin's Home answer, or null when the body is not one. Empty and broken sections are dropped. */
export function parseOnDemandHome(body: unknown, maxItems = ONDEMAND_MAX_ITEMS): OnDemandHome | null {
  if (!isRecord(body) || !Array.isArray(body.Sections)) return null;
  const version = body.Version === undefined ? 1 : body.Version;
  if (typeof version !== 'number' || !Number.isFinite(version) || version < 1) return null;
  const sections: OnDemandSection[] = [];
  const ids = new Set<string>();
  for (const raw of body.Sections) {
    const sec = parseSection(raw, maxItems);
    if (!sec || ids.has(sec.id)) continue;
    ids.add(sec.id);
    sections.push(sec);
    if (sections.length >= ONDEMAND_MAX_SECTIONS) break;
  }
  return { version, sections };
}

/**
 * Whether a failed request means "no plugin" (the server answered with an
 * HTTP error, such as 404) rather than "no server" (no answer at all).
 */
export function isOnDemandAbsent(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const res = error.response;
  return isRecord(res) && typeof res.status === 'number';
}
