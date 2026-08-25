import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Document, Page, type DocumentProps } from 'react-pdf';

import { loadJSON, saveJSON } from '../utils/storage';
import { STORAGE_KEYS } from '../utils/storageKeys';
import { clampMobilePdfZoom, mobilePdfRenderWindow, selectVisiblePdfPage } from '../utils/mobilePdf';
import PageMarker from './PageMarker';
import type { PDFViewerControls, PDFViewerProps } from './PDFViewer';

const PAGE_GAP = 12;
const PAGE_OVERSCAN = 2;
const REPORT_DELAY_MS = 150;
const DEFAULT_PAGE = { width: 595, height: 842 };
const LOADING_OPTIONS: DocumentProps['options'] = {
  disableRange: false,
  disableStream: true,
  disableAutoFetch: true,
  rangeChunkSize: 512 * 1024,
};

type PageSize = { width: number; height: number };
type TouchGesture = {
  distance: number;
  factor: number;
  midpointX: number;
  midpointY: number;
  pageNumber: number | null;
  pageXRatio: number;
  pageYRatio: number;
};
type PanGesture = {
  x: number;
  y: number;
  time: number;
  velocityX: number;
  velocityY: number;
};
type GesturePoint = { clientX: number; clientY: number };

function distance(a: GesturePoint, b: GesturePoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function midpoint(a: GesturePoint, b: GesturePoint): { x: number; y: number } {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

function readZoom(textbookId: string): number {
  const values = loadJSON<Record<string, number>>(STORAGE_KEYS.mobilePdfZoom, {});
  return clampMobilePdfZoom(Number(values[textbookId]) || 1);
}

function writeZoom(textbookId: string, factor: number): void {
  if (!textbookId) return;
  const values = loadJSON<Record<string, number>>(STORAGE_KEYS.mobilePdfZoom, {});
  values[textbookId] = factor;
  saveJSON(STORAGE_KEYS.mobilePdfZoom, values);
}

export default function MobileContinuousPDFViewer({
  pdfUrl,
  textbookId,
  page,
  onPageRequest,
  markers,
  pdfContainerRef,
  onMarkerClick,
  onControlsChange,
  pageOverlay,
  mobileInsets = { top: 0, right: 0, bottom: 0, left: 0 },
}: PDFViewerProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const reportTimer = useRef<number | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const lastReportedPage = useRef(page);
  const externalPage = useRef(page);
  const pinchRef = useRef<TouchGesture | null>(null);
  const pendingAnchor = useRef<{
    screenX: number;
    screenY: number;
    pageNumber: number | null;
    pageXRatio: number;
    pageYRatio: number;
    fallbackRatio: number;
  } | null>(null);
  const zoomFrame = useRef<number | null>(null);
  const momentumFrame = useRef<number | null>(null);
  const nextZoom = useRef<number | null>(null);
  const panRef = useRef<PanGesture | null>(null);
  const activePointers = useRef(new Map<number, GesturePoint>());

  const [numPages, setNumPages] = useState(0);
  const [visiblePage, setVisiblePage] = useState(Math.max(1, page));
  const [zoomFactor, setZoomFactor] = useState(() => readZoom(textbookId));
  const [previewZoom, setPreviewZoom] = useState<number | null>(null);
  const [previewOrigin, setPreviewOrigin] = useState({ x: 0, y: 0 });
  const [contentWidth, setContentWidth] = useState(320);
  const [pageSizes, setPageSizes] = useState<Record<number, PageSize>>({});
  const [pdfError, setPdfError] = useState('');
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null);

  const zoomFactorRef = useRef(zoomFactor);
  zoomFactorRef.current = zoomFactor;

  const visiblePageRef = useRef(visiblePage);
  visiblePageRef.current = visiblePage;

  const renderedPages = useMemo(() => {
    const result = new Set<number>();
    for (const value of mobilePdfRenderWindow(visiblePage, numPages, PAGE_OVERSCAN)) result.add(value);
    return result;
  }, [numPages, visiblePage]);

  const pageSize = useCallback((pageNumber: number) => pageSizes[pageNumber] || pageSizes[1] || DEFAULT_PAGE, [pageSizes]);
  const renderedWidth = contentWidth * zoomFactor;

  useEffect(() => {
    setZoomFactor(readZoom(textbookId));
    setVisiblePage(Math.max(1, page));
    lastReportedPage.current = page;
    externalPage.current = page;
  }, [textbookId]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      const next = Math.max(220, element.clientWidth - 24 - mobileInsets.left - mobileInsets.right);
      setContentWidth(previous => Math.abs(previous - next) < 0.5 ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [mobileInsets.left, mobileInsets.right]);

  const updateVisiblePage = useCallback(() => {
    const container = scrollRef.current;
    if (!container || !numPages) return;
    const viewport = container.getBoundingClientRect();
    const entries: Array<readonly [number, number]> = [];
    for (const [pageNumber, element] of pageRefs.current) {
      const rect = element.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top));
      const visibleWidth = Math.max(0, Math.min(rect.right, viewport.right) - Math.max(rect.left, viewport.left));
      const pixels = visibleHeight * visibleWidth;
      entries.push([pageNumber, pixels]);
    }
    const winner = selectVisiblePdfPage(entries, visiblePageRef.current);
    if (winner === visiblePageRef.current) return;
    visiblePageRef.current = winner;
    setVisiblePage(winner);
    if (reportTimer.current !== null) window.clearTimeout(reportTimer.current);
    reportTimer.current = window.setTimeout(() => {
      lastReportedPage.current = winner;
      onPageRequest(winner);
    }, REPORT_DELAY_MS);
  }, [numPages, onPageRequest]);

  const onScroll = useCallback(() => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      updateVisiblePage();
    });
  }, [updateVisiblePage]);

  const jumpToPage = useCallback((target: number, behavior: ScrollBehavior = 'smooth', report = true) => {
    const normalized = Math.max(1, Math.min(Math.max(1, numPages), Math.floor(target)));
    visiblePageRef.current = normalized;
    setVisiblePage(normalized);
    if (report) {
      lastReportedPage.current = normalized;
      onPageRequest(normalized);
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const container = scrollRef.current;
      const element = pageRefs.current.get(normalized);
      if (!container || !element) return;
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const elementTop = container.scrollTop + elementRect.top - containerRect.top;
      const centeredTop = elementTop + elementRect.height / 2 - container.clientHeight / 2;
      container.scrollTo({ top: Math.max(0, centeredTop - mobileInsets.top / 2), behavior });
    }));
  }, [mobileInsets.top, numPages, onPageRequest]);

  useEffect(() => {
    if (!numPages || page === externalPage.current) return;
    externalPage.current = page;
    if (page === lastReportedPage.current || page === visiblePageRef.current) return;
    jumpToPage(page, 'auto', false);
  }, [jumpToPage, numPages, page]);

  useEffect(() => {
    if (!numPages) return;
    jumpToPage(page, 'auto', false);
  }, [numPages, pdfUrl]);

  useEffect(() => {
    const current = pageRefs.current.get(visiblePage);
    pdfContainerRef?.(current || null);
  }, [pdfContainerRef, visiblePage, renderedPages]);

  useLayoutEffect(() => {
    const anchor = pendingAnchor.current;
    const container = scrollRef.current;
    if (!anchor || !container) return;
    pendingAnchor.current = null;
    const pageElement = anchor.pageNumber === null ? null : pageRefs.current.get(anchor.pageNumber);
    if (pageElement) {
      const containerRect = container.getBoundingClientRect();
      const pageRect = pageElement.getBoundingClientRect();
      const pageLeft = container.scrollLeft + pageRect.left - containerRect.left;
      const pageTop = container.scrollTop + pageRect.top - containerRect.top;
      container.scrollLeft = Math.max(0, pageLeft + pageRect.width * anchor.pageXRatio - anchor.screenX);
      container.scrollTop = Math.max(0, pageTop + pageRect.height * anchor.pageYRatio - anchor.screenY);
    } else {
      container.scrollLeft = Math.max(0, (container.scrollLeft + anchor.screenX) * anchor.fallbackRatio - anchor.screenX);
      container.scrollTop = Math.max(0, (container.scrollTop + anchor.screenY) * anchor.fallbackRatio - anchor.screenY);
    }
  }, [zoomFactor]);

  const applyZoom = useCallback((value: number, anchor?: {
    x: number;
    y: number;
    pageNumber?: number | null;
    pageXRatio?: number;
    pageYRatio?: number;
  }) => {
    const container = scrollRef.current;
    const previous = zoomFactorRef.current;
    const next = clampMobilePdfZoom(value);
    if (Math.abs(next - previous) < 0.001) return;
    if (container) {
      const screenX = anchor?.x ?? container.clientWidth / 2;
      const screenY = anchor?.y ?? container.clientHeight / 2;
      const containerRect = container.getBoundingClientRect();
      const viewportX = containerRect.left + screenX;
      const viewportY = containerRect.top + screenY;
      let pageNumber: number | null = anchor?.pageNumber ?? null;
      let pageXRatio = anchor?.pageXRatio ?? 0.5;
      let pageYRatio = anchor?.pageYRatio ?? 0.5;
      if (anchor?.pageNumber === undefined) {
        for (const [candidatePage, element] of pageRefs.current) {
          const rect = element.getBoundingClientRect();
          if (viewportX < rect.left || viewportX > rect.right || viewportY < rect.top || viewportY > rect.bottom) continue;
          pageNumber = candidatePage;
          pageXRatio = rect.width > 0 ? (viewportX - rect.left) / rect.width : 0.5;
          pageYRatio = rect.height > 0 ? (viewportY - rect.top) / rect.height : 0.5;
          break;
        }
      }
      pendingAnchor.current = {
        screenX,
        screenY,
        pageNumber,
        pageXRatio,
        pageYRatio,
        fallbackRatio: next / previous,
      };
    }
    zoomFactorRef.current = next;
    setZoomFactor(next);
    writeZoom(textbookId, next);
  }, [textbookId]);

  const zoomIn = useCallback(() => applyZoom(zoomFactorRef.current + 0.1), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom(zoomFactorRef.current - 0.1), [applyZoom]);

  useEffect(() => {
    const controls: PDFViewerControls = {
      currentPage: visiblePage,
      numPages,
      zoomMode: Math.abs(zoomFactor - 1) < 0.001 ? 'fit-width' : 'manual',
      scale: zoomFactor,
      goToPage: target => jumpToPage(target),
      zoomIn,
      zoomOut,
      setZoomMode: mode => applyZoom(typeof mode === 'number' ? mode : mode === 'fit-page' ? 0.75 : 1),
    };
    onControlsChange?.(controls);
    return () => onControlsChange?.(null);
  }, [applyZoom, jumpToPage, numPages, onControlsChange, visiblePage, zoomFactor, zoomIn, zoomOut]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const stopMomentum = () => {
      if (momentumFrame.current !== null) window.cancelAnimationFrame(momentumFrame.current);
      momentumFrame.current = null;
    };

    const startPan = (point: GesturePoint) => {
      panRef.current = {
        x: point.clientX,
        y: point.clientY,
        time: performance.now(),
        velocityX: 0,
        velocityY: 0,
      };
    };

    const startMomentum = (pan: PanGesture) => {
      let velocityX = pan.velocityX;
      let velocityY = pan.velocityY;
      const tick = () => {
        if (Math.hypot(velocityX, velocityY) < 0.02) {
          momentumFrame.current = null;
          return;
        }
        container.scrollLeft += velocityX * 16;
        container.scrollTop += velocityY * 16;
        velocityX *= 0.93;
        velocityY *= 0.93;
        momentumFrame.current = window.requestAnimationFrame(tick);
      };
      momentumFrame.current = window.requestAnimationFrame(tick);
    };

    const beginPinch = () => {
      const points = [...activePointers.current.values()];
      if (points.length < 2) return;
      panRef.current = null;
      const first = points[0];
      const second = points[1];
      const point = midpoint(first, second);
      const rect = container.getBoundingClientRect();
      let pageNumber: number | null = null;
      let pageXRatio = 0.5;
      let pageYRatio = 0.5;
      for (const [candidatePage, element] of pageRefs.current) {
        const pageRect = element.getBoundingClientRect();
        if (point.x < pageRect.left || point.x > pageRect.right || point.y < pageRect.top || point.y > pageRect.bottom) continue;
        pageNumber = candidatePage;
        pageXRatio = pageRect.width > 0 ? (point.x - pageRect.left) / pageRect.width : 0.5;
        pageYRatio = pageRect.height > 0 ? (point.y - pageRect.top) / pageRect.height : 0.5;
        break;
      }
      pinchRef.current = {
        distance: Math.max(1, distance(first, second)),
        factor: zoomFactorRef.current,
        midpointX: point.x - rect.left,
        midpointY: point.y - rect.top,
        pageNumber,
        pageXRatio,
        pageYRatio,
      };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      event.preventDefault();
      stopMomentum();
      activePointers.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      container.setPointerCapture(event.pointerId);
      if (activePointers.current.size >= 2) beginPinch();
      else startPan({ clientX: event.clientX, clientY: event.clientY });
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !activePointers.current.has(event.pointerId)) return;
      event.preventDefault();
      activePointers.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      const gesture = pinchRef.current;
      const points = [...activePointers.current.values()];
      if (gesture && points.length >= 2) {
        const first = points[0];
        const second = points[1];
        const factor = clampMobilePdfZoom(gesture.factor * distance(first, second) / gesture.distance);
        const point = midpoint(first, second);
        const rect = container.getBoundingClientRect();
        nextZoom.current = factor;
        gesture.midpointX = point.x - rect.left;
        gesture.midpointY = point.y - rect.top;
        if (zoomFrame.current !== null) return;
        zoomFrame.current = window.requestAnimationFrame(() => {
          zoomFrame.current = null;
          if (nextZoom.current === null || !pinchRef.current) return;
          setPreviewZoom(nextZoom.current);
          setPreviewOrigin({
            x: container.scrollLeft + pinchRef.current.midpointX,
            y: container.scrollTop + pinchRef.current.midpointY,
          });
        });
        return;
      }
      const pan = panRef.current;
      if (!pan || points.length !== 1) return;
      const point = points[0];
      const now = performance.now();
      const elapsed = Math.max(8, now - pan.time);
      const deltaX = pan.x - point.clientX;
      const deltaY = pan.y - point.clientY;
      container.scrollLeft += deltaX;
      container.scrollTop += deltaY;
      pan.velocityX = pan.velocityX * 0.35 + deltaX / elapsed * 0.65;
      pan.velocityY = pan.velocityY * 0.35 + deltaY / elapsed * 0.65;
      pan.x = point.clientX;
      pan.y = point.clientY;
      pan.time = now;
    };
    const finishPinch = () => {
      if (!pinchRef.current || activePointers.current.size >= 2) return false;
      const gesture = pinchRef.current;
      if (zoomFrame.current !== null) {
        window.cancelAnimationFrame(zoomFrame.current);
        zoomFrame.current = null;
      }
      if (gesture && nextZoom.current !== null) {
        applyZoom(nextZoom.current, {
          x: gesture.midpointX,
          y: gesture.midpointY,
          pageNumber: gesture.pageNumber,
          pageXRatio: gesture.pageXRatio,
          pageYRatio: gesture.pageYRatio,
        });
      }
      setPreviewZoom(null);
      pinchRef.current = null;
      nextZoom.current = null;
      const remaining = [...activePointers.current.values()][0];
      if (remaining) startPan(remaining);
      return true;
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !activePointers.current.has(event.pointerId)) return;
      event.preventDefault();
      const cancelled = event.type === 'pointercancel';
      activePointers.current.delete(event.pointerId);
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
      if (finishPinch()) return;
      const pan = panRef.current;
      const remaining = [...activePointers.current.values()][0];
      if (remaining) {
        startPan(remaining);
        return;
      }
      panRef.current = null;
      if (pan && !cancelled) startMomentum(pan);
    };
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerEnd);
    container.addEventListener('pointercancel', onPointerEnd);
    return () => {
      stopMomentum();
      activePointers.current.clear();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerEnd);
      container.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [applyZoom]);

  useEffect(() => () => {
    if (reportTimer.current !== null) window.clearTimeout(reportTimer.current);
    if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current);
    if (zoomFrame.current !== null) window.cancelAnimationFrame(zoomFrame.current);
    pdfContainerRef?.(null);
  }, [pdfContainerRef]);

  const updatePageSize = useCallback((pageNumber: number, size: PageSize) => {
    setPageSizes(previous => {
      const existing = previous[pageNumber];
      if (existing && Math.abs(existing.width - size.width) < 0.1 && Math.abs(existing.height - size.height) < 0.1) return previous;
      return { ...previous, [pageNumber]: size };
    });
  }, []);

  const loadingText = loadingProgress === null ? '加载PDF中...' : `加载PDF中... ${loadingProgress}%`;

  return (
    <div className="relative h-full min-w-0 overflow-hidden bg-[var(--lm-canvas)]">
      <div
        ref={scrollRef}
        data-testid="pdf-scroll-container"
        data-mobile-continuous="true"
        data-zoom-percent={Math.round((previewZoom ?? zoomFactor) * 100)}
        className="h-full overflow-auto overscroll-contain"
        style={{
          touchAction: 'none',
          paddingTop: 12 + mobileInsets.top,
          paddingRight: 12 + mobileInsets.right,
          paddingBottom: 80 + mobileInsets.bottom,
          paddingLeft: 12 + mobileInsets.left,
        }}
        onScroll={onScroll}
      >
        <Document
          file={pdfUrl}
          options={LOADING_OPTIONS}
          onLoadSuccess={({ numPages: loadedPages }) => {
            setNumPages(loadedPages);
            setLoadingProgress(null);
            if (page > loadedPages) onPageRequest(loadedPages);
          }}
          onLoadProgress={({ loaded, total }) => setLoadingProgress(total ? Math.min(100, Math.round(loaded / total * 100)) : 0)}
          onLoadError={(error: Error) => setPdfError(error.message)}
          loading={<div className="p-8 text-sm text-slate-500">{loadingText}</div>}
          error={<div className="p-8 text-sm text-[var(--lm-danger)]"><p className="font-bold">PDF加载失败</p><p className="mt-1 text-xs opacity-70">{pdfError || '未知错误'}</p></div>}
        >
          <div ref={contentRef} className="mx-auto flex min-w-max flex-col items-center" style={{
            gap: PAGE_GAP,
            transform: previewZoom === null ? undefined : `scale(${previewZoom / zoomFactor})`,
            transformOrigin: `${previewOrigin.x}px ${previewOrigin.y}px`,
          }}>
            {Array.from({ length: numPages }, (_, index) => index + 1).map(pageNumber => {
              const size = pageSize(pageNumber);
              const width = renderedWidth;
              const height = width * size.height / size.width;
              const effectiveScale = width / size.width;
              const active = pageNumber === visiblePage;
              return (
                <div
                  key={pageNumber}
                  ref={element => {
                    if (element) pageRefs.current.set(pageNumber, element);
                    else pageRefs.current.delete(pageNumber);
                  }}
                  data-mobile-pdf-page={pageNumber}
                  className="relative shrink-0 bg-white shadow-md"
                  style={{ width, height }}
                >
                  {renderedPages.has(pageNumber) && (
                    <Page
                      pageNumber={pageNumber}
                      width={width}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      onLoadSuccess={loadedPage => {
                        const viewport = loadedPage.getViewport({ scale: 1 });
                        updatePageSize(pageNumber, { width: viewport.width, height: viewport.height });
                      }}
                    />
                  )}
                  {active && markers && onMarkerClick && (
                    <PageMarker markers={markers} currentPage={pageNumber} containerHeight={height} onMarkerClick={onMarkerClick} />
                  )}
                  {renderedPages.has(pageNumber) && (typeof pageOverlay === 'function' ? pageOverlay({ page: pageNumber, scale: effectiveScale }) : pageOverlay)}
                </div>
              );
            })}
          </div>
        </Document>
      </div>
    </div>
  );
}
