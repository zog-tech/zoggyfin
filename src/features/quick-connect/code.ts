/**
 * Quick Connect approval: a person types the code that another device shows
 * (a TV, a browser, another app) and this signed-in account lets that device
 * in. The rules for the code and the error texts. Pure, so it is unit-tested.
 */
import { describeError } from '@/api/errors';

/** Jellyfin Quick Connect codes have six digits. */
export const CODE_LENGTH = 6;

/** Keeps only digits, at most six. People paste codes with spaces or dashes ("123 456"). */
export function cleanCode(input: string): string {
  return input.replace(/\D+/g, '').slice(0, CODE_LENGTH);
}

/** True when the code has all six digits. */
export function isCompleteCode(code: string): boolean {
  return code.length === CODE_LENGTH && /^\d+$/.test(code);
}

/**
 * The message for a failed approval. Jellyfin answers 404 for a code it does
 * not know (a typo, or the code timed out), 401 when Quick Connect is off and
 * 403 when this account cannot approve for the user.
 */
export function approveErrorText(e: unknown): string {
  const d = describeError(e);
  switch (d.kind) {
    case 'notFound':
      return 'The server does not know this code. Check the code, or make a new one on the other device. A code works for a few minutes only.';
    case 'auth':
      return 'The server did not accept the code. Quick Connect may be off on this server.';
    case 'forbidden':
      return 'This account cannot approve this code.';
    default:
      return `${d.title}. ${d.message}`;
  }
}
