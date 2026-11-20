import type { BaseItemDto } from '@/api/types';

import { closeDownloadQuality, openDownloadQuality, takeDownloadQualityItem, useDownloadQualitySheet } from '../download-quality-store';

const film = { Id: 'f1', Type: 'Movie', Name: 'A film' } as BaseItemDto;

describe('download quality sheet store', () => {
  beforeEach(() => closeDownloadQuality());

  it('hands out the item once, then is closed', () => {
    openDownloadQuality(film);
    expect(useDownloadQualitySheet.getState().item).toBe(film);
    expect(takeDownloadQualityItem()).toBe(film);
    expect(takeDownloadQualityItem()).toBeNull();
    expect(useDownloadQualitySheet.getState().item).toBeNull();
  });

  it('starts nothing after a close', () => {
    openDownloadQuality(film);
    closeDownloadQuality();
    expect(takeDownloadQualityItem()).toBeNull();
  });

  it('does not open for an item with no id', () => {
    openDownloadQuality({ Type: 'Movie' } as BaseItemDto);
    expect(useDownloadQualitySheet.getState().item).toBeNull();
  });
});
