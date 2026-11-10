/**
 * The running tasks the app follows again after a restart
 * (`extensions.tasks.v1`). Each saved task names the account that started
 * it (`<serverId>.<userId>`), because its status requests carry that
 * account's settings and, with the grant, its token. A task saved before
 * extensions were per account has no account: the first account that
 * resumes tasks takes it (the one that was signed in when it started).
 *
 * Pure, so it is unit-tested.
 */
import type { TaskRef } from './response';

export const TASKS_KEY = 'extensions.tasks.v1';
/** Tasks older than this are not followed again. */
export const TASK_RESUME_MS = 24 * 60 * 60 * 1000;
/** The most saved tasks. */
export const MAX_SAVED_TASKS = 20;

export interface SavedTask {
  extId: string;
  ref: TaskRef;
  at: number;
  /** The account key. Missing only in tasks saved by an older version. */
  account?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The saved list, with bad entries dropped. Never throws. */
export function readSavedTasks(raw: unknown): SavedTask[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedTask[] = [];
  for (const t of raw) {
    if (!isObject(t) || typeof t.extId !== 'string' || !isObject(t.ref) || typeof t.ref.statusUrl !== 'string' || typeof t.at !== 'number') continue;
    const task: SavedTask = { extId: t.extId, ref: t.ref as unknown as TaskRef, at: t.at };
    if (typeof t.account === 'string' && t.account) task.account = t.account;
    out.push(task);
  }
  return out;
}

const same = (a: SavedTask, extId: string, statusUrl: string, account: string) => a.extId === extId && a.ref.statusUrl === statusUrl && (a.account ?? account) === account;

/** Adds (or moves to the end) a task of an account. */
export function rememberTask(list: readonly SavedTask[], task: SavedTask & { account: string }): SavedTask[] {
  return [...list.filter((t) => !same(t, task.extId, task.ref.statusUrl, task.account)), task].slice(-MAX_SAVED_TASKS);
}

export function forgetSavedTask(list: readonly SavedTask[], extId: string, statusUrl: string, account: string): SavedTask[] {
  return list.filter((t) => !same(t, extId, statusUrl, account));
}

/**
 * The tasks an account follows again now, and the list to save: old tasks
 * go, and untagged tasks become this account's.
 */
export function tasksToResume(list: readonly SavedTask[], account: string, now: number): { resume: SavedTask[]; keep: SavedTask[] } {
  const keep = list.filter((t) => now - t.at < TASK_RESUME_MS).map((t) => (t.account ? t : { ...t, account }));
  return { resume: keep.filter((t) => t.account === account), keep };
}
