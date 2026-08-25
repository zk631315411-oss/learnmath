import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READER_DOCK_POSITION,
  dockInwardDirection,
  dockPositionAtPoint,
  freeDockPositionAtPoint,
  getDockSurfaceRect,
  isReaderDockPosition,
  placeDockToolbar,
  resolveDockAnchor,
  snapDockPosition,
  type DockBounds,
} from './floatingDock';

const bounds: DockBounds = { left: 12, top: 72, right: 378, bottom: 832 };

describe('floating reader dock geometry', () => {
  it('validates the versioned persisted shape', () => {
    expect(isReaderDockPosition(DEFAULT_READER_DOCK_POSITION)).toBe(true);
    expect(isReaderDockPosition({ version: 2, mode: 'free', xRatio: 1, yRatio: 1 })).toBe(false);
    expect(isReaderDockPosition({ version: 1, mode: 'corner', xRatio: 1, yRatio: 1 })).toBe(false);
    expect(isReaderDockPosition({ version: 1, mode: 'left', xRatio: -1, yRatio: 1 })).toBe(false);
  });

  it('clamps the default free ball inside the safe reader bounds', () => {
    expect(resolveDockAnchor(DEFAULT_READER_DOCK_POSITION, bounds)).toEqual({ x: 354, y: 808 });
  });

  it.each([
    ['left', { x: 37, y: 400 }],
    ['right', { x: 353, y: 400 }],
    ['top', { x: 200, y: 97 }],
    ['bottom', { x: 200, y: 807 }],
  ] as const)('snaps a free ball near the %s edge', (mode, point) => {
    const free = freeDockPositionAtPoint(point, bounds);
    expect(snapDockPosition(free, bounds, { x: 200, y: 400 }, point).mode).toBe(mode);
  });

  it('keeps a free ball free outside every snap threshold', () => {
    const point = { x: 200, y: 400 };
    const free = freeDockPositionAtPoint(point, bounds);
    expect(snapDockPosition(free, bounds, point, point).mode).toBe('free');
  });

  it('uses the dominant gesture axis when a corner is equally close to two edges', () => {
    const corner = { x: 36, y: 96 };
    const free = freeDockPositionAtPoint(corner, bounds);
    expect(snapDockPosition(free, bounds, { x: 200, y: 97 }, corner).mode).toBe('left');
    expect(snapDockPosition(free, bounds, { x: 37, y: 300 }, corner).mode).toBe('top');
  });

  it('uses expanded hit targets while keeping every dock surface in bounds', () => {
    const left = getDockSurfaceRect(dockPositionAtPoint('left', { x: 12, y: 400 }, bounds), bounds);
    const right = getDockSurfaceRect(dockPositionAtPoint('right', { x: 378, y: 400 }, bounds), bounds);
    const top = getDockSurfaceRect(dockPositionAtPoint('top', { x: 200, y: 72 }, bounds), bounds);
    const bottom = getDockSurfaceRect(dockPositionAtPoint('bottom', { x: 200, y: 832 }, bounds), bounds);
    expect(left).toMatchObject({ x: 12, width: 44, height: 56 });
    expect(right).toMatchObject({ x: 334, width: 44, height: 56 });
    expect(top).toMatchObject({ y: 72, width: 56, height: 44 });
    expect(bottom).toMatchObject({ y: 788, width: 56, height: 44 });
  });

  it.each([
    ['left', 'right'],
    ['right', 'left'],
    ['top', 'down'],
    ['bottom', 'up'],
  ] as const)('opens a %s dock inward', (mode, expected) => {
    expect(dockInwardDirection(mode)).toBe(expected);
  });

  it('places edge toolbars inward and clamps them to the safe area', () => {
    const toolbar = { width: 184, height: 97 };
    const left = dockPositionAtPoint('left', { x: 12, y: 100 }, bounds);
    const bottom = dockPositionAtPoint('bottom', { x: 360, y: 832 }, bounds);
    const leftPlacement = placeDockToolbar(left, bounds, toolbar);
    const bottomPlacement = placeDockToolbar(bottom, bounds, toolbar);
    expect(leftPlacement.x).toBe(44);
    expect(leftPlacement.y).toBeGreaterThanOrEqual(bounds.top + 8);
    expect(bottomPlacement.y).toBe(703);
    expect(bottomPlacement.x + toolbar.width).toBeLessThanOrEqual(bounds.right - 8);
  });

  it('opens a free ball toward available space and keeps the toolbar visible', () => {
    const free = freeDockPositionAtPoint({ x: 350, y: 780 }, bounds);
    const toolbar = { width: 184, height: 97 };
    const placement = placeDockToolbar(free, bounds, toolbar);
    expect(placement.x).toBeLessThan(350);
    expect(placement.y).toBeGreaterThanOrEqual(bounds.top + 8);
    expect(placement.y + toolbar.height).toBeLessThanOrEqual(bounds.bottom - 8);
  });
});
