export const MOBILE_DELETE_REVEAL = 88;
export const MOBILE_DELETE_ACTIVATION = 48;

export function isHorizontalDeleteSwipe(deltaX: number, deltaY: number, threshold = 8): boolean {
  return deltaX < -threshold && Math.abs(deltaX) > Math.abs(deltaY);
}

export function deleteSwipeOffset(deltaX: number): number {
  if (!Number.isFinite(deltaX)) return 0;
  return Math.max(0, Math.min(MOBILE_DELETE_REVEAL, -deltaX));
}

export function settleDeleteSwipe(offset: number): 'open' | 'closed' {
  return offset >= MOBILE_DELETE_ACTIVATION ? 'open' : 'closed';
}
