import { KEEP_FINISHED_MS, MAX_POLL_FAILURES, startTask, stopTasksExcept, useTasks } from '../tasks';

function harness(answers: unknown[]) {
  const timers: { fn: () => void; ms: number }[] = [];
  const fetchStatus = jest.fn(async () => {
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return a;
  });
  const deps = { fetchStatus, onDone: jest.fn(), onFailed: jest.fn(), setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }), now: () => 0 };
  const step = async () => {
    const t = timers.shift();
    t?.fn();
    await new Promise<void>((r) => setTimeout(r, 0));
    return t;
  };
  return { deps, step, timers };
}

beforeEach(() => useTasks.setState({ tasks: [] }));

describe('tasks', () => {
  it('follows a task to the end', async () => {
    const h = harness([{ state: 'running', progress: 0.4 }, { state: 'done', toast: 'Saved' }]);
    startTask({ id: 'd1', title: 'Clip', statusUrl: '/s' }, { id: 'x', name: 'X' }, h.deps);
    await h.step();
    expect(useTasks.getState().tasks[0]).toMatchObject({ progress: 0.4, phase: 'running' });
    await h.step();
    expect(useTasks.getState().tasks[0]).toMatchObject({ progress: 1, phase: 'done' });
    expect(h.deps.onDone).toHaveBeenCalled();
    // The finished task goes away after a short time.
    const drop = h.timers.find((t) => t.ms === KEEP_FINISHED_MS);
    drop?.fn();
    expect(useTasks.getState().tasks).toHaveLength(0);
  });

  it('reports a failed task', async () => {
    const h = harness([{ state: 'failed', message: 'No space' }]);
    startTask({ title: 'Clip', statusUrl: '/s' }, { id: 'x', name: 'X' }, h.deps);
    await h.step();
    expect(h.deps.onFailed).toHaveBeenCalledWith('No space', expect.anything());
    expect(useTasks.getState().tasks[0].phase).toBe('failed');
  });

  it('gives up after repeated poll failures', async () => {
    const h = harness(Array.from({ length: MAX_POLL_FAILURES }, () => new Error('down')));
    startTask({ title: 'Clip', statusUrl: '/s' }, { id: 'x', name: 'X' }, h.deps);
    for (let i = 0; i < MAX_POLL_FAILURES; i++) await h.step();
    expect(h.deps.onFailed).toHaveBeenCalledWith('Lost contact with the extension.', expect.anything());
  });

  it('replaces an older entry for the same task id', () => {
    const h = harness([]);
    startTask({ id: 'same', title: 'A', statusUrl: '/s' }, { id: 'x', name: 'X' }, h.deps);
    startTask({ id: 'same', title: 'B', statusUrl: '/s' }, { id: 'x', name: 'X' }, h.deps);
    expect(useTasks.getState().tasks.map((t) => t.title)).toEqual(['B']);
  });

  it('an account switch stops the polls of the other account', async () => {
    const h = harness([{ state: 'running', progress: 0.1 }, { state: 'running', progress: 0.2 }]);
    startTask({ id: 'a1', title: 'A', statusUrl: '/a' }, { id: 'x', name: 'X', account: 'srv.userA' }, h.deps);
    startTask({ id: 'b1', title: 'B', statusUrl: '/b' }, { id: 'x', name: 'X', account: 'srv.userB' }, h.deps);
    stopTasksExcept('srv.userB');
    expect(useTasks.getState().tasks.map((t) => t.title)).toEqual(['B']);
    await h.step();
    await h.step();
    // Only B's poll asked the extension.
    expect(h.deps.fetchStatus).toHaveBeenCalledTimes(1);
    expect(h.deps.fetchStatus).toHaveBeenCalledWith('/b');
  });
});
