/**
 * Lite mode for code that must not load the settings store (the video engine, which tests load
 * with no storage). The app root passes the check in (`setLiteCheck`); until then it is off.
 */
let check: () => boolean = () => false;

export function setLiteCheck(next: () => boolean): void {
  check = next;
}

/** True when Lite mode is on now. */
export function liteFlag(): boolean {
  return check();
}
