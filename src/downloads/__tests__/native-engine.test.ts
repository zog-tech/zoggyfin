import type { EngineHandlers } from '../engine-types';
import { createNativeEngine, type EngineFs, type NativeDownloader, type NativeTask, restPath } from '../native-engine';

type Begin = Parameters<NativeTask['begin']>[0];
type Progress = Parameters<NativeTask['progress']>[0];
type Done = Parameters<NativeTask['done']>[0];
type Fail = Parameters<NativeTask['error']>[0];

interface FakeTask extends NativeTask {
  options: { url: string; destination: string; headers?: Record<string, string>; metadata?: object };
  started: boolean;
  stopped: boolean;
  resumed: boolean;
  fire: { begin?: Begin; progress?: Progress; done?: Done; error?: Fail };
}

function fakeTask(o: FakeTask['options'], state = 'PENDING', bytes = 0): FakeTask {
  const t: FakeTask = {
    id: (o as { id?: string }).id ?? 'a',
    state,
    bytesDownloaded: bytes,
    bytesTotal: 0,
    metadata: o.metadata as Record<string, unknown>,
    options: o,
    started: false,
    stopped: false,
    resumed: false,
    fire: {},
    begin: (h) => ((t.fire.begin = h), t),
    progress: (h) => ((t.fire.progress = h), t),
    done: (h) => ((t.fire.done = h), t),
    error: (h) => ((t.fire.error = h), t),
    start: () => void (t.started = true),
    pause: async () => undefined,
    resume: async () => void (t.resumed = true),
    stop: async () => void (t.stopped = true),
  };
  return t;
}

/** Files as byte strings, so a join can be checked. */
function fakeFs(files: Record<string, string>): EngineFs {
  return {
    size: (p) => files[p]?.length ?? 0,
    remove: (p) => void delete files[p],
    replace: async (from, to) => {
      files[to] = files[from];
      delete files[from];
    },
    writeAt: async (from, to, offset) => {
      const base = (files[to] ?? '').slice(0, offset);
      files[to] = base + files[from];
    },
  };
}

function setup(files: Record<string, string>, existing: FakeTask[] = []) {
  const created: FakeTask[] = [];
  const lib: NativeDownloader = {
    supported: true,
    createDownloadTask: (o) => {
      const t = fakeTask(o);
      created.push(t);
      return t;
    },
    getExistingDownloadTasks: async () => existing,
    setConfig: () => undefined,
    completeHandler: () => undefined,
  };
  const engine = createNativeEngine(lib, fakeFs(files));
  const h: jest.Mocked<EngineHandlers> = { onBegin: jest.fn(), onProgress: jest.fn(), onDone: jest.fn(), onError: jest.fn() };
  engine.configure(h, { maxParallel: 2 });
  return { engine, created, h };
}

