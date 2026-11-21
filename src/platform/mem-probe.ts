/**
 * Memory probe for low-memory work (Lite mode). Only in a build made with
 * EXPO_PUBLIC_MEM_PROBE=1: every 5 s it logs the Hermes heap to the device log
 * (`adb logcat -s ReactNativeJS | grep memprobe`), so a probe run can split
 * JavaScript memory from images and views. Other builds do nothing.
 */
type HermesStats = Record<string, number>;
type Hermes = { getInstrumentedStats?: () => HermesStats };

const MB = 1024 * 1024;

export function startMemProbe(): () => void {
  if (process.env.EXPO_PUBLIC_MEM_PROBE !== '1') return () => {};
  const hermes = (globalThis as { HermesInternal?: Hermes }).HermesInternal;
  const t0 = Date.now();
  const tick = () => {
    const s = hermes?.getInstrumentedStats?.();
    if (!s) return;
    const mb = (k: string) => (s[k] !== undefined ? (s[k] / MB).toFixed(1) : '?');
    console.log(
      `[memprobe] t=${Math.round((Date.now() - t0) / 1000)}s heap=${mb('js_heapSize')} alloc=${mb('js_allocatedBytes')} external=${mb('js_externalBytes')} gcs=${s.js_numGCs ?? '?'}`,
    );
  };
  tick();
  const id = setInterval(tick, 5000);
  return () => clearInterval(id);
}
