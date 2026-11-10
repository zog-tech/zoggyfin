import { create } from 'zustand';

import type { IconName } from '@/components/icon-names';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastMessage {
  id: number;
  text: string;
  icon?: IconName;
  action?: ToastAction;
}

interface ToastState {
  current: ToastMessage | null;
  /**
   * Toast hosts inside full-screen modals (the video and music players). A
   * native modal covers the root host, so while one is mounted it shows the
   * toasts and the root host hides.
   */
  overlays: number;
  addOverlay: () => void;
  removeOverlay: () => void;
  show: (text: string, opts?: { icon?: IconName; action?: ToastAction }) => void;
  hide: (id?: number) => void;
}

let next = 1;

/** One toast at a time (design system §7.14): a new one replaces the old. */
export const useToastStore = create<ToastState>((set, get) => ({
  current: null,
  overlays: 0,
  addOverlay: () => set((st) => ({ overlays: st.overlays + 1 })),
  removeOverlay: () => set((st) => ({ overlays: Math.max(0, st.overlays - 1) })),
  show: (text, opts) => set({ current: { id: next++, text, icon: opts?.icon, action: opts?.action } }),
  hide: (id) => {
    if (id === undefined || get().current?.id === id) set({ current: null });
  },
}));

export function toast(text: string, opts?: { icon?: IconName; action?: ToastAction }): void {
  useToastStore.getState().show(text, opts);
}

/**
 * Visible time: 3.2 s, or 6 s with an action. TV: 10 s with an action, as
 * the remote needs more time to reach it (and it stays while it has the
 * focus: toastTakesFocus).
 */
export function toastDuration(m: Pick<ToastMessage, 'action'>, tv = false): number {
  if (!m.action) return 3200;
  return tv ? 10_000 : 6000;
}

/**
 * TV: an action toast takes the focus when it shows, so one Select runs the
 * action. Never while a text field has the focus (the person is typing).
 * Phones and the web keep the focus where it is.
 */
export function toastTakesFocus(m: Pick<ToastMessage, 'action'>, tv: boolean, textFocused: boolean): boolean {
  return tv && !!m.action && !textFocused;
}

/**
 * How a toast looks. On app screens it follows the app theme. In a player
 * (an overlay host) it is over video, which is always dark: the glass is
 * dark and the text light, also in the light app theme. Pure, so it is unit-tested.
 */
export function toastLook(overlay: boolean, c: { text: string; textOnMedia: string }): { glass: 'dark' | 'auto'; text: string } {
  return overlay ? { glass: 'dark', text: c.textOnMedia } : { glass: 'auto', text: c.text };
}
