import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

import {
  DEFAULT_READER_DOCK_POSITION,
  DOCK_DRAG_THRESHOLD,
  DOCK_LONG_PRESS_MS,
  dockPositionAtPoint,
  freeDockPositionAtPoint,
  getDockSurfaceRect,
  isReaderDockPosition,
  resolveDockAnchor,
  snapDockPosition,
  type DockBounds,
  type DockPoint,
  type ReaderDockPositionV1,
} from '../utils/floatingDock';
import { loadJSON, saveJSON } from '../utils/storage';
import { STORAGE_KEYS } from '../utils/storageKeys';
import type { SheetStage } from '../components/BottomSheet';

interface GestureState {
  pointerId: number;
  start: DockPoint;
  latest: DockPoint;
  committed: ReaderDockPositionV1;
  dragging: boolean;
  undocked: boolean;
  movedAfterUndock: boolean;
  tapCancelled: boolean;
  longPressTimer: number | null;
}

interface FloatingReaderDockResult {
  position: ReaderDockPositionV1;
  bounds: DockBounds | null;
  surfaceRect: ReturnType<typeof getDockSurfaceRect> | null;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

function distanceBetween(a: DockPoint, b: DockPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sameBounds(a: DockBounds | null, b: DockBounds): boolean {
  return !!a
    && Math.abs(a.left - b.left) < 0.5
    && Math.abs(a.top - b.top) < 0.5
    && Math.abs(a.right - b.right) < 0.5
    && Math.abs(a.bottom - b.bottom) < 0.5;
}

function clearLongPress(gesture: GestureState | null): void {
  if (gesture?.longPressTimer !== null && gesture?.longPressTimer !== undefined) {
    window.clearTimeout(gesture.longPressTimer);
    gesture.longPressTimer = null;
  }
}

export function useFloatingReaderDock(
  boundaryRef: RefObject<HTMLElement>,
  stage: SheetStage,
  onActivate: () => void,
): FloatingReaderDockResult {
  const [committed, setCommitted] = useState<ReaderDockPositionV1>(() => {
    const stored = loadJSON<unknown>(STORAGE_KEYS.mobileReaderDock, DEFAULT_READER_DOCK_POSITION);
    return isReaderDockPosition(stored) ? stored : DEFAULT_READER_DOCK_POSITION;
  });
  const [dragPosition, setDragPosition] = useState<ReaderDockPositionV1 | null>(null);
  const [fullBounds, setFullBounds] = useState<DockBounds | null>(null);
  const [activeBounds, setActiveBounds] = useState<DockBounds | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const activeBoundsRef = useRef<DockBounds | null>(null);
  const fullBoundsRef = useRef<DockBounds | null>(null);
  const activateRef = useRef(onActivate);

  activateRef.current = onActivate;

  const measure = useCallback(() => {
    const element = boundaryRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const measuredFull: DockBounds = {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
    let measuredActive = measuredFull;
    if (stage === 'half') {
      const sheetTop = window.innerHeight * 0.45;
      measuredActive = {
        ...measuredFull,
        bottom: Math.max(measuredFull.top + 72, Math.min(measuredFull.bottom, sheetTop - 8)),
      };
    }
    fullBoundsRef.current = measuredFull;
    activeBoundsRef.current = measuredActive;
    setFullBounds(previous => sameBounds(previous, measuredFull) ? previous : measuredFull);
    setActiveBounds(previous => sameBounds(previous, measuredActive) ? previous : measuredActive);
  }, [boundaryRef, stage]);

  useEffect(() => {
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (boundaryRef.current) observer?.observe(boundaryRef.current);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [boundaryRef, measure]);

  useEffect(() => () => clearLongPress(gestureRef.current), []);

  const projectedPosition = useMemo(() => {
    if (dragPosition || !fullBounds || !activeBounds) return dragPosition || committed;
    const anchor = resolveDockAnchor(committed, fullBounds);
    return committed.mode === 'free'
      ? freeDockPositionAtPoint(anchor, activeBounds)
      : dockPositionAtPoint(committed.mode, anchor, activeBounds);
  }, [activeBounds, committed, dragPosition, fullBounds]);

  const commitDisplayedPosition = useCallback((displayed: ReaderDockPositionV1) => {
    const currentActiveBounds = activeBoundsRef.current;
    const currentFullBounds = fullBoundsRef.current;
    if (!currentActiveBounds || !currentFullBounds) return;
    const anchor = resolveDockAnchor(displayed, currentActiveBounds);
    const next = displayed.mode === 'free'
      ? freeDockPositionAtPoint(anchor, currentFullBounds)
      : dockPositionAtPoint(displayed.mode, anchor, currentFullBounds);
    setCommitted(next);
    saveJSON(STORAGE_KEYS.mobileReaderDock, next);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !activeBoundsRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    const current = projectedPosition;
    const gesture: GestureState = {
      pointerId: event.pointerId,
      start: point,
      latest: point,
      committed: current,
      dragging: false,
      undocked: false,
      movedAfterUndock: false,
      tapCancelled: false,
      longPressTimer: null,
    };
    if (current.mode !== 'free') {
      gesture.longPressTimer = window.setTimeout(() => {
        const liveGesture = gestureRef.current;
        const bounds = activeBoundsRef.current;
        if (!liveGesture || liveGesture.pointerId !== event.pointerId || !bounds) return;
        liveGesture.undocked = true;
        liveGesture.dragging = true;
        const free = freeDockPositionAtPoint(liveGesture.latest, bounds);
        setDragPosition(free);
        if (navigator.vibrate) navigator.vibrate(12);
      }, DOCK_LONG_PRESS_MS);
    }
    gestureRef.current = gesture;
  }, [projectedPosition]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    const bounds = activeBoundsRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !bounds) return;
    const point = { x: event.clientX, y: event.clientY };
    gesture.latest = point;
    const distance = distanceBetween(gesture.start, point);

    if (gesture.committed.mode !== 'free' && !gesture.undocked) {
      if (distance >= DOCK_DRAG_THRESHOLD) {
        gesture.tapCancelled = true;
        clearLongPress(gesture);
      }
      return;
    }
    if (!gesture.dragging && distance < DOCK_DRAG_THRESHOLD) return;
    gesture.dragging = true;
    if (gesture.undocked && distance >= DOCK_DRAG_THRESHOLD) gesture.movedAfterUndock = true;
    setDragPosition(freeDockPositionAtPoint(point, bounds));
  }, []);

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const gesture = gestureRef.current;
    const bounds = activeBoundsRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    clearLongPress(gesture);
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);

    if (cancelled || !bounds) {
      setDragPosition(null);
      return;
    }

    if (gesture.dragging) {
      const free = freeDockPositionAtPoint(gesture.latest, bounds);
      const finished = gesture.undocked && !gesture.movedAfterUndock
        ? free
        : snapDockPosition(free, bounds, gesture.start, gesture.latest);
      setDragPosition(null);
      commitDisplayedPosition(finished);
      return;
    }

    setDragPosition(null);
    if (!gesture.tapCancelled) activateRef.current();
  }, [commitDisplayedPosition]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => finishPointer(event, false), [finishPointer]);
  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => finishPointer(event, true), [finishPointer]);

  return {
    position: projectedPosition,
    bounds: activeBounds,
    surfaceRect: activeBounds ? getDockSurfaceRect(projectedPosition, activeBounds) : null,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
