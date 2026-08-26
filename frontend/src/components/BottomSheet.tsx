import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Focus, MessageCircle, Minus, PanelLeft, Plus, Scissors, Settings2, X } from 'lucide-react';

import { useFloatingReaderDock } from '../hooks/useFloatingReaderDock';
import { placeDockToolbar, type ReaderDockMode } from '../utils/floatingDock';
import type { PDFViewerControls } from './PDFViewer';

export type SheetStage = 'collapsed' | 'half' | 'full';
export type ReaderDockInsets = { top: number; right: number; bottom: number; left: number };

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
  onDockInsetsChange?: (insets: ReaderDockInsets) => void;
  children: React.ReactNode;
}

type ToolId = 'zoom' | 'chat' | 'capture' | 'utility' | 'open';

const ZERO_INSETS: ReaderDockInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const EDGE_SIZE = 44;

function insetsFor(mode: ReaderDockMode, stage: SheetStage): ReaderDockInsets {
  if (stage === 'full' || mode === 'free') return ZERO_INSETS;
  return {
    top: mode === 'top' ? EDGE_SIZE : 0,
    right: mode === 'right' ? EDGE_SIZE : 0,
    bottom: mode === 'bottom' ? EDGE_SIZE : 0,
    left: mode === 'left' ? EDGE_SIZE : 0,
  };
}

