/**
 * Which host of a root sheet shows it.
 *
 * A sheet that any screen can open (Add to playlist) has one host at the app
 * root. On iOS a `Modal` is presented by the view controller of the view that
 * holds it, and a controller presents one thing at a time. While a modal
 * screen is open (Now Playing, the video player), the root controller already
 * presents that screen: a sheet from the root host does not show, and its
 * hidden view takes every touch. The app looked frozen.
 *
 * So a modal screen mounts its own host, and only the host mounted last (the
 * one on top) renders the sheet. When that screen closes, the root host is
 * the top one again.
 *
 * `createHostStack` is pure, so it is unit-tested. `useTopHost` is the hook.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

export interface HostStack {
  /** A new host id. */
  newId(): number;
  /** Adds host `id` on top. */
  mount(name: string, id: number): void;
  unmount(name: string, id: number): void;
  /** True when `id` is the host mounted last under `name`. */
  isTop(name: string, id: number): boolean;
  subscribe(listener: () => void): () => void;
}

export function createHostStack(): HostStack {
  let counter = 0;
  const stacks = new Map<string, number[]>();
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((l) => l());
  return {
    newId() {
      counter += 1;
      return counter;
    },
    mount(name, id) {
      stacks.set(name, [...(stacks.get(name) ?? []).filter((x) => x !== id), id]);
      changed();
    },
    unmount(name, id) {
      const list = stacks.get(name);
      if (!list?.includes(id)) return;
      stacks.set(
        name,
        list.filter((x) => x !== id),
      );
      changed();
    },
    isTop(name, id) {
      const list = stacks.get(name);
      return !!list?.length && list[list.length - 1] === id;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const hosts = createHostStack();

/** True for the host of `name` that was mounted last. False until the host is mounted. */
export function useTopHost(name: string): boolean {
  const [id] = useState(hosts.newId);
  useEffect(() => {
    hosts.mount(name, id);
    return () => hosts.unmount(name, id);
  }, [name, id]);
  return useSyncExternalStore(
    hosts.subscribe,
    () => hosts.isTop(name, id),
    () => false,
  );
}
