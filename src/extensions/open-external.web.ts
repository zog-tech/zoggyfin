/**
 * Opens an `https` URL in a new browser tab for a panel's `openExternal`
 * (web and the Mac app): `window.open` with `noopener` and `noreferrer`, so
 * the new page gets no handle on the app and no referrer. With `noopener`
 * the browser returns no window, so the answer is true once the call ran
 * (a blocked popup cannot be seen from here).
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
}
