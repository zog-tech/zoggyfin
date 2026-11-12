import { spacing } from '@/theme/theme';

import { MODAL_ORIENTATIONS, sheetHeight } from '../sheet-layout';

describe('sheetHeight', () => {
  it('takes 80 % of a tall window', () => {
    expect(sheetHeight(874, 62)).toBe('80%');
    expect(sheetHeight(1032, 24)).toBe('80%');
  });

  it('takes all but a top margin on a phone on its side', () => {
    expect(sheetHeight(402, 0)).toBe(`${Math.floor(((402 - spacing.xl) / 402) * 100)}%`);
    expect(sheetHeight(390, 30)).toBe('92%');
  });

  it('keeps 80 % before the window is measured', () => {
    expect(sheetHeight(0, 0)).toBe('80%');
  });
});

describe('MODAL_ORIENTATIONS', () => {
  it('accepts landscape, so a sheet turns with the app', () => {
    expect(MODAL_ORIENTATIONS).toContain('landscape');
    expect(MODAL_ORIENTATIONS).toContain('portrait');
  });
});
