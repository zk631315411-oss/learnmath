export type ReaderDockMode = 'free' | 'left' | 'right' | 'top' | 'bottom';

export interface ReaderDockPositionV1 {
  version: 2;
  mode: ReaderDockMode;
  xRatio: number;
  yRatio: number;
}

export interface DockPoint {
  x: number;
  y: number;
}

export interface DockBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DockRect extends DockPoint {
  width: number;
  height: number;
}

export interface DockSize {
  width: number;
  height: number;
}

export const FREE_DOCK_SIZE = 48;
export const SIDE_DOCK_VISUAL_SIZE: DockSize = { width: 44, height: 188 };
export const HORIZONTAL_DOCK_VISUAL_SIZE: DockSize = { width: 188, height: 44 };
export const SIDE_DOCK_HIT_SIZE: DockSize = SIDE_DOCK_VISUAL_SIZE;
export const HORIZONTAL_DOCK_HIT_SIZE: DockSize = HORIZONTAL_DOCK_VISUAL_SIZE;
export const DOCK_SNAP_DISTANCE = 24;
export const DOCK_DRAG_THRESHOLD = 8;
export const DOCK_LONG_PRESS_MS = 350;
export const TOOLBAR_GAP = 8;

const MODES = new Set<ReaderDockMode>(['free', 'left', 'right', 'top', 'bottom']);

export const DEFAULT_READER_DOCK_POSITION: ReaderDockPositionV1 = {
  version: 2,
  mode: 'right',
  xRatio: 1,
  yRatio: 0.5,
};

export function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return Math.max(min, Math.min(max, value));
}

export function isReaderDockPosition(value: unknown): value is ReaderDockPositionV1 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ReaderDockPositionV1>;
  return candidate.version === 2
    && typeof candidate.mode === 'string'
    && MODES.has(candidate.mode as ReaderDockMode)
    && typeof candidate.xRatio === 'number'
    && Number.isFinite(candidate.xRatio)
    && candidate.xRatio >= 0
    && candidate.xRatio <= 1
    && typeof candidate.yRatio === 'number'
    && Number.isFinite(candidate.yRatio)
    && candidate.yRatio >= 0
    && candidate.yRatio <= 1;
}

export function dockPositionAtPoint(mode: ReaderDockMode, point: DockPoint, bounds: DockBounds): ReaderDockPositionV1 {
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  return {
    version: 2,
    mode,
    xRatio: clampNumber((point.x - bounds.left) / width, 0, 1),
    yRatio: clampNumber((point.y - bounds.top) / height, 0, 1),
  };
}

function clampedCenter(min: number, max: number, value: number): number {
  return clampNumber(value, min, max);
}

export function resolveDockAnchor(position: ReaderDockPositionV1, bounds: DockBounds): DockPoint {
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  const rawX = bounds.left + width * position.xRatio;
  const rawY = bounds.top + height * position.yRatio;

  if (position.mode === 'free') {
    const radius = FREE_DOCK_SIZE / 2;
    return {
      x: clampedCenter(bounds.left + radius, bounds.right - radius, rawX),
      y: clampedCenter(bounds.top + radius, bounds.bottom - radius, rawY),
    };
  }
  if (position.mode === 'left' || position.mode === 'right') {
    return {
      x: position.mode === 'left' ? bounds.left : bounds.right,
      y: clampedCenter(bounds.top + SIDE_DOCK_VISUAL_SIZE.height / 2, bounds.bottom - SIDE_DOCK_VISUAL_SIZE.height / 2, rawY),
    };
  }
  return {
    x: clampedCenter(bounds.left + HORIZONTAL_DOCK_VISUAL_SIZE.width / 2, bounds.right - HORIZONTAL_DOCK_VISUAL_SIZE.width / 2, rawX),
    y: position.mode === 'top' ? bounds.top : bounds.bottom,
  };
}

export function freeDockPositionAtPoint(point: DockPoint, bounds: DockBounds): ReaderDockPositionV1 {
  const radius = FREE_DOCK_SIZE / 2;
  const clamped = {
    x: clampedCenter(bounds.left + radius, bounds.right - radius, point.x),
    y: clampedCenter(bounds.top + radius, bounds.bottom - radius, point.y),
  };
  return dockPositionAtPoint('free', clamped, bounds);
}