export default function BottomSheet({
  boundaryRef,
  stage,
  onStageChange,
  unread,
  pendingCount = 0,
  onOpenChat,
  onOpenUtility,
  onCapture,
  controls,
  interactionLocked = false,
  onDockInsetsChange,
  children,
}: Props) {
  const dockSurfaceRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const pendingActionRef = useRef<ToolId>('open');
  const previousModeRef = useRef<ReaderDockMode>('right');
  const [popup, setPopup] = useState<'tools' | 'zoom' | null>(null);
  const [popupPoint, setPopupPoint] = useState({ x: 0, y: 0 });
  const [ballTool, setBallTool] = useState<ToolId>('open');
  const [pageDraft, setPageDraft] = useState('');
  const [editingPage, setEditingPage] = useState(false);

  const runActionRef = useRef<(tool: ToolId) => void>(() => undefined);
  const dock = useFloatingReaderDock(boundaryRef, stage, () => runActionRef.current(pendingActionRef.current));
  const currentPage = controls?.currentPage || 1;
  const numPages = controls?.numPages || 0;
  const zoomPercent = Math.round((controls?.scale || 1) * 100);
  const mode = dock.position.mode;

  const runAction = useCallback((tool: ToolId) => {
    if (tool === 'open') {
      setPopup(value => value === 'tools' ? null : 'tools');
      return;
    }
    if (tool === 'zoom') {
      setPopup(value => value === 'zoom' ? null : 'zoom');
      return;
    }
    setPopup(null);
    if (interactionLocked) return;
    if (tool === 'chat') {
      onStageChange('half');
      onOpenChat();
    } else if (tool === 'capture') {
      onCapture();
    } else {
      onOpenUtility();
    }
  }, [interactionLocked, onCapture, onOpenChat, onOpenUtility, onStageChange]);
  runActionRef.current = runAction;

  useEffect(() => {
    onDockInsetsChange?.(insetsFor(mode, stage));
    return () => onDockInsetsChange?.(ZERO_INSETS);
  }, [mode, onDockInsetsChange, stage]);

  useEffect(() => {
    const previous = previousModeRef.current;
    if (previous !== 'free' && mode === 'free') {
      setBallTool(pendingActionRef.current === 'open' ? 'zoom' : pendingActionRef.current);
      setPopup(null);
    }
    previousModeRef.current = mode;
  }, [mode]);

  useLayoutEffect(() => {
    if (!popup || !dock.bounds || !popupRef.current) return;
    const rect = popupRef.current.getBoundingClientRect();
    setPopupPoint(placeDockToolbar(dock.position, dock.bounds, { width: rect.width, height: rect.height }));
  }, [dock.bounds, dock.position, popup]);

  useEffect(() => {
    if (!popup) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popupRef.current?.contains(target) && !dockSurfaceRef.current?.contains(target)) setPopup(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopup(null);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [popup]);

  const onDockPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-reader-action]')?.dataset.readerAction as ToolId | undefined;
    pendingActionRef.current = action || 'open';
    dock.onPointerDown(event);
  };

  const keyboardAction = (event: React.MouseEvent<HTMLButtonElement>, tool: ToolId) => {
    if (event.detail === 0) runAction(tool);
    event.preventDefault();
  };

  const commitPage = () => {
    const value = Number.parseInt(pageDraft, 10);
    if (Number.isFinite(value) && value >= 1 && value <= numPages) controls?.goToPage(value);
    setEditingPage(false);
    setPageDraft('');
  };

  const toolButtons = (draggable: boolean) => (
    <>
      <ToolButton tool="zoom" label={`缩放，当前 ${zoomPercent}%`} disabled={!controls} draggable={draggable} mode={mode} onClick={keyboardAction}>
        <Focus className="h-5 w-5" />
      </ToolButton>
      <ToolButton tool="chat" label="AI 旁批" disabled={interactionLocked} draggable={draggable} mode={mode} onClick={keyboardAction} badge={pendingCount} unread={unread}>
        <MessageCircle className="h-5 w-5" />
      </ToolButton>
      <ToolButton tool="capture" label="框选" disabled={interactionLocked} draggable={draggable} mode={mode} onClick={keyboardAction} accent>
        <Scissors className="h-5 w-5" />
      </ToolButton>
      <ToolButton tool="utility" label="提问记录" disabled={interactionLocked} draggable={draggable} mode={mode} onClick={keyboardAction}>
        <PanelLeft className="h-5 w-5" />
      </ToolButton>
    </>
  );

  const sideRail = mode === 'left' || mode === 'right';
  const ballIcon = ballTool === 'zoom'
    ? <Focus className="h-5 w-5" />
    : ballTool === 'chat'
      ? <MessageCircle className="h-5 w-5" />
      : ballTool === 'capture'
        ? <Scissors className="h-5 w-5" />
        : ballTool === 'utility'
          ? <PanelLeft className="h-5 w-5" />
          : <Settings2 className="h-5 w-5" />;

  const pagerStyle = dock.bounds ? {
    left: dock.bounds.left + 12 + (mode === 'left' ? EDGE_SIZE : 0),
    bottom: window.innerHeight - dock.bounds.bottom + 12 + (mode === 'bottom' ? EDGE_SIZE : 0),
  } : undefined;

  return (
    <>
      {stage !== 'full' && dock.surfaceRect && (
        <div
          ref={dockSurfaceRef}
          data-testid="mobile-reader-tools"
          data-dock-mode={mode}
          role={mode === 'free' ? undefined : 'toolbar'}
          aria-label={mode === 'free' ? undefined : '阅读工具'}
          style={{
            left: dock.surfaceRect.x,
            top: dock.surfaceRect.y,
            width: dock.surfaceRect.width,
            height: dock.surfaceRect.height,
            touchAction: 'none',
          }}
          className={`fixed z-[70] select-none ${mode === 'free'
            ? 'rounded-full border border-slate-200/80 bg-white/[0.96] text-[var(--lm-brand)] shadow-xl backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/[0.96]'
            : `flex items-center justify-center border border-slate-200/80 bg-white/[0.96] shadow-xl backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/[0.96] ${sideRail ? 'flex-col py-1.5' : 'flex-row px-1.5'} ${mode === 'left' ? 'rounded-r-xl border-l-0' : mode === 'right' ? 'rounded-l-xl border-r-0' : mode === 'top' ? 'rounded-b-xl border-t-0' : 'rounded-t-xl border-b-0'}`
          }`}
          onPointerDown={onDockPointerDown}
          onPointerMove={dock.onPointerMove}
          onPointerUp={dock.onPointerUp}
          onPointerCancel={dock.onPointerCancel}
        >
          {mode === 'free' ? (
            <button data-reader-action="open" type="button" onClick={event => keyboardAction(event, 'open')} className="relative flex h-full w-full items-center justify-center rounded-full" title="打开阅读工具" aria-label="打开阅读工具">
              {ballIcon}
              {pendingCount > 0 ? <Badge mode="free" count={pendingCount} /> : unread ? <UnreadDot mode="free" /> : null}
            </button>
          ) : toolButtons(true)}
        </div>
      )}

      {stage !== 'full' && popup && dock.bounds && (
        <div
          ref={popupRef}
          role="toolbar"
          aria-label={popup === 'zoom' ? '缩放工具' : '浮动阅读工具'}
          style={{ left: popupPoint.x, top: popupPoint.y }}
          className="fixed z-[72] flex h-12 items-center gap-0.5 rounded-full border border-slate-200/80 bg-white/[0.97] px-1.5 shadow-xl backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/[0.97]"
        >
          {popup === 'tools' ? (
            <>{toolButtons(false)}<button type="button" onClick={() => setPopup(null)} className="icon-button h-10 w-10 rounded-full" title="收起" aria-label="收起阅读工具"><X className="h-4 w-4" /></button></>
          ) : (
            <>
              <button type="button" onClick={() => controls?.zoomOut()} disabled={!controls || zoomPercent <= 75} className="icon-button h-10 w-10 rounded-full" title="缩小" aria-label="缩小"><Minus className="h-4 w-4" /></button>
              <button type="button" onClick={() => controls?.setZoomMode('fit-width')} className="h-10 min-w-14 rounded-full px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800" title="恢复适宽" aria-label={`恢复适宽，当前 ${zoomPercent}%`}>{zoomPercent}%</button>
              <button type="button" onClick={() => controls?.zoomIn()} disabled={!controls || zoomPercent >= 300} className="icon-button h-10 w-10 rounded-full" title="放大" aria-label="放大"><Plus className="h-4 w-4" /></button>
              <button type="button" onClick={() => setPopup(null)} className="icon-button h-10 w-10 rounded-full" title="关闭缩放工具" aria-label="关闭缩放工具"><X className="h-4 w-4" /></button>
            </>
          )}
        </div>
      )}

      {stage !== 'full' && controls && numPages > 0 && dock.bounds && (
        <div data-testid="mobile-page-pager" style={pagerStyle} className="fixed z-[65] flex h-11 items-center rounded-full border border-slate-200/80 bg-white/[0.96] px-1.5 shadow-lg backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/[0.96]">
          <button type="button" onClick={() => controls.goToPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} className="icon-button h-9 w-9 rounded-full" title="上一页" aria-label="上一页"><ChevronLeft className="h-4 w-4" /></button>
          {editingPage ? (
            <input autoFocus type="number" min={1} max={numPages} value={pageDraft} onChange={event => setPageDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') commitPage(); if (event.key === 'Escape') setEditingPage(false); }} onBlur={commitPage} aria-label="跳转页码" className="h-8 w-14 rounded-lg border border-slate-200 bg-white text-center text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          ) : (
            <button type="button" onClick={() => { setPageDraft(String(currentPage)); setEditingPage(true); }} className="h-9 min-w-14 rounded-full px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800" title={`第 ${currentPage} 页，共 ${numPages} 页`} aria-label={`当前第 ${currentPage} 页，共 ${numPages} 页`}>{currentPage}<span className="font-normal text-slate-400">/{numPages}</span></button>
          )}
          <button type="button" onClick={() => controls.goToPage(Math.min(numPages, currentPage + 1))} disabled={currentPage >= numPages} className="icon-button h-9 w-9 rounded-full" title="下一页" aria-label="下一页"><ChevronRight className="h-4 w-4" /></button>
        </div>
      )}

      {stage !== 'collapsed' && (
        <div data-testid="mobile-learning-sheet" className={`fixed inset-x-0 bottom-0 z-[80] flex flex-col bg-white shadow-lg dark:bg-slate-900 ${stage === 'half' ? 'h-[55vh] rounded-t-xl' : 'top-0 rounded-none'}`}>
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-slate-200/70 px-3 dark:border-slate-800/70">
            <button type="button" onClick={() => onStageChange('collapsed')} className="icon-button" title="收起" aria-label="收起"><ChevronDown className="h-4 w-4" /></button>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-100">{stage === 'half' ? '本页旁批' : '提问记录'}</span>
            <button type="button" onClick={() => onStageChange('collapsed')} className="icon-button" title="关闭" aria-label="关闭"><X className="h-4 w-4" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
      )}
    </>
  );
}