const DEST = '/docs/downloads/a/media.mkv';
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('native engine: resume of a lost task', () => {
  it('asks for the rest of the partial file and joins it at the end', async () => {
    const files: Record<string, string> = { [DEST]: 'abcd' };
    const { engine, created, h } = setup(files);
    engine.start({ id: 'a', url: 'https://s/x', destination: DEST, headers: { Authorization: 'k' }, resume: { expectedBytes: 10, validator: '"v1"' } });
    const t = created[0];
    expect(t.options.destination).toBe(restPath(DEST));
    expect(t.options.headers).toEqual({ Authorization: 'k', Range: 'bytes=4-', 'If-Range': '"v1"' });
    expect(t.started).toBe(true);
    t.fire.begin?.({ expectedBytes: 6, headers: { 'Content-Range': 'bytes 4-9/10', ETag: '"v1"' } });
    expect(h.onBegin).toHaveBeenCalledWith('a', 10, '"v1"');
    t.fire.progress?.({ bytesDownloaded: 3, bytesTotal: 6 });
    expect(h.onProgress).toHaveBeenCalledWith('a', 7, 10);
    files[restPath(DEST)] = 'efghij';
    t.fire.done?.({ bytesDownloaded: 6 });
    await flush();
    expect(files[DEST]).toBe('abcdefghij');
    expect(files[restPath(DEST)]).toBeUndefined();
    expect(h.onDone).toHaveBeenCalledWith('a', 10);
  });

  it('keeps the whole file when the server answers 200', async () => {
    const files: Record<string, string> = { [DEST]: 'abcd' };
    const { engine, created, h } = setup(files);
    engine.start({ id: 'a', url: 'u', destination: DEST, resume: { expectedBytes: 10, validator: null } });
    const t = created[0];
    t.fire.begin?.({ expectedBytes: 10, headers: {} });
    t.fire.progress?.({ bytesDownloaded: 5, bytesTotal: 10 });
    expect(h.onProgress).toHaveBeenCalledWith('a', 5, 10);
    files[restPath(DEST)] = 'ABCDEFGHIJ';
    t.fire.done?.({ bytesDownloaded: 10 });
    await flush();
    expect(files[DEST]).toBe('ABCDEFGHIJ');
    expect(h.onDone).toHaveBeenCalledWith('a', 10);
  });

  it('starts over from 0 when the range does not fit', async () => {
    const files: Record<string, string> = { [DEST]: 'abcd' };
    const { engine, created, h } = setup(files);
    engine.start({ id: 'a', url: 'u', destination: DEST, headers: { Authorization: 'k' }, resume: { expectedBytes: 10, validator: null } });
    created[0].fire.begin?.({ expectedBytes: 16, headers: { 'Content-Range': 'bytes 4-19/20' } });
    await flush();
    expect(created[0].stopped).toBe(true);
    expect(files[DEST]).toBeUndefined();
    const again = created[1];
    expect(again.options).toEqual({ id: 'a', url: 'u', destination: DEST, headers: { Authorization: 'k' }, metadata: {} });
    expect(again.started).toBe(true);
    // Events of the stopped task do not count.
    created[0].fire.error?.({ error: 'cancelled', errorCode: -999 });
    expect(h.onError).not.toHaveBeenCalled();
  });

  it('starts over from 0 when the sizes do not add up', async () => {
    const files: Record<string, string> = { [DEST]: 'abcd' };
    const { engine, created, h } = setup(files);
    engine.start({ id: 'a', url: 'u', destination: DEST, resume: { expectedBytes: 10, validator: null } });
    created[0].fire.begin?.({ expectedBytes: 6, headers: { 'Content-Range': 'bytes 4-9/10' } });
    files[restPath(DEST)] = 'efghijklmn';
    created[0].fire.done?.({ bytesDownloaded: 10 });
    await flush();
    expect(h.onDone).not.toHaveBeenCalled();
    expect(created[1].options.destination).toBe(DEST);
    expect(created[1].options.headers).toEqual({});
  });

  it('downloads from 0 when there is no partial file', () => {
    const { engine, created } = setup({});
    engine.start({ id: 'a', url: 'u', destination: DEST, resume: { expectedBytes: 10, validator: null } });
    expect(created[0].options.destination).toBe(DEST);
    expect(created[0].options.headers).toEqual({});
  });

  it('finishes at once when the partial file is the whole file', async () => {
    const { engine, created, h } = setup({ [DEST]: 'abcdefghij' });
    engine.start({ id: 'a', url: 'u', destination: DEST, resume: { expectedBytes: 10, validator: null } });
    await flush();
    expect(created).toHaveLength(0);
    expect(h.onDone).toHaveBeenCalledWith('a', 10);
  });

  it('pauses a continued task by a stop, and a resume asks for the rest again', async () => {
    const files: Record<string, string> = { [DEST]: 'abcd' };
    const { engine, created } = setup(files);
    engine.start({ id: 'a', url: 'u', destination: DEST, resume: { expectedBytes: 10, validator: null } });
    files[restPath(DEST)] = 'ef';
    await engine.pause('a');
    expect(created[0].stopped).toBe(true);
    expect(files[restPath(DEST)]).toBeUndefined();
    expect(files[DEST]).toBe('abcd');
    await expect(engine.resume('a')).resolves.toBe(true);
    expect(created[1].options.headers).toEqual({ Range: 'bytes=4-' });
  });

  it('says when it has no task to resume', async () => {
    const { engine } = setup({});
    await expect(engine.resume('gone')).resolves.toBe(false);
  });

  it('joins a continued task that finished while the app was closed', async () => {
    const files: Record<string, string> = { [DEST]: 'abcd', [restPath(DEST)]: 'efghij' };
    const done = fakeTask({ url: 'u', destination: restPath(DEST), metadata: { zfJoin: { destination: DEST, offset: 4, total: 10 } } }, 'DONE', 6);
    const { engine } = setup(files, [done]);
    const tasks = await engine.existing();
    expect(tasks).toEqual([{ id: 'a', state: 'done', bytesDone: 10, bytesTotal: 10 }]);
    expect(files[DEST]).toBe('abcdefghij');
  });

  it('drops a paused continued task after a restart, so the manager starts it from the partial file', async () => {
    const files: Record<string, string> = { [DEST]: 'abcd', [restPath(DEST)]: 'ef' };
    const paused = fakeTask({ url: 'u', destination: restPath(DEST), metadata: { zfJoin: { destination: DEST, offset: 4, total: 10 } } }, 'PAUSED', 2);
    const { engine } = setup(files, [paused]);
    expect(await engine.existing()).toEqual([]);
    expect(paused.stopped).toBe(true);
    expect(files[DEST]).toBe('abcd');
  });
});

