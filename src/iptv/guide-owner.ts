/**
 * The owner of the M3U guide window of each provider. Two callers download
 * a guide: `loadGuide` (manager.ts) and the programme index build
 * (programme-manager.ts). Without one owner, each wrote `guideStatus` and
 * guessed what the other did, so a status could stay "loading" for ever and
 * an old download could write over a new guide.
 *
 * Rules:
 * - One claim per provider is current (a keyed token, `createKeyedGate`).
 *   Only the current claim writes the guide and its status.
 * - A request for the address that the current claim downloads joins it:
 *   no second download.
 * - A request for another address (the playlist names a new guide) waits
 *   for the current claim to end, then runs again with the new address.
 * - `claim` (the index build) always takes over: it downloads anyway.
 * - `reset` (a provider saved, removed or loaded again by sync) makes the
 *   claim stale at once; its late result is dropped.
 *
 * Pure, so it is unit-tested. No React, no I/O, no timers.
 */
import { createKeyedGate } from '@/lib/async-gate';

export interface GuideClaim {
  /** True while no newer claim and no reset came after this one. */
  current(): boolean;
  /** Ends the claim. Callers that joined or waited go on. Safe to call twice. */
  end(): void;
}

export type GuideRequest =
  | { kind: 'start'; claim: GuideClaim }
  | { kind: 'join'; done: Promise<void> }
  | { kind: 'wait'; done: Promise<void> };

export interface GuideOwner {
  /** What a guide load for `url` does now (see the rules above). */
  request(id: string, url: string): GuideRequest;
  /** A new current claim for `url`. A running claim becomes stale. */
  claim(id: string, url: string): GuideClaim;
  reset(id: string): void;
  resetAll(): void;
}

interface Job {
  token: number;
  url: string;
  done: Promise<void>;
}

export function createGuideOwner(): GuideOwner {
  const gate = createKeyedGate<string>();
  const jobs = new Map<string, Job>();

  const claim = (id: string, url: string): GuideClaim => {
    const token = gate.begin(id);
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const job: Job = { token, url, done };
    jobs.set(id, job);
    return {
      current: () => gate.current(id, token),
      end() {
        if (jobs.get(id) === job) jobs.delete(id);
        finish();
      },
    };
  };

  return {
    request(id, url) {
      const job = jobs.get(id);
      if (!job) return { kind: 'start', claim: claim(id, url) };
      return job.url === url ? { kind: 'join', done: job.done } : { kind: 'wait', done: job.done };
    },
    claim,
    reset(id) {
      gate.cancel(id);
      jobs.delete(id);
    },
    resetAll() {
      gate.cancelAll();
      jobs.clear();
    },
  };
}
