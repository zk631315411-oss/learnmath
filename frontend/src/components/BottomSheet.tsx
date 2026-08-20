import { useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, MessageCircle, PanelLeft, ScanLine, Scissors, X } from 'lucide-react';
import type { PDFViewerControls } from './PDFViewer';
import type { CaptureMode } from './PDFToolbar';

export type SheetStage = 'collapsed' | 'half' | 'full';

interface Props {
  stage: SheetStage;
  onStageChange: (stage: SheetStage) => void;
  unread?: boolean;
  pendingCount?: number;
  onOpenChat: () => void;
  onOpenUtility: () => void;
  onCapture: (mode: CaptureMode) => void;
  controls?: PDFViewerControls | null;
  interactionLocked?: boolean;
  children: React.ReactNode;
}

const nextStage = (stage: SheetStage, direction: 'up' | 'down'): SheetStage => {
  if (direction === 'up') return stage === 'collapsed' ? 'half' : 'full';
  return stage === 'full' ? 'half' : 'collapsed';
};

export default function BottomSheet({ stage, onStageChange, unread, pendingCount = 0, onOpenChat, onOpenUtility, onCapture, controls, interactionLocked = false, children }: Props) {
  const dragStart = useRef<number | null>(null);
  const [captureMenuOpen, setCaptureMenuOpen] = useState(false);
  const currentPage = controls?.currentPage || 1;
  const numPages = controls?.numPages || 0;

  return (
    <>
      <div
        data-testid="bottom-sheet-handle"
        className="flex h-11 shrink-0 touch-none items-center border-t border-slate-200 bg-white px-1 dark:border-slate-800 dark:bg-slate-900"
        onPointerDown={event => {
          if ((event.target as HTMLElement).closest('button')) return;
          dragStart.current = event.clientY;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={event => {
          if (dragStart.current == null) return;
          const delta = event.clientY - dragStart.current;
          dragStart.current = null;
          if (Math.abs(delta) >= 36) onStageChange(nextStage(stage, delta < 0 ? 'up' : 'down'));
        }}
        onPointerCancel={() => { dragStart.current = null; }}
      >
        <button type="button" onClick={() => controls?.goToPage(Math.max(1, currentPage - 1))} disabled={interactionLocked || !controls || currentPage <= 1} className="icon-button shrink-0" title="上一页" aria-label="上一页"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" onClick={() => onStageChange(stage === 'collapsed' ? 'half' : 'collapsed')} disabled={interactionLocked} className="h-9 min-w-12 rounded-lg px-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800" title="展开本页旁批">{currentPage}<span className="font-normal text-slate-400">/{numPages || '—'}</span></button>
        <button type="button" onClick={() => controls?.goToPage(Math.min(numPages, currentPage + 1))} disabled={interactionLocked || !controls || !numPages || currentPage >= numPages} className="icon-button shrink-0" title="下一页" aria-label="下一页"><ChevronRight className="h-4 w-4" /></button>
        <button type="button" onClick={() => { onStageChange('half'); onOpenChat(); }} disabled={interactionLocked} className="relative flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-1 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"><MessageCircle className="h-4 w-4 shrink-0" /><span className="truncate">AI 旁批</span>{unread && <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" />}{pendingCount > 0 && <span className="min-w-4 rounded-full bg-indigo-600 px-1 text-[10px] text-white">{pendingCount}</span>}</button>
        <div className="relative shrink-0"><button type="button" onClick={() => setCaptureMenuOpen(open => !open)} disabled={interactionLocked} className="icon-button text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-950/50" title="框选操作" aria-label="框选提问" aria-expanded={captureMenuOpen}><Scissors className="h-4 w-4" /></button>
          {captureMenuOpen && <div className="capture-action-menu capture-action-menu-mobile" role="menu"><button type="button" role="menuitem" onClick={() => { setCaptureMenuOpen(false); onCapture('qa'); }}><Scissors size={15} />框选提问</button><button type="button" role="menuitem" onClick={() => { setCaptureMenuOpen(false); onCapture('formula'); }}><ScanLine size={15} />识别公式</button></div>}
        </div>
        <button type="button" onClick={onOpenUtility} disabled={interactionLocked} className="icon-button relative shrink-0 disabled:cursor-not-allowed disabled:opacity-50" title="提问记录与学习地图" aria-label="提问记录与学习地图"><PanelLeft className="h-4 w-4" /></button>
      </div>
      {stage !== 'collapsed' && <div className={`fixed inset-x-0 bottom-11 z-[80] flex flex-col bg-white shadow-2xl dark:bg-slate-900 ${stage === 'half' ? 'h-[55vh] rounded-t-2xl' : 'top-0 rounded-none'}`}>
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200 px-3 dark:border-slate-800">
          <button type="button" onClick={() => onStageChange('collapsed')} className="icon-button" title="收起" aria-label="收起"><ChevronDown className="h-4 w-4" /></button>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-100">{stage === 'half' ? '本页旁批' : '学习工具'}</span>
          <button type="button" onClick={() => onStageChange('collapsed')} className="icon-button" title="关闭" aria-label="关闭"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>}
    </>
  );
}
