import type { BaseItemDto } from '@/api/types';

import { asksDownloadQuality, downloadQualityChoices } from '../quality-choice';

const HOUR_TICKS = 3600 * 10_000_000;

function film(opts: { height?: number; bitrate?: number; size?: number; ticks?: number | null }): BaseItemDto {
  return {
    Id: 'f1',
    Type: 'Movie',
    RunTimeTicks: opts.ticks === undefined ? 2 * HOUR_TICKS : opts.ticks,
    MediaSources: [
      {
        Id: 'f1',
        Size: opts.size,
        Bitrate: opts.bitrate,
        MediaStreams: opts.height ? [{ Type: 'Video', Height: opts.height }, { Type: 'Audio' }] : [{ Type: 'Audio' }],
      },
    ],
  } as BaseItemDto;
}

const values = (item: BaseItemDto, def: 0 | 1080 | 720 | 480 = 0) => downloadQualityChoices(item, def).choices.map((c) => c.value);

describe('downloadQualityChoices', () => {
  it('offers all three lower heights for a 4K source', () => {
    expect(values(film({ height: 2160 }))).toEqual([0, 1080, 720, 480]);
  });

  it('offers only heights below a 1080p source', () => {
    expect(values(film({ height: 1080 }))).toEqual([0, 720, 480]);
  });

  it('offers all three when the height is unknown', () => {
    expect(values(film({}))).toEqual([0, 1080, 720, 480]);
  });

  it('shows the original size and estimates at the cap', () => {
    const { choices } = downloadQualityChoices(film({ height: 2160, bitrate: 60_000_000, size: 50e9 }), 0);
    expect(choices[0]).toMatchObject({ label: 'Original', detail: '50.0 GB', bytes: 50e9 });
    // 720p: (4 Mbps + 192 kbps) × 7200 s / 8
    const p720 = choices.find((c) => c.value === 720);
    expect(p720?.bytes).toBe(Math.round(((4_000_000 + 192_000) * 7200) / 8));
    expect(p720?.detail).toBe('about 3.8 GB');
  });

  it('uses the source bitrate when it is lower than the cap', () => {
    const { choices } = downloadQualityChoices(film({ height: 2160, bitrate: 3_000_000 }), 0);
    const p1080 = choices.find((c) => c.value === 1080);
    expect(p1080?.bytes).toBe(Math.round(((3_000_000 + 192_000) * 7200) / 8));
    // 480p keeps its own lower cap.
    expect(choices.find((c) => c.value === 480)?.bytes).toBe(Math.round(((1_500_000 + 192_000) * 7200) / 8));
  });

  it('shows no estimate when the runtime is unknown', () => {
    const { choices } = downloadQualityChoices(film({ height: 2160, size: 4e9, ticks: null }), 0);
    expect(choices[0]?.detail).toBe('4.0 GB');
    expect(choices.slice(1).every((c) => c.detail === null && c.bytes === null)).toBe(true);
  });

  it('shows labels only when the item has no media sources', () => {
    const { choices, selected } = downloadQualityChoices({ RunTimeTicks: HOUR_TICKS }, 720);
    expect(choices.map((c) => c.value)).toEqual([0, 1080, 720, 480]);
    expect(choices.every((c) => c.detail === null)).toBe(true);
    expect(selected).toBe(720);
  });

  it('selects the setting when it is offered, else Original', () => {
    expect(downloadQualityChoices(film({ height: 2160 }), 720).selected).toBe(720);
    expect(downloadQualityChoices(film({ height: 720 }), 720).selected).toBe(0);
    expect(downloadQualityChoices(film({ height: 1080 }), 1080).selected).toBe(0);
    expect(downloadQualityChoices(film({ height: 1080 }), 0).selected).toBe(0);
  });
});

describe('asksDownloadQuality', () => {
  it('asks for single video items only', () => {
    expect(asksDownloadQuality({ Type: 'Movie' })).toBe(true);
    expect(asksDownloadQuality({ Type: 'Episode' })).toBe(true);
    expect(asksDownloadQuality({ Type: 'MusicVideo' })).toBe(true);
    expect(asksDownloadQuality({ Type: 'Season' })).toBe(false);
    expect(asksDownloadQuality({ Type: 'Series' })).toBe(false);
    expect(asksDownloadQuality({ Type: 'BoxSet' })).toBe(false);
    expect(asksDownloadQuality({ Type: 'Folder', MediaType: 'Video' })).toBe(false);
    expect(asksDownloadQuality({ Type: 'Audio' })).toBe(false);
  });
});
