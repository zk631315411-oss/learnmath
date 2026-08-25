import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Document, Page, pdfjs, type DocumentProps } from 'react-pdf';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Menu } from 'lucide-react';

import { loadJSON, saveJSON } from '../utils/storage';
import { STORAGE_KEYS } from '../utils/storageKeys';
import PageMarker, { type Marker } from './PageMarker';
import MobileContinuousPDFViewer from './MobileContinuousPDFViewer';
import type { TextbookId } from '../textbooks';

// v5 IIFE worker（esbuild 从 pdfjs-dist@5.4.296 构建），与 react-pdf 的 core 版本一致，兼容旧平板
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.js';

export interface PDFViewerProps {
  pdfUrl: string;
  textbookId: TextbookId;
  page: number;
  onPageRequest: (page: number) => void;
  mobile?: boolean;
  markers?: Marker[];
  pdfContainerRef?: React.RefCallback<HTMLDivElement>;
  onMarkerClick?: (marker: Marker) => void;
  hideToolbar?: boolean;
  onControlsChange?: (controls: PDFViewerControls | null) => void;
  pageOverlay?: React.ReactNode | ((ctx: { page: number; scale: number }) => React.ReactNode);
  mobileInsets?: { top: number; right: number; bottom: number; left: number };
}

const VIEWER_HORIZONTAL_PADDING = 32;
const VIEWER_VERTICAL_PADDING = 32;
const MOBILE_TOOLBAR_HEIGHT = 48;
const PDF_LOADING_OPTIONS: DocumentProps['options'] = {
  disableRange: false,
  disableStream: true,
  disableAutoFetch: true,
  rangeChunkSize: 512 * 1024,
};

type PdfLoadProgress = {
  loaded: number;
  total?: number;
};

export type ZoomMode = 'fit-page' | 'fit-width' | 'manual';
type LayoutClass = 'desktop' | 'mobile-portrait' | 'mobile-landscape';
type ZoomPreference = { mode: ZoomMode; scale?: number };

