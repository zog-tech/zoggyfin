/**
 * Discovery on the server address screen. It runs only while the screen has
 * the focus, and stops at once when the user leaves it. It never runs in the
 * background.
 *
 * iOS and the Mac app ask the user for local network access. The screen first
 * shows a short card that tells why; its Continue button shows the system
 * prompt on purpose, so that the prompt does not come later, in the middle of
 * a sign-in. The card shows only once.
 *
 * The phase lives in a ref and in state, written together by `go()`, so the
 * focus handler and Refresh read the same value. Each run has its own abort
 * controller: a stopped run never writes, and a failed run ends in 'done'.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { useSessionStore } from '@/auth/session-store';
import { discoveryBackend } from '@/servers/discovery/backend';
import { runDiscovery } from '@/servers/discovery/discover';
import { lanHelpFor, type LanAccess, type LanHelp } from '@/servers/discovery/lan-access';
import type { DiscoveredServer } from '@/servers/discovery/types';
import { storage } from '@/storage/kv';

/** 'asked': the user saw the card and the system prompt; 'skipped': the user chose "Not now". */
const PRIMER_KEY = 'discovery.lanPrimer';
/** How long the app waits for the user to answer the system prompt. */
const PROMPT_WAIT_MS = 60_000;
/** A later check of access is quick when access is on. */
const CHECK_WAIT_MS = 3000;
/** The check after a failed request: short, the user waits for the message. */
const LAN_CHECK_AFTER_FAILURE_MS = 1500;

export type DiscoveryPhase =
  /** The web: no discovery. */
  | 'off'
  /** The card that explains local network access (first time only). */
  | 'primer'
  /** The system prompt is open. */
  | 'prompt'
  /** The user chose "Not now": discovery starts only on a tap. */
  | 'paused'
  | 'searching'
  | 'done';

export interface ServerDiscovery {
  phase: DiscoveryPhase;
  servers: DiscoveredServer[];
  lan: LanAccess;
  /** Shows the system prompt (iOS, Mac), then searches. */
  allow(): void;
  /** Hides the card; the user types an internet address. */
  skip(): void;
  refresh(): void;
  openSettings(): void;
}

function initialPhase(): DiscoveryPhase {
  if (!discoveryBackend.available) return 'off';
  if (!discoveryBackend.asksLanAccess) return 'searching';
  const v = storage.getString(PRIMER_KEY);
  return v === 'asked' ? 'searching' : v === 'skipped' ? 'paused' : 'primer';
}

export function useServerDiscovery(): ServerDiscovery {
  const [phase, setPhase] = useState<DiscoveryPhase>(initialPhase);
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  const [lan, setLan] = useState<LanAccess>('unknown');
  const run = useRef<AbortController | null>(null);
  const focused = useRef(false);
  /** The phase now; handlers read it, not the phase of the last render. */
  const phaseRef = useRef(phase);
  const go = useCallback((next: DiscoveryPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const stop = useCallback(() => {
    run.current?.abort();
    run.current = null;
  }, []);

  const start = useCallback(() => {
    stop();
    if (!discoveryBackend.available || !focused.current) return;
    const ctl = new AbortController();
    run.current = ctl;
    go('searching');
    setServers([]);
    const discovery = runDiscovery(discoveryBackend, {
      signal: ctl.signal,
      onServers: (found) => {
        if (!ctl.signal.aborted) setServers(found);
      },
    });
    // iOS: a quick check finds out if the user turned access off in Settings.
    const check = discoveryBackend.asksLanAccess ? discoveryBackend.lanAccess(CHECK_WAIT_MS).catch((): LanAccess => 'unknown') : Promise.resolve<LanAccess>('unknown');
    Promise.all([discovery, check])
      .then(([r, checked]) => {
        if (ctl.signal.aborted) return;
        run.current = null;
        // A saved server found at a new address keeps that address (the server Id is the same).
        useSessionStore.getState().learnAddresses(r.servers.map((x) => ({ serverId: x.id, url: x.address })));
        setLan(r.lan === 'granted' || checked === 'granted' ? 'granted' : checked === 'denied' || r.lan === 'denied' ? 'denied' : 'unknown');
        go('done');
      })
      .catch(() => {
        // A failed search shows what it found so far, with Refresh.
        if (ctl.signal.aborted) return;
        run.current = null;
        go('done');
      });
  }, [stop, go]);

  const allow = useCallback(() => {
    stop();
    storage.set(PRIMER_KEY, 'asked');
    go('prompt');
    const ctl = new AbortController();
    run.current = ctl;
    void discoveryBackend
      .lanAccess(PROMPT_WAIT_MS)
      .catch((): LanAccess => 'unknown')
      .then((access) => {
        if (ctl.signal.aborted) return;
        run.current = null;
        setLan(access);
        if (access === 'denied') go('done');
        else start();
      });
  }, [start, stop, go]);

  const skip = useCallback(() => {
    storage.set(PRIMER_KEY, 'skipped');
    go('paused');
  }, [go]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      // Start (or start again) when the screen gets the focus; no prompt without a tap.
      const p = phaseRef.current;
      if (p === 'searching' || p === 'done') start();
      return () => {
        focused.current = false;
        stop();
        // A run that stopped half way is not a result.
        const x = phaseRef.current;
        if (x === 'searching' || x === 'prompt') go('done');
      };
    }, [start, stop, go]),
  );

  return {
    phase,
    servers,
    lan,
    allow,
    skip,
    refresh: () => (phaseRef.current === 'paused' || phaseRef.current === 'primer' ? allow() : start()),
    openSettings: () => void discoveryBackend.openSettings().catch(() => undefined),
  };
}

/** True when the platform asks for local network access (iOS, the Mac app). */
export const asksLanAccess = discoveryBackend.asksLanAccess;
export const openLanSettings = (): void => void discoveryBackend.openSettings().catch(() => undefined);

/** The help for a failed request to `url` (local network access, VPN or Tailscale), or null. */
export async function lanHelpAfterFailure(url: string, e: unknown): Promise<LanHelp | null> {
  if (!lanHelpFor(url, e, true, true)) return null;
  const vpn = await discoveryBackend.vpnActive().catch(() => false);
  const help = lanHelpFor(url, e, discoveryBackend.asksLanAccess, vpn);
  if (help !== 'lan-access' && help !== 'lan-access-vpn') return help;
  // Access is on (a quick check): the server is off or the address is wrong.
  const access = await discoveryBackend.lanAccess(LAN_CHECK_AFTER_FAILURE_MS).catch(() => 'unknown' as const);
  if (access !== 'granted') return help;
  return help === 'lan-access-vpn' ? 'vpn' : null;
}
