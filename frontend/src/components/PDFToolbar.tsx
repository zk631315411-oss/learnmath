import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ListTree, PanelLeft, PanelRightClose, PanelRightOpen, Scissors, ZoomIn, ZoomOut } from 'lucide-react';

import type { PDFViewerControls, ZoomMode } from './PDFViewer';

interface Props {
  controls: PDFViewerControls | null;
  onOpenDrawer: () => void;
  onCapture: () => void;
  captureDisabled?: boolean;
  chatCollapsed?: boolean;
  onToggleChat?: () => void;
  onOpenToc?: () => void;
  tocOpen?: boolean;
  tocPanel?: ReactNode;
  mobile?: boolean;
}

export default function PDFToolbar({ controls, onOpenDrawer, onCapture, captureDisabled = false, chatCollapsed = false, onToggleChat, onOpenToc, tocOpen = false, tocPanel, mobile = false }: Props) {
  const currentPage = controls?.currentPage ?? 1;
  const numPages = controls?.numPages ?? 0;
  const zoomMode = controls?.zoomMode ?? 'fit-page';
  const scale = controls?.scale ?? 1;
  const [pageDraft, setPageDraft] = useState('');

  useEffect(() => {
    setPageDraft(numPages ? String(currentPage) : '');
  }, [currentPage, numPages]);

  const commitPage = () => {
    if (!controls) return;
    const value = pageDraft;
    const page = Number.parseInt(value, 10);
    if (Number.isFinite(page) && page >= 1 && page <= controls.numPages) {
      controls.goToPage(page);
    } else {
      setPageDraft(String(currentPage));
    }
  };

  return (
    <div className="relative flex min-h-12 shrink-0 items-center gap-2 border-b border-[var(--lm-border)] bg-[var(--lm-surface)] px-3">
      <div className="flex items-center gap-1" aria-label="页码导航">
        <button
          type="button"
          onClick={() => controls?.goToPage(Math.max(1, currentPage - 1))}
          disabled={!controls || currentPage <= 1}
          className="icon-button"
          title="上一页"
          aria-label="上一页"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <input
          aria-label="当前页码"
          value={pageDraft}
          onChange={(event) => setPageDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitPage();
              event.currentTarget.blur();
            }
          }}
          onBlur={commitPage}
          className="h-8 w-12 rounded-lg border border-[var(--lm-border)] bg-[var(--lm-bg)] text-center text-xs font-medium text-[var(--lm-text)] outline-none focus:border-[var(--lm-brand)] focus:ring-2 focus:ring-[var(--lm-brand)]/20"
        />
        <span className="text-xs text-[var(--lm-text-muted)]">/ {numPages || '—'}</span>
        <button
          type="button"
          onClick={() => controls?.goToPage(Math.min(numPages, currentPage + 1))}
          disabled={!controls || !numPages || currentPage >= numPages}
          className="icon-button"
          title="下一页"
          aria-label="下一页"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="hidden h-6 w-px bg-[var(--lm-border)] sm:block" />
      <div className="hidden items-center gap-1 sm:flex" aria-label="缩放">
        <button type="button" onClick={() => controls?.zoomOut()} disabled={!controls} className="icon-button" title="缩小" aria-label="缩小">
          <ZoomOut className="h-4 w-4" />
        </button>
        <select
          aria-label="缩放模式"
          value={zoomMode === 'manual' ? String(scale) : zoomMode}
          onChange={(event) => {
            const value = event.target.value;
            const mode: ZoomMode | number = value === 'fit-page' || value === 'fit-width' ? value : Number(value);
            controls?.setZoomMode(mode);
          }}
          className="h-8 rounded-lg border border-[var(--lm-border)] bg-[var(--lm-bg)] px-2 text-xs text-[var(--lm-text)] outline-none focus:border-[var(--lm-brand)]"
        >
          <option value="fit-width">适宽</option>
          <option value="fit-page">整页</option>
          {zoomMode === 'manual' && <option value={String(scale)}>{Math.round(scale * 100)}%</option>}
        </select>
        <button type="button" onClick={() => controls?.zoomIn()} disabled={!controls} className="icon-button" title="放大" aria-label="放大">
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>

      {!mobile && <div className="ml-auto flex items-center gap-1">
        {onOpenToc && <button type="button" onClick={onOpenToc} className={`toolbar-button ${tocOpen ? 'bg-[var(--lm-brand)]/10 text-[var(--lm-brand)]' : ''}`} title="打开教材目录" aria-label="教材目录" aria-expanded={tocOpen}>
          <ListTree className="h-4 w-4" /><span className="hidden md:inline">目录</span>
        </button>}
        <button type="button" onClick={onOpenDrawer} className="toolbar-button" title="打开提问记录">
          <PanelLeft className="h-4 w-4" />
          <span className="hidden md:inline">记录</span>
        </button>
        <button type="button" onClick={onCapture} disabled={captureDisabled} className="toolbar-button toolbar-button-primary" title="框选页面内容" aria-label="框选">
          <Scissors className="h-4 w-4" /><span className="hidden sm:inline">框选</span>
        </button>
        {onToggleChat && (
          <button type="button" onClick={onToggleChat} className="toolbar-button hidden lg:inline-flex" title={chatCollapsed ? '展开问答区' : '收起问答区'} aria-label={chatCollapsed ? '展开问答区' : '收起问答区'}>
            {chatCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
            <span className="hidden md:inline">{chatCollapsed ? '展开问答' : '收起问答'}</span>
          </button>
        )}
      </div>}
      {tocOpen && tocPanel && <div className="absolute right-3 top-full z-[90] pt-2">{tocPanel}</div>}
    </div>
  );
}