function ToolButton({ tool, label, disabled, draggable: _draggable, mode, onClick, badge = 0, unread, accent, children }: {
  tool: Exclude<ToolId, 'open'>;
  label: string;
  disabled?: boolean;
  draggable: boolean;
  mode: ReaderDockMode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>, tool: ToolId) => void;
  badge?: number;
  unread?: boolean;
  accent?: boolean;
  children: React.ReactNode;
}) {
  const badgePosition = mode === 'right' ? 'left-0 top-0' : mode === 'top' ? 'bottom-0 right-0' : 'right-0 top-0';
  return (
    <button data-reader-action={tool} type="button" disabled={disabled} onClick={event => onClick(event, tool)} className={`icon-button relative h-11 w-11 shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-40 ${accent ? 'text-indigo-600 dark:text-indigo-300' : ''}`} title={label} aria-label={label}>
      {children}
      {badge > 0 ? <span data-testid="mobile-reader-tools-badge" className={`absolute min-w-4 rounded-full bg-indigo-600 px-1 text-[10px] leading-4 text-white ${badgePosition}`}>{badge}</span> : unread ? <span data-testid="mobile-reader-tools-badge" className={`absolute h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-500 dark:border-slate-900 ${badgePosition}`} /> : null}
    </button>
  );
}

function Badge({ mode, count }: { mode: ReaderDockMode; count: number }) {
  return <span data-testid="mobile-reader-tools-badge" data-mode={mode} className="absolute right-0 top-0 min-w-4 rounded-full bg-indigo-600 px-1 text-[10px] leading-4 text-white">{count}</span>;
}

function UnreadDot({ mode }: { mode: ReaderDockMode }) {
  return <span data-testid="mobile-reader-tools-badge" data-mode={mode} className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-500 dark:border-slate-900" />;
}
