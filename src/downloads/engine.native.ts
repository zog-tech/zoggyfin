/**
 * The download engine on iOS and Android: @kesha-antonov/react-native-background-downloader
 * (a background NSURLSession on iOS). Downloads go on while the app is in
 * the background, and the system keeps them when it ends the app. The engine
 * logic is in `native-engine.ts`; this file passes the library and the files.
 */
import {
  completeHandler,
  createDownloadTask,
  getExistingDownloadTasks,
  setConfig,
} from '@kesha-antonov/react-native-background-downloader';
import { File, FileMode } from 'expo-file-system';
import { Platform } from 'react-native';

import { createNativeEngine, type EngineFs, type NativeDownloader, type NativeTask } from './native-engine';

function fileAt(path: string): File {
  return new File(`file://${encodeURI(path)}`);
}

/** Bytes per read when the engine joins two files. */
const CHUNK = 4 * 1024 * 1024;

const fs: EngineFs = {
  size(path) {
    try {
      const f = fileAt(path);
      return f.exists ? (f.size ?? 0) : 0;
    } catch {
      return 0;
    }
  },
  remove(path) {
    try {
      const f = fileAt(path);
      if (f.exists) f.delete();
    } catch {
      // Already gone.
    }
  },
  async replace(from, to) {
    const target = fileAt(to);
    if (target.exists) target.delete();
    await fileAt(from).move(target);
  },
  async writeAt(from, to, offset) {
    const src = fileAt(from).open(FileMode.ReadOnly);
    const dst = fileAt(to).open(FileMode.ReadWrite);
    try {
      dst.offset = offset;
      for (;;) {
        const bytes = await src.readBytes(CHUNK);
        if (!bytes.length) break;
        await dst.writeBytes(bytes);
      }
    } finally {
      src.close();
      dst.close();
    }
  },
};

const lib: NativeDownloader = {
  supported: !Platform.isTV,
  parallelSettingCancelsTasks: Platform.OS === 'ios',
  createDownloadTask: (o) => createDownloadTask(o) as unknown as NativeTask,
  getExistingDownloadTasks: async () => (await getExistingDownloadTasks()) as unknown as NativeTask[],
  setConfig: (c) => setConfig(c),
  completeHandler: (id) => completeHandler(id),
};

export const engine = createNativeEngine(lib, fs);