export type PDFViewerControls = {
  currentPage: number;
  numPages: number;
  zoomMode: ZoomMode;
  scale: number;
  goToPage: (page: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setZoomMode: (mode: ZoomMode | number) => void;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getLayoutClass(mobile: boolean): LayoutClass {
  if (!mobile || window.innerWidth >= 1024) return 'desktop';
  return window.innerHeight >= window.innerWidth ? 'mobile-portrait' : 'mobile-landscape';
}

function getDefaultZoomMode(layout: LayoutClass): ZoomMode {
  return layout === 'mobile-portrait' ? 'fit-width' : 'fit-page';
}

function getSavedZoomPreference(textbookId: string, layout: LayoutClass, fallback: ZoomMode): ZoomPreference {
  const data = loadJSON<Record<string, ZoomPreference>>(STORAGE_KEYS.pdfZoom, {});
  const saved = data[`${textbookId}:${layout}`];
  if (saved?.mode === 'fit-page' || saved?.mode === 'fit-width') return saved;
  if (saved?.mode === 'manual' && Number.isFinite(saved.scale)) return saved;
  return { mode: fallback };
}

function saveZoomPreference(textbookId: string, layout: LayoutClass, preference: ZoomPreference) {
  if (!textbookId) return;
  const data = loadJSON<Record<string, ZoomPreference>>(STORAGE_KEYS.pdfZoom, {});
  data[`${textbookId}:${layout}`] = preference;
  saveJSON(STORAGE_KEYS.pdfZoom, data);
}

function PDFViewerInner({ pdfUrl, textbookId, page, onPageRequest, mobile, markers, pdfContainerRef, onMarkerClick, hideToolbar = false, onControlsChange, pageOverlay }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const currentPage = page;
  const [pdfError, setPdfError] = useState<string>('');
  const [loadProgress, setLoadProgress] = useState<PdfLoadProgress | null>(null);
  const [layoutClass, setLayoutClass] = useState<LayoutClass>(() => getLayoutClass(Boolean(mobile)));
  const [zoomMode, setZoomMode] = useState<ZoomMode>(() => getDefaultZoomMode(getLayoutClass(Boolean(mobile))));
  const [scale, setScale] = useState<number>(0.5);
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number } | null>(null);
  const updateManualScale = useCallback((v: number | ((prev: number) => number)) => {
    setZoomMode('manual');
    setScale(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      saveZoomPreference(textbookId, layoutClass, { mode: 'manual', scale: next });
      return next;
    });
  }, [layoutClass, textbookId]);
  const selectZoomMode = useCallback((next: ZoomMode | number) => {
    if (typeof next === 'number') {
      updateManualScale(next);
      return;
    }
    setZoomMode(next);
    saveZoomPreference(textbookId, layoutClass, { mode: next });
  }, [layoutClass, textbookId, updateManualScale]);
  const [pageInput, setPageInput] = useState<string>('');
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const toolbarTimer = useRef<ReturnType<typeof setTimeout>>();
  const pageInputRef = useRef<HTMLInputElement>(null);
  const [editingPage, setEditingPage] = useState(false);
  const [mobilePageInput, setMobilePageInput] = useState('');
  const [pageContainerHeight, setPageContainerHeight] = useState(0);
  const [viewerContentWidth, setViewerContentWidth] = useState(0);
  const [viewerContentHeight, setViewerContentHeight] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const localContainerRef = useRef<HTMLDivElement | null>(null);
  const pageWidthForAlignment = pageDimensions ? pageDimensions.width * scale : 0;
  const alignPageToStart = Boolean(
    viewerContentWidth && pageWidthForAlignment > viewerContentWidth + 1
  );

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const updateWidth = () => {
      setViewerContentWidth(Math.max(0, el.clientWidth - VIEWER_HORIZONTAL_PADDING));
      setViewerContentHeight(Math.max(
        0,
        el.clientHeight - VIEWER_VERTICAL_PADDING - (mobile && !hideToolbar ? MOBILE_TOOLBAR_HEIGHT : 0),
      ));
      const nextLayout = getLayoutClass(Boolean(mobile));
      setLayoutClass(prev => prev === nextLayout ? prev : nextLayout);
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hideToolbar, mobile]);

  useEffect(() => {
    const preference = getSavedZoomPreference(textbookId, layoutClass, getDefaultZoomMode(layoutClass));
    setZoomMode(preference.mode);
    if (preference.mode === 'manual' && Number.isFinite(preference.scale)) setScale(preference.scale!);
  }, [layoutClass, textbookId]);

  // Automatically calculate the selected fit mode from the page's original dimensions.
  useEffect(() => {
    if (zoomMode === 'manual' || !pageDimensions) return;
    const availableWidth = viewerContentWidth;
    const availableHeight = viewerContentHeight;
    if (availableWidth <= 0 || availableHeight <= 0) return;

    const next = zoomMode === 'fit-width'
      ? availableWidth / pageDimensions.width
      : Math.min(availableWidth / pageDimensions.width, availableHeight / pageDimensions.height);
    setScale(Math.max(0.02, Math.min(3, next)));
  }, [pageDimensions, viewerContentWidth, viewerContentHeight, zoomMode]);

  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, left: 0 });
  }, [currentPage, textbookId, zoomMode]);

  // Observe container height and forward to PageMarker
  useEffect(() => {
    const el = localContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPageContainerHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Merge incoming ref with local ref for container height tracking
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    localContainerRef.current = node;
    pdfContainerRef?.(node);
  }, [pdfContainerRef]);

  const resetToolbarTimer = useCallback(() => {
    if (!mobile) return;
    setToolbarVisible(true);
    clearTimeout(toolbarTimer.current);
    toolbarTimer.current = setTimeout(() => setToolbarVisible(false), 30000);
  }, [mobile]);

  useEffect(() => {
    if (mobile) {
      resetToolbarTimer();
      return () => clearTimeout(toolbarTimer.current);
    }
  }, [mobile, resetToolbarTimer]);

  useEffect(() => {
    setPdfError('');
    setLoadProgress(null);
    setNumPages(0);
    setPageDimensions(null);
  }, [pdfUrl]);

  const commitPageJump = () => {
    const page = parseInt(mobilePageInput, 10);
    if (!isNaN(page) && page >= 1 && page <= numPages) {
      handlePageChange(page);
    }
    setEditingPage(false);
    setMobilePageInput('');
  };

  // Page changes are requested from App/usePdfPosition.
  const handlePageChange = useCallback((page: number) => {
    onPageRequest(page);
  }, [onPageRequest]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        handlePageChange(Math.max(1, currentPage - 1));
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        handlePageChange(Math.min(numPages || currentPage, currentPage + 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentPage, numPages, handlePageChange]);

  const zoomIn = useCallback(() => {
    updateManualScale(s => Math.min(3, s + (mobile ? 0.1 : 0.25)));
  }, [mobile, updateManualScale]);

  const zoomOut = useCallback(() => {
    updateManualScale(s => Math.max(0.25, s - (mobile ? 0.1 : 0.25)));
  }, [mobile, updateManualScale]);

  useEffect(() => {
    onControlsChange?.({
      currentPage,
      numPages,
      zoomMode,
      scale,
      goToPage: handlePageChange,
      zoomIn,
      zoomOut,
      setZoomMode: selectZoomMode,
    });
    return () => onControlsChange?.(null);
  }, [currentPage, numPages, zoomMode, scale, handlePageChange, onControlsChange, selectZoomMode, zoomIn, zoomOut]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setLoadProgress(null);
    // 如果 saved page > 总页数， clamp 一下
    if (currentPage > numPages) onPageRequest(numPages);
  };

  const loadingMessage = loadProgress?.total
    ? `加载PDF中... ${Math.min(100, Math.round((loadProgress.loaded / loadProgress.total) * 100))}%`
    : loadProgress?.loaded
      ? `加载PDF中... 已读取 ${formatBytes(loadProgress.loaded)}`
      : '加载PDF中...';

  const handlePageInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const page = parseInt(pageInput, 10);
      if (!isNaN(page) && page >= 1 && page <= numPages) {
        handlePageChange(page);
      }
      setPageInput('');
    }
  };

  return (
    <div className="flex h-full">
      {/* 页面导航 — 移动端隐藏 */}
      {!mobile && !hideToolbar && (
      <div className="w-16 bg-slate-100 border-r border-slate-200 flex flex-col items-center py-2 shrink-0">
        {/* 页码显示和跳转 */}
        <div className="text-xs text-slate-500 mb-1">{currentPage}/{numPages}</div>
        <input
          type="text"
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onKeyDown={handlePageInput}
          placeholder="跳转"
          className="w-12 h-6 text-xs text-center border rounded mb-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />

        <button
          onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="w-10 h-10 rounded-full bg-white shadow-sm border border-slate-200 flex items-center justify-center disabled:opacity-30 hover:bg-slate-50 transition-colors"
        >
          <ChevronUp className="w-5 h-5" />
        </button>
        <button
          onClick={() => handlePageChange(Math.min(numPages, currentPage + 1))}
          disabled={currentPage >= numPages}
          className="w-10 h-10 rounded-full bg-white shadow-sm border border-slate-200 flex items-center justify-center disabled:opacity-30 hover:bg-slate-50 transition-colors"
        >
          <ChevronDown className="w-5 h-5" />
        </button>

        {/* 缩放控制 */}
        <div className="mt-4 flex flex-col items-center gap-1">
          <button
            data-testid="pdf-desktop-zoom-in"
            onClick={() => updateManualScale(s => Math.min(3, s + 0.25))}
            className="w-10 h-8 rounded bg-white shadow-sm border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors"
            title="放大"
          >
            <span className="text-lg font-bold">+</span>
          </button>
          <select
            data-testid="pdf-desktop-zoom"
            value={zoomMode === 'manual' ? String(scale) : zoomMode}
            onChange={(e) => {
              const value = e.target.value;
              selectZoomMode(value === 'fit-page' || value === 'fit-width' ? value : parseFloat(value));
            }}
            className="w-[76px] h-7 text-xs border border-slate-200 rounded text-center bg-white"
          >
            <option value="fit-width">清晰阅读</option>
            <option value="fit-page">查看全页</option>
            {zoomMode === 'manual' && (
              <option value={String(scale)}>{Math.round(scale * 100)}%</option>
            )}
          </select>
          <button
            data-testid="pdf-desktop-zoom-out"
            onClick={() => updateManualScale(s => Math.max(0.25, s - 0.25))}
            className="w-10 h-8 rounded bg-white shadow-sm border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors"
            title="缩小"
          >
            <span className="text-lg font-bold">−</span>
          </button>
        </div>
      </div>
      )}

      {/* PDF视口：滚动内容与悬浮工具栏分层，避免工具栏随页面滚动。 */}
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div ref={scrollContainerRef} data-testid="pdf-scroll-container"
          data-zoom-mode={zoomMode}
          className={`h-full overflow-auto bg-[var(--lm-canvas)] p-4 ${mobile && !hideToolbar ? 'pb-16' : ''}`}
          onClick={mobile ? resetToolbarTimer : undefined}>
          <div className={`flex ${alignPageToStart ? 'justify-start' : 'justify-center'}`}>
            <div className="relative inline-block" ref={setContainerRef}>
              <Document
                file={pdfUrl}
                options={PDF_LOADING_OPTIONS}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadProgress={({ loaded, total }) => setLoadProgress({ loaded, total })}
                loading={<div className="p-8 text-sm text-slate-500">{loadingMessage}</div>}
                onLoadError={(error: Error) => setPdfError(error.message)}
                error={<div className="p-8 text-sm text-[var(--lm-danger)]"><p className="mb-1 font-bold">PDF加载失败</p><p className="text-xs opacity-70">{pdfError || '未知错误'}</p></div>}
              >
                <Page
                  pageNumber={currentPage}
                  scale={scale}
                  onLoadSuccess={loadedPage => {
                    const viewport = loadedPage.getViewport({ scale: 1 });
                    setPageDimensions({ width: viewport.width, height: viewport.height });
                  }}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  className="shadow-lg"
                />
              </Document>
              {markers && onMarkerClick && currentPage && pdfContainerRef && (
                <PageMarker
                  markers={markers}
                  currentPage={currentPage}
                  containerHeight={pageContainerHeight}
                  onMarkerClick={onMarkerClick}
                />
              )}
              {typeof pageOverlay === 'function' ? pageOverlay({ page: currentPage, scale }) : pageOverlay}
            </div>
          </div>
        </div>

        {/* 移动端底部工具栏 */}
        {mobile && !hideToolbar && numPages > 0 && (
          <>
            <div data-testid="pdf-mobile-toolbar"
              className={`absolute bottom-0 left-0 right-0 z-20 transition-all duration-500 ${toolbarVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
              <div className="h-12 bg-black/50 backdrop-blur flex items-center justify-between px-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handlePageChange(Math.max(1, currentPage - 1)); resetToolbarTimer(); }}
                  disabled={currentPage <= 1}
                  className="w-12 h-12 flex items-center justify-center text-white disabled:opacity-30 active:bg-white/20 rounded-lg transition-colors"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>

                <div className="flex items-center gap-1">
                  {editingPage ? (
                    <input
                      ref={pageInputRef}
                      type="number"
                      min={1}
                      max={numPages}
                      value={mobilePageInput}
                      onChange={(e) => setMobilePageInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitPageJump(); }}
                      onBlur={commitPageJump}
                      onClick={(e) => e.stopPropagation()}
                      className="w-16 h-8 text-sm text-center rounded bg-white/20 text-white border border-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingPage(true);
                        setMobilePageInput(String(currentPage));
                        resetToolbarTimer();
                        setTimeout(() => pageInputRef.current?.focus(), 50);
                      }}
                      className="text-white text-sm font-medium px-3 py-1 rounded active:bg-white/20 transition-colors"
                    >
                      {currentPage} / {numPages}
                    </button>
                  )}
                </div>

                <button
                  onClick={(e) => { e.stopPropagation(); handlePageChange(Math.min(numPages, currentPage + 1)); resetToolbarTimer(); }}
                  disabled={currentPage >= numPages}
                  className="w-12 h-12 flex items-center justify-center text-white disabled:opacity-30 active:bg-white/20 rounded-lg transition-colors"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>

                <div className="flex items-center gap-0.5">
                  <button
                    data-testid="pdf-mobile-zoom-out"
                    onClick={(e) => { e.stopPropagation(); updateManualScale(s => Math.max(0.25, s - 0.1)); resetToolbarTimer(); }}
                    className="w-10 h-8 flex items-center justify-center text-white active:bg-white/20 rounded transition-colors"
                  >
                    <span className="text-base font-bold">−</span>
                  </button>
                  <select
                    data-testid="pdf-mobile-zoom"
                    value={zoomMode === 'manual' ? String(scale) : zoomMode}
                    onChange={(e) => {
                      const value = e.target.value;
                      selectZoomMode(value === 'fit-page' || value === 'fit-width' ? value : parseFloat(value));
                      resetToolbarTimer();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-7 text-xs bg-white/15 text-white border border-white/20 rounded px-1 focus:outline-none"
                  >
                    <option value="fit-width">清晰阅读</option>
                    <option value="fit-page">查看全页</option>
                    {zoomMode === 'manual' && (
                      <option value={String(scale)} className="text-black">{Math.round(scale * 100)}%</option>
                    )}
                  </select>
                  <button
                    data-testid="pdf-mobile-zoom-in"
                    onClick={(e) => { e.stopPropagation(); updateManualScale(s => Math.min(3, s + 0.1)); resetToolbarTimer(); }}
                    className="w-10 h-8 flex items-center justify-center text-white active:bg-white/20 rounded transition-colors"
                  >
                    <span className="text-base font-bold">+</span>
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); setToolbarVisible(v => !v); resetToolbarTimer(); }}
              className="absolute bottom-2 right-2 z-30 w-8 h-8 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-white/70 active:bg-black/60 transition-colors"
            >
              <Menu className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const SinglePagePDFViewer = memo(PDFViewerInner);

export default function PDFViewer(props: PDFViewerProps) {
  if (props.mobile) return <MobileContinuousPDFViewer {...props} />;
  return <SinglePagePDFViewer {...props} />;
}
