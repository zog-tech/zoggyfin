/**
 * Right click (the `contextmenu` event) on the web and in the Mac app. A
 * control with a long press action runs that action on a right click, and
 * the browser's own menu (for a tile: open, save and copy image) does not
 * show. react-native-web blocks that menu only for touch, and never maps a
 * right click to the long press.
 *
 * The browser menu stays on a control with no long press, in text fields
 * (cut, copy, paste) and when an inner control already took the event.
 * Pure, so it is unit-tested.
 */

/** The parts of a DOM element that the rule reads. */
export interface MenuTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

/** The parts of the `contextmenu` event that the rule reads. */
export interface MenuEvent {
  defaultPrevented: boolean;
  target: unknown;
}

const TEXT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when the event target is a text field (its own menu has cut, copy and paste). */
export function isTextTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const t = target as MenuTarget;
  return !!t.isContentEditable || (typeof t.tagName === 'string' && TEXT_TAGS.has(t.tagName.toUpperCase()));
}

/** True when the control runs its long press action for this right click instead of the browser menu. */
export function takesContextMenu(event: MenuEvent, control: { longPress: boolean; disabled: boolean }): boolean {
  if (!control.longPress || control.disabled) return false;
  // An inner control with a long press took it already: one right click opens one menu.
  if (event.defaultPrevented) return false;
  return !isTextTarget(event.target);
}

/**
 * Mac app: true when a right click that no control took must not show the
 * browser menu. The browser menu (open, save and copy image, reload,
 * inspect) does not belong in an app window. Text fields and selected text
 * keep it, for cut, copy and paste.
 */
export function blocksBrowserMenu(event: MenuEvent, selectedText: string): boolean {
  if (event.defaultPrevented) return false;
  if (isTextTarget(event.target)) return false;
  return selectedText.trim().length === 0;
}

/** Mac app: hides the browser menu where no control took the right click. Returns the remove function. */
export function installAppContextMenu(doc: Document): () => void {
  const onMenu = (e: MouseEvent) => {
    if (blocksBrowserMenu(e, doc.getSelection()?.toString() ?? '')) e.preventDefault();
  };
  // Bubble phase on the document: the React handlers of the controls ran first.
  doc.addEventListener('contextmenu', onMenu);
  return () => doc.removeEventListener('contextmenu', onMenu);
}
