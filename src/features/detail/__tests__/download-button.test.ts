import { downloadButtonView } from '../download-button';

describe('downloadButtonView', () => {
  it('offers a download when nothing is on the device', () => {
    expect(downloadButtonView({ state: 'none' }, null)).toEqual({ icon: 'arrow.down.circle', label: 'Download', a11y: 'Download', tint: null });
  });

  it('shows a downloaded item in the success colour, and the press removes it', () => {
    const v = downloadButtonView({ state: 'completed' }, null);
    expect(v).toMatchObject({ icon: 'arrow.down.circle.fill', label: 'Downloaded', tint: 'success' });
    expect(v.a11y).toContain('Remove the download');
    expect(v.ring).toBeUndefined();
  });

  it('counts an album: "3 of 12" with a ring of the byte progress', () => {
    const v = downloadButtonView({ state: 'downloading', progress: 0.3 }, { done: 3, total: 12 });
    expect(v.label).toBe('3 of 12');
    expect(v.ring).toBe(0.3);
    expect(v.a11y).toBe('Downloading, 3 of 12 downloaded. Open Downloads');
  });

  it('shows the percent of a single item', () => {
    const v = downloadButtonView({ state: 'downloading', progress: 0.456 }, null);
    expect(v.label).toBe('46%');
    expect(v.a11y).toBe('Downloading, 46 percent. Open Downloads');
  });

  it('says paused and waiting in words, never by colour alone', () => {
    expect(downloadButtonView({ state: 'paused', progress: 0.5 }, { done: 1, total: 2 }).label).toBe('Paused');
    expect(downloadButtonView({ state: 'queued', progress: 0 }, { done: 0, total: 5 })).toMatchObject({ label: '0 of 5', ring: 0 });
    expect(downloadButtonView({ state: 'queued', progress: 0 }, null).a11y).toContain('Waiting to download');
  });

  it('tells a failed download from a missing file', () => {
    expect(downloadButtonView({ state: 'failed', progress: 0.2 }, null)).toMatchObject({ icon: 'exclamationmark.triangle', label: 'Failed', tint: 'danger' });
    expect(downloadButtonView({ state: 'failed', progress: 0, missing: true }, null)).toMatchObject({ icon: 'arrow.down.circle', label: 'Download again', tint: 'danger' });
  });
});
