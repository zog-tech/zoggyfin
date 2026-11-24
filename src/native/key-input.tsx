import { type ReactNode, useEffect, useRef } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';

import type { KeyPress } from './key-input-types';

const KNOWN = [' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'Backspace', 'Delete', 'f', 'm', 'c', 'k', 'j', 'l', 'q', 'n', 'p', 's', 'r'];

function isTextTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Web: listens on the document while mounted. Text fields keep their keys.
 * `onKeyUp` gets the same keys going up (the TV preview tells a press from a hold with it).
 */
export function KeyInput({
  enabled = true,
  onKey,
  onKeyUp,
  style,
  children,
}: {
  enabled?: boolean;
  onKey: (press: KeyPress) => void;
  onKeyUp?: (press: KeyPress) => void;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const handler = useRef(onKey);
  const upHandler = useRef(onKeyUp);
  useEffect(() => {
    handler.current = onKey;
    upHandler.current = onKeyUp;
  });
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    // A button that kept focus (for example the Play button under the player)
    // would also get Space as a click. Drop that focus.
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && !isTextTarget(active)) active.blur();
    const keyOf = (e: KeyboardEvent): string | null => {
      if (isTextTarget(e.target) || e.ctrlKey) return null;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      return KNOWN.includes(key) ? key : null;
    };
    const swallowUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && !isTextTarget(e.target)) e.preventDefault();
      const key = keyOf(e);
      if (key) upHandler.current?.({ key, shift: e.shiftKey, meta: e.metaKey, alt: e.altKey });
    };
    const listener = (e: KeyboardEvent) => {
      const key = keyOf(e);
      if (!key) return;
      e.preventDefault();
      if (key === ' ' && e.target instanceof HTMLElement && e.target !== document.body) e.target.blur();
      handler.current({ key, shift: e.shiftKey, meta: e.metaKey, alt: e.altKey, repeat: e.repeat });
    };
    document.addEventListener('keydown', listener);
    document.addEventListener('keyup', swallowUp);
    return () => {
      document.removeEventListener('keydown', listener);
      document.removeEventListener('keyup', swallowUp);
    };
  }, [enabled]);
  return <View style={style}>{children}</View>;
}
