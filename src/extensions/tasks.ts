/**
 * Progress tasks. An action can answer with a task; the app polls the
 * task's status URL and shows the progress in a Home row until it ends.
 */
import { create } from 'zustand';

import { phaseOf, readTaskStatus, type TaskPhase, type TaskRef, type TaskStatus } from './response';

export interface Task {
  key: string;
  extensionId: string;
  extensionName: string;
  title: string;
  progress: number | null;
  phase: TaskPhase;
  message?: string;
  startedAt: number;
  /** The account that started it (`<serverId>.<userId>`). */
  account?: string;
}

interface TasksState {
  tasks: Task[];
}

export const useTasks = create<TasksState>(() => ({ tasks: [] }));

function patch(key: string, p: Partial<Task>): void {
  useTasks.setState((st) => ({ tasks: st.tasks.map((t) => (t.key === key ? { ...t, ...p } : t)) }));
}

function drop(key: string): void {
  useTasks.setState((st) => ({ tasks: st.tasks.filter((t) => t.key !== key) }));
}

/**
 * An account switch: the tasks of other accounts leave the list, which also
 * stops their polls (a poll ends when its task is gone). They stay saved and
 * resume when that account is back.
 */
export function stopTasksExcept(account: string | null): void {
  useTasks.setState((st) => {
    const tasks = st.tasks.filter((t) => !t.account || t.account === account);
    return tasks.length === st.tasks.length ? st : { tasks };
  });
}

export function clearFinishedTasks(): void {
  useTasks.setState((st) => ({ tasks: st.tasks.filter((t) => t.phase === 'running') }));
}

export interface PollDeps {
  /** GETs the status URL (same origin as the extension) and returns the JSON. */
  fetchStatus(statusUrl: string): Promise<unknown>;
  onDone(status: TaskStatus, task: Task): void;
  onFailed(message: string, task: Task): void;
  /** Timers, so tests can drive them. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  now?: () => number;
}

/** A poll that fails this many times in a row ends the task. */
export const MAX_POLL_FAILURES = 4;
/** No task is followed for longer than this. */
export const MAX_TASK_MS = 3 * 60 * 60 * 1000;
/** A finished task stays in the list this long. */
export const KEEP_FINISHED_MS = 10_000;

let seq = 0;

/** Starts to follow a task. Returns its key. */
export function startTask(ref: TaskRef, ext: { id: string; name: string; account?: string }, deps: PollDeps): string {
  const timer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const now = deps.now ?? Date.now;
  const key = `${ext.id}:${ref.id ?? ref.statusUrl}:${++seq}`;
  const task: Task = { key, extensionId: ext.id, extensionName: ext.name, title: ref.title, progress: null, phase: 'running', startedAt: now() };
  if (ext.account) task.account = ext.account;
  // The same task again (same id) replaces the old entry.
  useTasks.setState((st) => ({ tasks: [...st.tasks.filter((t) => !(ref.id && t.extensionId === ext.id && t.key.startsWith(`${ext.id}:${ref.id}:`))), task] }));
  const interval = Math.max(1, ref.intervalSeconds ?? 2) * 1000;
  let failures = 0;

  const finish = (phase: TaskPhase, p: Partial<Task>) => {
    patch(key, { ...p, phase });
    timer(() => drop(key), KEEP_FINISHED_MS);
  };

  const tick = async () => {
    const current = useTasks.getState().tasks.find((t) => t.key === key);
    if (!current || current.phase !== 'running') return;
    if (now() - task.startedAt > MAX_TASK_MS) {
      finish('failed', { message: 'The task takes too long. The app stopped following it.' });
      deps.onFailed('The task takes too long.', current);
      return;
    }
    let status: TaskStatus | null = null;
    try {
      status = readTaskStatus(await deps.fetchStatus(ref.statusUrl));
    } catch {
      status = null;
    }
    if (!status) {
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) {
        const msg = 'Lost contact with the extension.';
        finish('failed', { message: msg });
        deps.onFailed(msg, current);
        return;
      }
      timer(() => void tick(), interval);
      return;
    }
    failures = 0;
    const phase = phaseOf(status);
    const p: Partial<Task> = {
      progress: status.progress ?? (phase === 'done' ? 1 : current.progress),
      title: status.title ?? current.title,
      message: status.message,
    };
    if (phase === 'running') {
      patch(key, p);
      timer(() => void tick(), interval);
    } else if (phase === 'done') {
      finish('done', { ...p, progress: 1 });
      deps.onDone(status, { ...current, ...p, phase });
    } else {
      finish('failed', p);
      deps.onFailed(status.message ?? 'The task failed.', { ...current, ...p, phase });
    }
  };

  timer(() => void tick(), Math.min(interval, 1000));
  return key;
}
