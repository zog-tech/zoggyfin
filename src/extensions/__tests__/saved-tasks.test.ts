import { forgetSavedTask, MAX_SAVED_TASKS, readSavedTasks, rememberTask, TASK_RESUME_MS, tasksToResume } from '../saved-tasks';

const ref = (u: string) => ({ title: 'Clip', statusUrl: u });
const NOW = 1_800_000_000_000;

describe('saved tasks per account', () => {
  it('resumes only the tasks of the signed-in account', () => {
    let list = rememberTask([], { extId: 'x', ref: ref('/s1'), at: NOW, account: 'A' });
    list = rememberTask(list, { extId: 'x', ref: ref('/s2'), at: NOW, account: 'B' });
    expect(tasksToResume(list, 'A', NOW).resume.map((t) => t.ref.statusUrl)).toEqual(['/s1']);
    expect(tasksToResume(list, 'B', NOW).resume.map((t) => t.ref.statusUrl)).toEqual(['/s2']);
  });

  it('gives an untagged task (saved by an older version) to the first account that resumes', () => {
    const old = readSavedTasks([{ extId: 'x', ref: ref('/s'), at: NOW - 1000 }]);
    const r = tasksToResume(old, 'A', NOW);
    expect(r.resume).toHaveLength(1);
    expect(r.keep[0].account).toBe('A');
    expect(tasksToResume(r.keep, 'B', NOW).resume).toEqual([]);
  });

  it('drops tasks older than a day and bad entries', () => {
    const list = readSavedTasks([{ extId: 'x', ref: ref('/old'), at: NOW - TASK_RESUME_MS - 1, account: 'A' }, { extId: 'x', ref: ref('/new'), at: NOW, account: 'A' }, 5, { extId: 'x' }, { extId: 'x', ref: {}, at: 1 }]);
    expect(list).toHaveLength(2);
    expect(tasksToResume(list, 'A', NOW).keep.map((t) => t.ref.statusUrl)).toEqual(['/new']);
    expect(readSavedTasks('junk')).toEqual([]);
  });

  it('forgets a task of one account only', () => {
    let list = rememberTask([], { extId: 'x', ref: ref('/s'), at: NOW, account: 'A' });
    list = rememberTask(list, { extId: 'x', ref: ref('/s'), at: NOW, account: 'B' });
    expect(list).toHaveLength(2);
    expect(forgetSavedTask(list, 'x', '/s', 'A').map((t) => t.account)).toEqual(['B']);
  });

  it('keeps at most the newest tasks', () => {
    let list: ReturnType<typeof readSavedTasks> = [];
    for (let i = 0; i < MAX_SAVED_TASKS + 5; i++) list = rememberTask(list, { extId: 'x', ref: ref(`/s${i}`), at: NOW, account: 'A' });
    expect(list).toHaveLength(MAX_SAVED_TASKS);
    expect(list[0].ref.statusUrl).toBe('/s5');
  });
});
