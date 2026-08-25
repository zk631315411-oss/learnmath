import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Focus, MessageCircle, PanelLeft, Scissors, Settings2, X } from 'lucide-react';
import { useFloatingReaderDock } from '../hooks/useFloatingReaderDock';
import { placeDockToolbar, type ReaderDockMode } from '../utils/floatingDock';
import type { PDFViewerControls } from './PDFViewer';

export type SheetStage = 'collapsed' | 'half' | 'full';

interface Props {
  boundaryRef: RefObject<HTMLElement>;
  stage: SheetStage;
  onStageChange: (stage: SheetStage) => void;
  unread?: boolean;
  pendingCount?: number;
  onOpenChat: () => void;
  onOpenUtility: () => void;
  onCapture: () => void;
  controls?: PDFViewerControls | null;
  interactionLocked?: boolean;
  children: React.ReactNode;
}

export default function BottomSheet({ boundaryRef, stage, onStageChange, unread, pendingCount = 0, onOpenChat, onOpenUtility, onCapture, controls, interactionLocked = false, children }: Props) {
  const activeSurfaceRef = useRef<HTMLDivElement | HTMLButtonElement | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolbarPoint, setToolbarPoint] = useState({ x: 0, y: 0 });
  const dock = useFloatingReaderDock(boundaryRef, stage, () => setToolsOpen(true));
  const currentPage = controls?.currentPage || 1;
  const numPages = controls?.numPages || 0;
  const zoomPercent = Math.round((controls?.scale || 1) * 100);
  const nextZoomMode = controls?.zoomMode === 'fit-width' ? 'fit-page' : 'fit-width';
  const zoomLabel = nextZoomMode === 'fit-page' ? '切换为整页显示' : '切换为适宽显示';

  useLayoutEffect(() => {
    if (!toolsOpen || !dock.bounds || !activeSurfaceRef.current) return;
    const rect = activeSurfaceRef.current.getBoundingClientRect();
    setToolbarPoint(placeDockToolbar(dock.position, dock.bounds, { width: rect.width, height: rect.height }));
  }, [dock.bounds, dock.position, toolsOpen]);

  useEffect(() => {
    if (!toolsOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!activeSurfaceRef.current?.contains(event.target as Node)) setToolsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setToolsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [toolsOpen]);

  return (
    <>
      {stage !== 'full' && dock.surfaceRect && <div
        data-testid="mobile-reader-tools"
        data-dock-mode={dock.position.mode}
        className="pointer-events-none fixed inset-0 z-[70]"
      >
        {toolsOpen ? (
          <div ref={activeSurfaceRef as RefObject<HTMLDivElement>} role="toolbar" aria-label="阅读工具"
            style={{ left: toolbarPoint.x, top: toolbarPoint.y }}
            className="pointer-events-auto absolute grid w-[11.5rem] max-w-full grid-cols-[2.25rem_1fr_2.25rem_2.25rem] items-center gap-1 rounded-2xl border border-slate-200/80 bg-white/[0.96] p-2 shadow-xl backdrop-blur-md min-[700px]:landscape:flex min-[700px]:landscape:w-auto min-[700px]:landscape:gap-0.5 min-[700px]:landscape:overflow-x-auto min-[700px]:landscape:rounded-full min-[700px]:landscape:p-1.5 min-[700px]:landscape:[scrollbar-width:none] dark:border-slate-700/80 dark:bg-slate-900/[0.96]">
            {/* 翻页是基础导航，不随 interactionLocked 禁用。 */}
            <button type="button" onClick={() => controls?.goToPage(Math.max(1, currentPage - 1))} disabled={!controls || currentPage <= 1} className="icon-button col-start-1 row-start-1 h-9 w-9 shrink-0 rounded-full min-[700px]:landscape:col-auto min-[700px]:landscape:row-auto" title="上一页" aria-label="上一页"><ChevronLeft className="h-4 w-4" /></button>
            <span className="col-start-2 row-start-1 min-w-11 whitespace-nowrap px-0.5 text-center text-xs font-semibold text-slate-700 min-[700px]:landscape:col-auto min-[700px]:landscape:row-auto dark:text-slate-100" title={`第 ${currentPage} 页，共 ${numPages || 0} 页`}>
              {currentPage}<span className="font-normal text-slate-400">/{numPages || '—'}</span>
            </span>
            <button type="button" onClick={() => controls?.goToPage(Math.min(numPages, currentPage + 1))} disabled={!controls || !numPages || currentPage >= numPages} className="icon-button col-start-3 row-start-1 h-9 w-9 shrink-0 rounded-full min-[700px]:landscape:col-auto min-[700px]:landscape:row-auto" title="下一页" aria-label="下一页"><ChevronRight className="h-4 w-4" /></button>

            <span aria-hidden="true" className="col-span-4 row-start-2 h-px w-full shrink-0 bg-slate-200 min-[700px]:landscape:col-auto min-[700px]:landscape:row-auto min-[700px]:landscape:mx-0.5 min-[700px]:landscape:h-6 min-[700px]:landscape:w-px dark:bg-slate-700" />

            <button type="button" onClick={() => controls?.setZoomMode(nextZoomMode)} disabled={!controls}
              className="col-start-1 row-start-3 flex h-9 w-9 shrink-0 items-center justify-center gap-1 rounded-full text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 min-[700px]:landscape:col-auto min-[700px]:landscape:row-auto min-[700px]:landscape:w-auto min-[700px]:landscape:px-1.5 dark:text-slate-200 dark:hover:bg-slate-800"
              title={zoomLabel} aria-label={`${zoomLabel}，当前 ${zoomPercent}%`}>
              <Focus className="h-4 w-4" /><span className="hidden min-[480px]:inline">{zoomPercent}%</span>
            </button>
            <button type="button" onClick={() => { setToolsOpen(false); onStageChange('half'); onOpenChat(); }} disabled={interactionLocked}
              className="icon-button relative col-start-2 row-start-3 h-9 w-9 shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-50 min-[700px]:landscape:col-auto min-[700px]:landscape:row-auto" title="AI 旁批" aria-label="AI 旁批">
              <MessageCircle className="h-4 w-4" />
              {unread && <span className="absolute right-1 top-1 h-2 w-2 rounded-full border border-white bg-rose-500 dark:border-slate-900" />}
              {pendingCount > 0 && <span className="absolute -right-0.5 -top-1 min-w-4 rounded-full bg-indigo-600 px-1 text-[10px] leading-4 text-white">{pendingCount}</span>}
            </button>
            <button type="button" onClick={() => { setToolsOpen(false); onCapture(); }} disabled={interactionLocked} className="icon-button col-start-3 row-start-3 h-9 w-9 shrink-0 rounded-full text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 min-[700px]:landscape:col-auto min-[700px]:landscape:row-auto dark:text-indigo-300 dark:hover:bg-indigo-950/50" title="框选页面内容" aria-label="框选"><Scissors className="h-4 w-4" /></button>
            <button type="button" onClick={() => { setToolsOpen(false); onOpenUtility(); }} disabled={interactionLocked} className="icon-button relative col-start-4 row-start-3 h-9 w-9 shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-50 min-[700px]:landscape:col-auto min-[700px]:landscape:row-auto" title="提问记录与学习地图" aria-label="提问记录与学习地图"><PanelLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => setToolsOpen(false)} className="icon-button col-start-4 row-start-1 h-9 w-9 shrink-0 rounded-full min-[700px]:landscape:col-auto min-[700px]:landscape:row-auto" title="收起阅读工具" aria-label="收起阅读工具"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <button ref={activeSurfaceRef as RefObject<HTMLButtonElement>} type="button"
            onClick={event => { if (event.detail === 0) setToolsOpen(true); }}
            onPointerDown={dock.onPointerDown}
            onPointerMove={dock.onPointerMove}
            onPointerUp={dock.onPointerUp}
            onPointerCancel={dock.onPointerCancel}
            style={{
              left: dock.surfaceRect.x,
              top: dock.surfaceRect.y,
              width: dock.surfaceRect.width,
              height: dock.surfaceRect.height,
              touchAction: 'none',
            }}
            className="pointer-events-auto absolute select-none border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            title="打开阅读工具" aria-label="打开阅读工具">
            <DockTriggerVisual mode={dock.position.mode} unread={unread} pendingCount={pendingCount} />
          </button>
        )}
      </div>}
      {stage !== 'collapsed' && <div data-testid="mobile-learning-sheet" className={`fixed inset-x-0 bottom-0 z-[80] flex flex-col bg-white shadow-lg dark:bg-slate-900 ${stage === 'half' ? 'h-[55vh] rounded-t-xl' : 'top-0 rounded-none'}`}>
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-slate-200/70 px-3 dark:border-slate-800/70">
          <button type="button" onClick={() => onStageChange('collapsed')} className="icon-button" title="收起" aria-label="收起"><ChevronDown className="h-4 w-4" /></button>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-100">{stage === 'half' ? '本页旁批' : '学习工具'}</span>
          <button type="button" onClick={() => onStageChange('collapsed')} className="icon-button" title="关闭" aria-label="关闭"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>}
    </>
  );
}