describe('native engine: iOS resume data after an error', () => {
  // iOS writes to a system file until the end, so there is no partial file to continue
  // with a Range request. The patched downloader keeps the resume data of an error
  // (`resumable`), and the engine continues the task with it.
  const hint = { expectedBytes: 9_000, validator: null };

  it('reports the error, then a retry continues the task instead of starting again', async () => {
    const { engine, created, h } = setup({});
    engine.start({ id: 'a', url: 'https://s/x', destination: DEST, headers: { Authorization: 'k' }, resume: hint });
    created[0].fire.error?.({ error: 'The request timed out.', errorCode: -1001, resumable: true });
    expect(h.onError).toHaveBeenCalledWith('a', 'The request timed out.', -1001);

    engine.start({ id: 'a', url: 'https://s/x', destination: DEST, headers: { Authorization: 'k' }, resume: hint });
    const again = created[1];
    expect(again.resumed).toBe(true);
    expect(again.started).toBe(false);
    again.fire.progress?.({ bytesDownloaded: 5_000, bytesTotal: 9_000 });
    expect(h.onProgress).toHaveBeenLastCalledWith('a', 5_000, 9_000);
    again.fire.done?.({ bytesDownloaded: 9_000 });
    expect(h.onDone).toHaveBeenCalledWith('a', 9_000);
  });

  it('continues only once per error: a second error with no resume data starts from 0', () => {
    const { engine, created } = setup({});
    engine.start({ id: 'a', url: 'https://s/x', destination: DEST, resume: hint });
    created[0].fire.error?.({ error: 'lost', errorCode: -1005, resumable: true });
    engine.start({ id: 'a', url: 'https://s/x', destination: DEST, resume: hint });
    created[1].fire.error?.({ error: 'bad', errorCode: -1011 });
    engine.start({ id: 'a', url: 'https://s/x', destination: DEST, resume: hint });
    expect(created[2].started).toBe(true);
    expect(created[2].resumed).toBe(false);
  });

  it('drops the resume data when the start cannot continue (a transcode or no bytes)', () => {
    const { engine, created } = setup({});
    engine.start({ id: 'a', url: 'https://s/x', destination: DEST, resume: hint });
    created[0].fire.error?.({ error: 'lost', errorCode: -1005, resumable: true });
    engine.start({ id: 'a', url: 'https://s/y', destination: DEST });
    expect(created[1].stopped).toBe(true);
    expect(created[2].started).toBe(true);
  });

  it('drops the resume data on cancel', async () => {
    const { engine, created } = setup({});
    engine.start({ id: 'a', url: 'https://s/x', destination: DEST, resume: hint });
    created[0].fire.error?.({ error: 'lost', errorCode: -1005, resumable: true });
    await engine.stop('a');
    expect(created[1].stopped).toBe(true);
    // The library's JS needs a URL and a destination for the task object.
    expect(created[1].options).toMatchObject({ url: 'https://s/x', destination: DEST });
  });

  it('continues a task from before an app restart after an error with resume data', async () => {
    // A download that ran through an app start (OTA, update, the system ended the app):
    // the engine binds the library's task, and no start() of this launch knows its request.
    const old = fakeTask({ id: 'a', url: '', destination: '' } as FakeTask['options'], 'DOWNLOADING', 4_000);
    const { engine, created, h } = setup({}, [old]);
    await engine.existing();
    old.fire.error?.({ error: 'The network connection was lost.', errorCode: -1005, resumable: true });
    expect(h.onError).toHaveBeenCalledWith('a', 'The network connection was lost.', -1005);

    engine.start({ id: 'a', url: 'https://s/x', destination: DEST, resume: hint });
    const again = created[0];
    expect(again.resumed).toBe(true);
    expect(again.started).toBe(false);
  });

  it('keeps an error without resume data as it was', () => {
    const { engine, created, h } = setup({});
    engine.start({ id: 'a', url: 'https://s/x', destination: DEST, resume: hint });
    created[0].fire.error?.({ error: 'Not found', errorCode: 404 });
    expect(h.onError).toHaveBeenCalledWith('a', 'Not found', 404);
    engine.start({ id: 'a', url: 'https://s/x', destination: DEST, resume: hint });
    expect(created[1].started).toBe(true);
  });
});

