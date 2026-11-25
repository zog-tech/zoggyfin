/**
 * Web TV preview: the arrow keys move the focus to the nearest control in
 * that direction, like the D-pad on a TV. Keys a screen has already handled
 * (the players, text fields) are left alone.
 */
import { playerState } from '@/player/store';

type Dir = 'left' | 'right' | 'up' | 'down';

const DIRS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

const FOCUSABLE = '[tabindex]:not([tabindex="-1"]), button, a[href], input, textarea';

function shown(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/**
 * A target that is not in line with the current control (no overlap on the
 * cross axis) scores this much more, so one that is in line always wins.
 */
const OFF_LINE = 100_000;

/**
 * The distance from `from` to a control in direction `dir`, or null when it
 * is not that way. A control that overlaps `from` on the cross axis (in the
 * same column for Up and Down, the same row for Left and Right) comes before
 * any that does not: with centres alone, Up from the first cast tile of the
 * full-bleed series page went to a rail entry up and left instead of the
 * episode tile right above it. Among controls that are both in line, or
 * both not, the nearer centre wins, as before.
 */
export function spatialScore(from: DOMRect, to: DOMRect, dir: Dir): number | null {
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  const tx = to.left + to.width / 2;
  const ty = to.top + to.height / 2;
  let along: number;
  let across: number;
  let overlap: number;
  if (dir === 'left' || dir === 'right') {
    along = dir === 'left' ? fx - tx : tx - fx;
    across = Math.abs(ty - fy);
    overlap = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top);
  } else {
    along = dir === 'up' ? fy - ty : ty - fy;
    across = Math.abs(tx - fx);
    overlap = Math.min(from.right, to.right) - Math.max(from.left, to.left);
  }
  if (along <= 1) return null;
  return along + across * 2 + (overlap > 0 ? 0 : OFF_LINE);
}

function isText(el: Element | null): boolean {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

export function installWebSpatialNav(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const onKey = (e: KeyboardEvent) => {
    const dir = DIRS[e.key];
    if (!dir || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
    // The full player has its own keys.
    if (playerState().presentation === 'full') return;
    const active = document.activeElement as HTMLElement | null;
    if (isText(active) && (dir === 'left' || dir === 'right')) return;
    const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(shown);
    if (!all.length) return;
    e.preventDefault();
    if (!active || active === document.body || !all.includes(active)) {
      all[0]?.focus();
      return;
    }
    const from = active.getBoundingClientRect();
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of all) {
      if (el === active || el.contains(active) || active.contains(el)) continue;
      const score = spatialScore(from, el.getBoundingClientRect(), dir);
      if (score !== null && score < bestScore) {
        best = el;
        bestScore = score;
      }
    }
    if (!best) return;
    best.focus();
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