function DockTriggerVisual({ mode, unread, pendingCount }: { mode: ReaderDockMode; unread?: boolean; pendingCount: number }) {
  const edgeClasses: Record<ReaderDockMode, string> = {
    free: 'inset-0 h-12 w-12 rounded-full',
    left: 'left-0 top-0 h-14 w-6 rounded-r-xl border-l-0',
    right: 'right-0 top-0 h-14 w-6 rounded-l-xl border-r-0',
    top: 'left-0 top-0 h-6 w-14 rounded-b-xl border-t-0',
    bottom: 'bottom-0 left-0 h-6 w-14 rounded-t-xl border-b-0',
  };
  const badgeClasses: Record<ReaderDockMode, string> = {
    free: 'right-0 top-0',
    left: '-right-1 top-1',
    right: '-left-1 top-1',
    top: 'bottom-[-0.25rem] right-1',
    bottom: 'right-1 top-[-0.25rem]',
  };
  const icon = mode === 'left'
    ? <ChevronRight className="h-4 w-4" />
    : mode === 'right'
      ? <ChevronLeft className="h-4 w-4" />
      : mode === 'top'
        ? <ChevronDown className="h-4 w-4" />
        : mode === 'bottom'
          ? <ChevronUp className="h-4 w-4" />
          : <Settings2 className="h-5 w-5" />;

  return (
    <span className={`absolute flex items-center justify-center border border-slate-200/80 bg-white/[0.94] text-[var(--lm-brand)] shadow-xl backdrop-blur-md transition-colors hover:bg-white dark:border-slate-700/80 dark:bg-slate-900/[0.94] dark:hover:bg-slate-900 ${edgeClasses[mode]}`}>
      {icon}
      {pendingCount > 0 ? (
        <span data-testid="mobile-reader-tools-badge" className={`absolute min-w-4 rounded-full bg-indigo-600 px-1 text-[10px] leading-4 text-white ${badgeClasses[mode]}`}>{pendingCount}</span>
      ) : unread ? (
        <span data-testid="mobile-reader-tools-badge" className={`absolute h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-500 dark:border-slate-900 ${badgeClasses[mode]}`} />
      ) : null}
    </span>
  );
}
