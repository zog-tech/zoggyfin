/** A key press. `key` follows the web `KeyboardEvent.key` values (" ", "ArrowLeft", "f"). */
export interface KeyPress {
  key: string;
  shift: boolean;
  meta: boolean;
  alt: boolean;
  /** A repeat of a held key (web). */
  repeat?: boolean;
}