describe('native engine: library config', () => {
  function configured(parallelSettingCancelsTasks: boolean) {
    const setConfig = jest.fn();
    const lib: NativeDownloader = {
      supported: true,
      parallelSettingCancelsTasks,
      createDownloadTask: (o) => fakeTask(o),
      getExistingDownloadTasks: async () => [],
      setConfig,
      completeHandler: () => undefined,
    };
    createNativeEngine(lib, fakeFs({})).configure({ onBegin: jest.fn(), onProgress: jest.fn(), onDone: jest.fn(), onError: jest.fn() }, { maxParallel: 2 });
    return setConfig.mock.calls[0]?.[0] as Record<string, unknown>;
  }

  it('does not set the parallel limit where that cancels the running tasks (iOS)', () => {
    // On iOS the library rebuilt its background session for it at every app start, with
    // invalidateAndCancel: each running download stopped and started again from byte 0.
    expect(configured(true)).not.toHaveProperty('maxParallelDownloads');
  });

  it('sets it elsewhere (Android)', () => {
    expect(configured(false)).toMatchObject({ maxParallelDownloads: 2 });
  });
});

describe('native engine: iOS asks the library before a resume start', () => {
  // The library can hold a download that the engine does not know: resume data that
  // came after the restart's list (a force quit, an app update), an error before the
  // app listened, or a task that still runs. A resume start asks it first.
  const hint = { expectedBytes: 9_000, validator: null };
  const req = { id: 'a', url: 'https://s/x', destination: DEST, resume: hint };

  function ios(list: () => Promise<FakeTask[]> | FakeTask[] = () => []) {
    const created: FakeTask[] = [];
    const log: string[] = [];
    const lib: NativeDownloader = {
      supported: true,
      parallelSettingCancelsTasks: true,
      keepsResumeData: true,
      createDownloadTask: (o) => {
        const t = fakeTask(o);
        const { start, stop } = t;
        t.start = () => (log.push(`start ${o.url}`), start());
        t.stop = () => (log.push(`stop ${o.id ?? t.id}`), stop());
        created.push(t);
        return t;
      },
      getExistingDownloadTasks: async () => list(),
      setConfig: () => undefined,
      completeHandler: () => undefined,
    };
    const engine = createNativeEngine(lib, fakeFs({}));
    const h: jest.Mocked<EngineHandlers> = { onBegin: jest.fn(), onProgress: jest.fn(), onDone: jest.fn(), onError: jest.fn() };
    engine.configure(h, { maxParallel: 2 });
    return { engine, created, log, h };
  }
  const listed = (state: string, bytes = 4_000, metadata?: object) =>
    fakeTask({ id: 'a', url: '', destination: '', metadata } as FakeTask['options'], state, bytes);

  it('continues resume data that came after the restart list', async () => {
    const held = listed('PAUSED');
    const { engine, created } = ios(() => [held]);
    engine.start(req);
    await flush();
    expect(held.resumed).toBe(true);
    expect(created.some((t) => t.started)).toBe(false);
  });

  it('continues a task from before an app restart after an error with resume data', async () => {
    const old = listed('DOWNLOADING');
    let list = [old];
    const { engine, created, h } = ios(() => list);
    await engine.existing();
    old.fire.error?.({ error: 'The network connection was lost.', errorCode: -1005, resumable: true });
    expect(h.onError).toHaveBeenCalledWith('a', 'The network connection was lost.', -1005);
    const held = listed('PAUSED');
    list = [held];
    engine.start(req);
    await flush();
    expect(held.resumed).toBe(true);
    expect(created.some((t) => t.started)).toBe(false);
    held.fire.progress?.({ bytesDownloaded: 6_000, bytesTotal: 9_000 });
    expect(h.onProgress).toHaveBeenLastCalledWith('a', 6_000, 9_000);
  });

  it('continues again after each later error', async () => {
    let held = listed('PAUSED');
    const { engine, created } = ios(() => [held]);
    for (let i = 0; i < 3; i++) {
      engine.start(req);
      await flush();
      expect(held.resumed).toBe(true);
      held.fire.error?.({ error: 'lost', errorCode: -1005, resumable: true });
      held = listed('PAUSED', 5_000 + i);
    }
    expect(created.some((t) => t.started)).toBe(false);
  });

  it('binds a task that still runs instead of starting a second one', async () => {
    const running = listed('DOWNLOADING');
    const { engine, created, h } = ios(() => [running]);
    engine.start(req);
    await flush();
    expect(created.some((t) => t.started)).toBe(false);
    expect(running.resumed).toBe(false);
    running.fire.progress?.({ bytesDownloaded: 7_000, bytesTotal: 9_000 });
    expect(h.onProgress).toHaveBeenLastCalledWith('a', 7_000, 9_000);
    running.fire.done?.({ bytesDownloaded: 9_000 });
    expect(h.onDone).toHaveBeenCalledWith('a', 9_000);
  });

  it('starts from 0 only when the library holds nothing', async () => {
    const { engine, created } = ios(() => []);
    engine.start(req);
    await flush();
    expect(created.filter((t) => t.started).map((t) => t.options.url)).toEqual(['https://s/x']);
  });

  it('starts from 0 when the library cannot list its tasks', async () => {
    const { engine, created } = ios(() => Promise.reject(new Error('ERR_SESSION_NIL')));
    engine.start(req);
    await flush();
    expect(created.filter((t) => t.started)).toHaveLength(1);
  });

  it('starts from 0 when the library refuses the resume', async () => {
    const held = listed('PAUSED');
    held.resume = async () => {
      throw new Error('ERR_RESUME_TASK');
    };
    const { engine, created } = ios(() => [held]);
    engine.start(req);
    await flush();
    await flush();
    expect(created.filter((t) => t.started)).toHaveLength(1);
  });

  it('starts nothing when paused while the library answers, and continues on resume', async () => {
    let answer: (l: FakeTask[]) => void = () => undefined;
    let held = listed('PAUSED');
    let calls = 0;
    const { engine, created } = ios(() => {
      calls++;
      return calls === 1 ? new Promise<FakeTask[]>((r) => (answer = r)) : [held];
    });
    engine.start(req);
    await engine.pause('a');
    answer([held]);
    await flush();
    expect(held.resumed).toBe(false);
    expect(created.some((t) => t.started)).toBe(false);
    held = listed('PAUSED');
    expect(await engine.resume('a')).toBe(true);
    await flush();
    expect(held.resumed).toBe(true);
  });

  it('starts nothing when cancelled while the library answers, and clears the id there', async () => {
    let answer: (l: FakeTask[]) => void = () => undefined;
    const held = listed('PAUSED');
    const { engine, created, log } = ios(() => new Promise<FakeTask[]>((r) => (answer = r)));
    engine.start(req);
    await engine.stop('a');
    answer([held]);
    await flush();
    expect(held.resumed).toBe(false);
    expect(created.some((t) => t.started)).toBe(false);
    expect(log).toContain('stop a');
  });

  it('a second start while the library answers wins; the first answer does nothing', async () => {
    let calls = 0;
    const answers: ((l: FakeTask[]) => void)[] = [];
    const { engine, created } = ios(() => {
      calls++;
      return new Promise<FakeTask[]>((r) => answers.push(r));
    });
    engine.start(req);
    engine.start(req);
    answers[1]([]);
    await flush();
    answers[0]([]);
    await flush();
    expect(calls).toBe(2);
    expect(created.filter((t) => t.started)).toHaveLength(1);
  });

  it('stops a continued (Range) task instead of resuming it in the library', async () => {
    const joined = listed('PAUSED', 100, { zfJoin: { destination: DEST, offset: 4_000, total: 9_000 } });
    const { engine, created } = ios(() => [joined]);
    engine.start(req);
    await flush();
    expect(joined.resumed).toBe(false);
    expect(joined.stopped).toBe(true);
    expect(created.filter((t) => t.started)).toHaveLength(1);
  });

  it('a start without a hint clears the id in the library before the new task', () => {
    const { engine, log } = ios();
    engine.start({ id: 'a', url: 'https://s/t.mp4', destination: DEST });
    expect(log).toEqual(['stop a', 'start https://s/t.mp4']);
  });

  it('ignores events of the old task after the library task is bound again', async () => {
    const old = listed('DOWNLOADING');
    let list = [old];
    const { engine, h } = ios(() => list);
    await engine.existing();
    old.fire.error?.({ error: 'lost', errorCode: -1005, resumable: true });
    const held = listed('PAUSED');
    list = [held];
    engine.start(req);
    await flush();
    old.fire.progress?.({ bytesDownloaded: 1, bytesTotal: 9_000 });
    old.fire.error?.({ error: 'late', errorCode: -999 });
    expect(h.onProgress).not.toHaveBeenCalledWith('a', 1, 9_000);
    expect(h.onError).toHaveBeenCalledTimes(1);
  });

  describe('nudge of a stalled task', () => {
    async function running(list: () => FakeTask[]) {
      const env = ios(list);
      env.engine.start({ id: 'a', url: 'https://s/x', destination: DEST });
      const t = env.created.find((x) => x.started)!;
      let paused = false;
      t.pause = async () => void (paused = true);
      return { ...env, t, wasPaused: () => paused };
    }

    it('pauses the task and continues it at once from its resume data', async () => {
      const held = listed('PAUSED', 821_000);
      const { engine, t, wasPaused, h } = await running(() => [held]);
      expect(await engine.nudge!('a', () => true)).toBe(true);
      expect(wasPaused()).toBe(true);
      expect(held.resumed).toBe(true);
      // Events of the paused task object no longer count; the continued one reports.
      t.fire.progress?.({ bytesDownloaded: 1, bytesTotal: 9 });
      held.fire.progress?.({ bytesDownloaded: 900_000, bytesTotal: 2_000_000 });
      expect(h.onProgress).toHaveBeenCalledTimes(1);
      expect(h.onProgress).toHaveBeenLastCalledWith('a', 900_000, 2_000_000);
    });

    it('says so when the system kept nothing, so the manager starts it again', async () => {
      const { engine } = await running(() => []);
      expect(await engine.nudge!('a', () => true)).toBe(false);
      expect(await engine.resume('a')).toBe(false);
    });

    it('keeps a download paused that the user paused meanwhile', async () => {
      const held = listed('PAUSED', 821_000);
      const { engine } = await running(() => [held]);
      expect(await engine.nudge!('a', () => false)).toBe(true);
      expect(held.resumed).toBe(false);
      // The user's resume continues it.
      expect(await engine.resume('a')).toBe(true);
    });

    it('binds a task the library still runs', async () => {
      const live = listed('DOWNLOADING', 821_000);
      const { engine } = await running(() => [live]);
      expect(await engine.nudge!('a', () => true)).toBe(true);
      expect(live.resumed).toBe(false);
    });

    it('does nothing for an id with no task', async () => {
      const { engine } = ios();
      expect(await engine.nudge!('zzz', () => true)).toBe(true);
    });

    it('is only offered where the library keeps resume data (iOS)', () => {
      const { engine } = setup({});
      expect(engine.nudge).toBeUndefined();
    });
  });
});
