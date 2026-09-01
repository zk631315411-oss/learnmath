import { describe, expect, it } from 'vitest';

import { getInitialPdfPage, normalizePdfPage } from './usePdfPosition';

describe('normalizePdfPage', () => {
  it('normalizes page requests to positive integers', () => {
    expect(normalizePdfPage(7.9)).toBe(7);
    expect(normalizePdfPage(0)).toBe(1);
    expect(normalizePdfPage(-3)).toBe(1);
    expect(normalizePdfPage(Number.NaN)).toBe(1);
  });
});

describe('getInitialPdfPage', () => {
  it('uses an explicit URL page for the matching textbook', () => {
    expect(getInitialPdfPage('gaodai_shang', '?view=reader&textbook=gaodai_shang&page=52')).toBe(52);
    expect(getInitialPdfPage('gaodai_shang', '?view=reader&page=7')).toBe(7);
  });

  it('ignores a page that belongs to another textbook', () => {
    expect(getInitialPdfPage('gaodai_shang', '?view=reader&textbook=gaodai_xia&page=52')).toBe(1);
  });
});
