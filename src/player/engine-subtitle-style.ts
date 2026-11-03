/**
 * Web and Mac app: passes the subtitle appearance to the renderers that the
 * app does not draw itself. The browser draws the subtitles inside an HLS
 * stream (one `<style>` with `::cue` rules); libmpv draws every subtitle in
 * the Mac app (its `sub-*` properties, which stay set across files).
 */
import { hasMpv, mpv } from '@/platform/desktop';
import { cueCss, mpvSubtitleProperties, type SubtitleAppearance } from '@/settings/subtitle-style';

const STYLE_ID = 'zoggyfin-cue-style';

export function applyEngineSubtitleStyle(a: SubtitleAppearance): void {
  if (typeof document !== 'undefined') {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = cueCss(a);
  }
  if (hasMpv) {
    for (const [name, value] of mpvSubtitleProperties(a)) {
      // An older libmpv may not know a property: the others still apply.
      mpv.set(name, value).catch(() => {});
    }
  }
}
