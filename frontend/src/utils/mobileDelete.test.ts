import { describe, expect, it } from 'vitest';

import { deleteSwipeOffset, isHorizontalDeleteSwipe, settleDeleteSwipe } from './mobileDelete';

describe('mobile question record delete swipe', () => {
  it('only activates for a leftward horizontal gesture', () => {
    expect(isHorizontalDeleteSwipe(-40, 8)).toBe(true);
    expect(isHorizontalDeleteSwipe(40, 8)).toBe(false);
    expect(isHorizontalDeleteSwipe(-40, 80)).toBe(false);
    expect(isHorizontalDeleteSwipe(-4, 0)).toBe(false);
  });

  it('clamps the revealed action to the fixed width', () => {
    expect(deleteSwipeOffset(-20)).toBe(20);
    expect(deleteSwipeOffset(-200)).toBe(88);
    expect(deleteSwipeOffset(20)).toBe(0);
  });

  it('opens only after the deliberate reveal threshold', () => {
    expect(settleDeleteSwipe(47)).toBe('closed');
    expect(settleDeleteSwipe(48)).toBe('open');
    expect(settleDeleteSwipe(88)).toBe('open');
  });
});
