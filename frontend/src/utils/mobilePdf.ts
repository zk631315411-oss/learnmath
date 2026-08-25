export const MOBILE_PDF_MIN_ZOOM = 0.75;
export const MOBILE_PDF_MAX_ZOOM = 3;

export function clampMobilePdfZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(MOBILE_PDF_MIN_ZOOM, Math.min(MOBILE_PDF_MAX_ZOOM, value));
}

export function mobilePdfRenderWindow(currentPage: number, numPages: number, overscan = 2): number[] {
  if (!Number.isFinite(numPages) || numPages < 1) return [];
  const current = Math.max(1, Math.min(Math.floor(numPages), Math.floor(currentPage) || 1));
  const radius = Math.max(0, Math.floor(overscan));
  const start = Math.max(1, current - radius);
  const end = Math.min(Math.floor(numPages), current + radius);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function selectVisiblePdfPage(
  entries: Iterable<readonly [page: number, visiblePixels: number]>,
  fallback: number,
): number {
  let winner = fallback;
  let winnerPixels = -1;
  for (const [page, pixels] of entries) {
    if (!Number.isFinite(pixels) || pixels < 0) continue;
    if (pixels > winnerPixels) {
      winner = page;
      winnerPixels = pixels;
    }
  }
  return winner;
}

export function anchoredScrollOffset(scrollOffset: number, anchor: number, previousZoom: number, nextZoom: number): number {
  if (![scrollOffset, anchor, previousZoom, nextZoom].every(Number.isFinite) || previousZoom <= 0 || nextZoom <= 0) return Math.max(0, scrollOffset || 0);
  return Math.max(0, (scrollOffset + anchor) * nextZoom / previousZoom - anchor);
}
