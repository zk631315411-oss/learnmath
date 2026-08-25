import { describe, expect, it } from 'vitest';

import { anchoredScrollOffset, clampMobilePdfZoom, mobilePdfRenderWindow, selectVisiblePdfPage } from './mobilePdf';

describe('mobile continuous PDF helpers', () => {
  it('clamps pinch zoom to the public 75%-300% contract', () => {
    expect(clampMobilePdfZoom(0.2)).toBe(0.75);
    expect(clampMobilePdfZoom(1.37)).toBe(1.37);
    expect(clampMobilePdfZoom(8)).toBe(3);
    expect(clampMobilePdfZoom(Number.NaN)).toBe(1);
  });

  it('renders at most the current page and two neighbors per side', () => {
    expect(mobilePdfRenderWindow(1, 421)).toEqual([1, 2, 3]);
    expect(mobilePdfRenderWindow(210, 421)).toEqual([208, 209, 210, 211, 212]);
    expect(mobilePdfRenderWindow(421, 421)).toEqual([419, 420, 421]);
  });

  it('selects the page with the largest visible area', () => {
    expect(selectVisiblePdfPage([[8, 20_000], [9, 80_000], [10, 4_000]], 8)).toBe(9);
    expect(selectVisiblePdfPage([], 8)).toBe(8);
  });

  it('keeps the content under the pinch midpoint anchored', () => {
    expect(anchoredScrollOffset(500, 150, 1, 2)).toBe(1150);
    expect(anchoredScrollOffset(500, 150, 2, 1)).toBe(175);
  });
});
