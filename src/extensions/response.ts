/**
 * What an extension answers to an action, and to a task status poll. The
 * answer only asks the app to do a small, fixed set of things: show a toast,
 * follow a task, refresh the item, the entry, the page or the library, or
 * set the on/off state of a detail button.
 *
 * `entry` and `page` (schema version 2) refresh an extension detail page and
 * an extension page. Where the app has no such page (the item action sheet),
 * they do nothing.
 */
import { z } from 'zod';

export const REFRESH_KINDS = ['none', 'item', 'entry', 'page', 'library'] as const;
const refresh = z.enum(REFRESH_KINDS);
export type RefreshKind = (typeof REFRESH_KINDS)[number];

const toastSchema = z.union([z.string().max(200), z.object({ text: z.string().max(200) })]);

export const taskRefSchema = z.object({
  id: z.string().max(200).optional(),
  title: z.string().max(200),
  /** Polled with GET until `state` is "done" or "failed". Same origin as the extension. */
  statusUrl: z.string().min(1).max(500),
  intervalSeconds: z.number().min(1).max(60).optional(),
});
export type TaskRef = z.infer<typeof taskRefSchema>;

export const actionResponseSchema = z.looseObject({
  toast: toastSchema.optional(),
  task: taskRefSchema.optional(),
  refresh: refresh.optional(),
  /** The new state of an on/off button. A value that is not valid is ignored. */
  state: z.object({ on: z.boolean() }).optional().catch(undefined),
});
export type ActionResponse = z.infer<typeof actionResponseSchema>;

export const taskStatusSchema = z.looseObject({
  state: z.enum(['queued', 'running', 'done', 'failed']),
  /** 0 to 1. */
  progress: z.number().min(0).max(1).optional(),
  title: z.string().max(200).optional(),
  message: z.string().max(300).optional(),
  toast: toastSchema.optional(),
  refresh: refresh.optional(),
});
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export function toastText(t: z.infer<typeof toastSchema> | undefined): string | null {
  if (!t) return null;
  return typeof t === 'string' ? t : t.text;
}

/** The things the app does for a response. The runtime supplies them; tests supply fakes. */
export interface ResponseEffects {
  toast(text: string, kind: 'ok' | 'error'): void;
  startTask(task: TaskRef): void;
  refreshItem(): void;
  refreshLibrary(): void;
  /** An extension detail page reloads its entry. */
  refreshEntry?(): void;
  /** An extension page reloads its sections. */
  refreshPage?(): void;
}

/**
 * Applies an action response. An empty or unknown answer shows `fallback`.
 * Returns the parsed answer, or null when it was not valid.
 */
export function handleActionResponse(data: unknown, fx: ResponseEffects, fallback: string): ActionResponse | null {
  const r = actionResponseSchema.safeParse(data ?? {});
  if (!r.success) {
    fx.toast(fallback, 'ok');
    return null;
  }
  const res = r.data;
  const text = toastText(res.toast);
  if (res.task) fx.startTask(res.task);
  if (text) fx.toast(text, 'ok');
  else if (!res.task) fx.toast(fallback, 'ok');
  applyRefresh(res.refresh, fx);
  return res;
}

export function applyRefresh(kind: ActionResponse['refresh'], fx: Pick<ResponseEffects, 'refreshItem' | 'refreshLibrary' | 'refreshEntry' | 'refreshPage'>): void {
  if (kind === 'item') fx.refreshItem();
  else if (kind === 'entry') fx.refreshEntry?.();
  else if (kind === 'page') fx.refreshPage?.();
  else if (kind === 'library') fx.refreshLibrary();
}

export type TaskPhase = 'running' | 'done' | 'failed';

/**
 * Reads one status poll. A malformed answer counts as a failed poll, not a
 * failed task: the poller tries a few times before it gives up.
 */
export function readTaskStatus(data: unknown): TaskStatus | null {
  const r = taskStatusSchema.safeParse(data);
  return r.success ? r.data : null;
}

export function phaseOf(s: TaskStatus): TaskPhase {
  return s.state === 'done' ? 'done' : s.state === 'failed' ? 'failed' : 'running';
}