export function snapDockPosition(
  freePosition: ReaderDockPositionV1,
  bounds: DockBounds,
  gestureStart: DockPoint,
  gestureEnd: DockPoint,
): ReaderDockPositionV1 {
  const anchor = resolveDockAnchor({ ...freePosition, mode: 'free' }, bounds);
  const radius = FREE_DOCK_SIZE / 2;
  const edgeCandidates: Array<{ mode: Exclude<ReaderDockMode, 'free'>; gap: number; axis: 'x' | 'y' }> = [
    { mode: 'left', gap: anchor.x - radius - bounds.left, axis: 'x' },
    { mode: 'right', gap: bounds.right - anchor.x - radius, axis: 'x' },
    { mode: 'top', gap: anchor.y - radius - bounds.top, axis: 'y' },
    { mode: 'bottom', gap: bounds.bottom - anchor.y - radius, axis: 'y' },
  ];
  const candidates = edgeCandidates.filter(item => item.gap <= DOCK_SNAP_DISTANCE + 0.001);

  if (!candidates.length) return { ...freePosition, mode: 'free' };

  const minimumGap = Math.min(...candidates.map(item => item.gap));
  const nearest = candidates.filter(item => Math.abs(item.gap - minimumGap) <= 0.5);
  let selected = nearest[0];
  if (nearest.length > 1) {
    const dx = gestureEnd.x - gestureStart.x;
    const dy = gestureEnd.y - gestureStart.y;
    const preferredAxis: 'x' | 'y' = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    selected = nearest.find(item => item.axis === preferredAxis) || nearest[0];
  }

  return dockPositionAtPoint(selected.mode, anchor, bounds);
}

export function getDockSurfaceRect(position: ReaderDockPositionV1, bounds: DockBounds): DockRect {
  const anchor = resolveDockAnchor(position, bounds);
  if (position.mode === 'free') {
    return { x: anchor.x - FREE_DOCK_SIZE / 2, y: anchor.y - FREE_DOCK_SIZE / 2, width: FREE_DOCK_SIZE, height: FREE_DOCK_SIZE };
  }
  if (position.mode === 'left') {
    return { x: bounds.left, y: anchor.y - SIDE_DOCK_HIT_SIZE.height / 2, ...SIDE_DOCK_HIT_SIZE };
  }
  if (position.mode === 'right') {
    return { x: bounds.right - SIDE_DOCK_HIT_SIZE.width, y: anchor.y - SIDE_DOCK_HIT_SIZE.height / 2, ...SIDE_DOCK_HIT_SIZE };
  }
  if (position.mode === 'top') {
    return { x: anchor.x - HORIZONTAL_DOCK_HIT_SIZE.width / 2, y: bounds.top, ...HORIZONTAL_DOCK_HIT_SIZE };
  }
  return { x: anchor.x - HORIZONTAL_DOCK_HIT_SIZE.width / 2, y: bounds.bottom - HORIZONTAL_DOCK_HIT_SIZE.height, ...HORIZONTAL_DOCK_HIT_SIZE };
}

function fitStart(value: number, size: number, min: number, max: number): number {
  return clampNumber(value, min + TOOLBAR_GAP, max - TOOLBAR_GAP - size);
}

export function placeDockToolbar(position: ReaderDockPositionV1, bounds: DockBounds, toolbar: DockSize): DockPoint {
  const anchor = resolveDockAnchor(position, bounds);
  const surface = getDockSurfaceRect(position, bounds);
  let x = surface.x;
  let y = surface.y;

  if (position.mode === 'left') {
    x = bounds.left + SIDE_DOCK_VISUAL_SIZE.width + TOOLBAR_GAP;
    y = anchor.y - toolbar.height / 2;
  } else if (position.mode === 'right') {
    x = bounds.right - SIDE_DOCK_VISUAL_SIZE.width - TOOLBAR_GAP - toolbar.width;
    y = anchor.y - toolbar.height / 2;
  } else if (position.mode === 'top') {
    x = anchor.x - toolbar.width / 2;
    y = bounds.top + HORIZONTAL_DOCK_VISUAL_SIZE.height + TOOLBAR_GAP;
  } else if (position.mode === 'bottom') {
    x = anchor.x - toolbar.width / 2;
    y = bounds.bottom - HORIZONTAL_DOCK_VISUAL_SIZE.height - TOOLBAR_GAP - toolbar.height;
  } else {
    const availableLeft = surface.x - bounds.left;
    const availableRight = bounds.right - (surface.x + surface.width);
    const availableTop = surface.y - bounds.top;
    const availableBottom = bounds.bottom - (surface.y + surface.height);
    const horizontalScore = Math.max(availableLeft, availableRight) / Math.max(1, toolbar.width);
    const verticalScore = Math.max(availableTop, availableBottom) / Math.max(1, toolbar.height);
    if (horizontalScore >= verticalScore) {
      x = availableRight >= availableLeft
        ? surface.x + surface.width + TOOLBAR_GAP
        : surface.x - TOOLBAR_GAP - toolbar.width;
      y = anchor.y - toolbar.height / 2;
    } else {
      x = anchor.x - toolbar.width / 2;
      y = availableBottom >= availableTop
        ? surface.y + surface.height + TOOLBAR_GAP
        : surface.y - TOOLBAR_GAP - toolbar.height;
    }
  }

  return {
    x: fitStart(x, toolbar.width, bounds.left, bounds.right),
    y: fitStart(y, toolbar.height, bounds.top, bounds.bottom),
  };
}

export function dockInwardDirection(mode: ReaderDockMode): 'left' | 'right' | 'up' | 'down' | 'free' {
  if (mode === 'left') return 'right';
  if (mode === 'right') return 'left';
  if (mode === 'top') return 'down';
  if (mode === 'bottom') return 'up';
  return 'free';
}
