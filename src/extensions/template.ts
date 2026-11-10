/**
 * Templates in extension requests: `{{item.id}}`, `{{input.folder}}`,
 * `{{settings.format}}`, `{{share.url}}`, `{{jellyfin.userId}}`,
 * `{{action.next}}` (the state an on/off detail button asks for). A template
 * only reads values; there are no expressions. An unknown name gives "".
 */

export type TemplateValue = string | number | boolean | null | undefined;

export interface TemplateContext {
  item?: Record<string, TemplateValue>;
  input?: Record<string, TemplateValue>;
  settings?: Record<string, TemplateValue>;
  share?: Record<string, TemplateValue>;
  jellyfin?: Record<string, TemplateValue>;
  /** A detail action: `next` is the on/off state the press asks for (a boolean). */
  action?: Record<string, TemplateValue>;
}

const TOKEN = /\{\{\s*([a-zA-Z]+)\.([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function lookup(ctx: TemplateContext, scope: string, key: string): string {
  const bag = (ctx as Record<string, Record<string, TemplateValue> | undefined>)[scope];
  if (!bag || !Object.prototype.hasOwnProperty.call(bag, key)) return '';
  const v = bag[key];
  return v === null || v === undefined ? '' : String(v);
}

/** Fills a template. `encode` runs on each value (for example for a URL path). */
export function render(template: string, ctx: TemplateContext, encode?: (v: string) => string): string {
  return template.replace(TOKEN, (_, scope: string, key: string) => {
    const v = lookup(ctx, scope, key);
    return encode ? encode(v) : v;
  });
}

/** The names a template uses, as "scope.key". */
export function namesIn(template: string): string[] {
  return [...template.matchAll(TOKEN)].map((m) => `${m[1]}.${m[2]}`);
}

/**
 * Fills every string in a JSON value. A string that is exactly one token of a
 * boolean or a number (a toggle setting, `{{action.next}}`) keeps its type.
 */
export function renderJson(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === 'string') {
    const whole = /^\{\{\s*([a-zA-Z]+)\.([a-zA-Z0-9_.-]+)\s*\}\}$/.exec(value);
    if (whole) {
      const bag = (ctx as Record<string, Record<string, TemplateValue> | undefined>)[whole[1]];
      const raw = bag && Object.prototype.hasOwnProperty.call(bag, whole[2]) ? bag[whole[2]] : undefined;
      if (typeof raw === 'boolean' || typeof raw === 'number') return raw;
    }
    return render(value, ctx);
  }
  if (Array.isArray(value)) return value.map((v) => renderJson(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderJson(v, ctx)]));
  }
  return value;
}

/** True when any string in the value uses a name in `scope` (for example "item.path"). */
export function usesName(value: unknown, name: string): boolean {
  if (typeof value === 'string') return namesIn(value).includes(name);
  if (Array.isArray(value)) return value.some((v) => usesName(v, name));
  if (value && typeof value === 'object') return Object.values(value).some((v) => usesName(v, name));
  return false;
}
