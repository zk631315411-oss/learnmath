import { describe, expect, it } from 'vitest';

import { normalizePdfPage } from './usePdfPosition';

describe('normalizePdfPage', () => {
  it('normalizes page requests to positive integers', () => {
    expect(normalizePdfPage(7.9)).toBe(7);
    expect(normalizePdfPage(0)).toBe(1);
    expect(normalizePdfPage(-3)).toBe(1);
    expect(normalizePdfPage(Number.NaN)).toBe(1);
  });
});
