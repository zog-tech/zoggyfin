import { buildReport, makeEntry } from '@/lib/diag-log';

import { type DeviceFacts, platformLabel, reportInfo, versionLabel } from '../report';

const phone: DeviceFacts = {
  os: 'ios',
  osVersion: '26.1',
  tv: false,
  desktop: false,
  desktopVersion: null,
  nativeVersion: '0.1.1',
  nativeBuild: '22',
  fallbackVersion: '0.1.1',
  updateId: 'c66a06bb',
  runtimeVersion: '0.1.1',
  lite: false,
};

describe('report header facts', () => {
  it('names the platform', () => {
    expect(platformLabel(phone)).toBe('ios');
    expect(platformLabel({ os: 'android', tv: true, desktop: false })).toBe('android tv');
    expect(platformLabel({ os: 'web', tv: false, desktop: true })).toBe('macos app');
  });

  it('gives the app version with the build, or the Mac app version', () => {
    expect(versionLabel(phone)).toBe('0.1.1 (22)');
    expect(versionLabel({ ...phone, nativeVersion: null, nativeBuild: null })).toBe('0.1.1');
    expect(versionLabel({ ...phone, desktopVersion: '0.4.0' })).toBe('0.4.0');
  });

  it('turns the facts into the report header', () => {
    const info = reportInfo({ ...phone, osVersion: 35, os: 'android' }, 5);
    expect(info).toEqual({ appVersion: '0.1.1 (22)', updateId: 'c66a06bb', runtimeVersion: '0.1.1', platform: 'android', osVersion: '35', lite: false, now: 5 });
    expect(reportInfo({ ...phone, osVersion: undefined }, 5).osVersion).toBe('');
  });

  it('a report of a normal song start holds no address and no name', () => {
    const t = new Date(2026, 10, 24, 21, 30, 0, 0).getTime();
    const log = [
      makeEntry(t, 'music', 'play', { id: 4, list: 12, container: false, type: 'Audio', queue: 0, shuffle: false, start: false, item: '9f1c2e7a' }),
      makeEntry(t + 120, 'audio', 'load', { token: 3, autoplay: true, start: 0, offset: 0, next: true, uri: 'http', key: 'k1', phase: 'idle' }),
      makeEntry(t + 300, 'audio', 'status', { playing: true, buffering: false, loaded: true, index: 0, time: 0.4 }),
    ];
    const text = buildReport(reportInfo(phone, t + 5000), 'It worked.', log);
    expect(text).toContain('21:30:00.120 audio load token=3 autoplay=true start=0 offset=0 next=true uri=http key=k1 phase=idle');
    expect(text).not.toMatch(/https?:|ApiKey|@/);
  });
});
