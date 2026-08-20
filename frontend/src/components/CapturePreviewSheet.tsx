import { FilePenLine, LoaderCircle, MessageCircle, RotateCcw, Scissors, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { recognizeFormulaContent } from '../services/api';
import type { CropBBox, RecognizedBlock, RecognizedContent } from '../types';

/** 框选确认后的待提问草稿：预览弹层消费，提问后进入聊天待发区。 */
export interface CaptureDraft {
  image: string;
  cropBBox: CropBBox;
  page: number;
}
import RecognizedContentCard from './formula/RecognizedContentCard';

interface Props {
  capture: CaptureDraft;
  token?: string | null;
  onQuestion: () => void;
  onInsert: (blocks: RecognizedBlock[]) => void;
  onReselect: () => void;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export default function CapturePreviewSheet({ capture, token, onQuestion, onInsert, onReselect, onClose, onBusyChange }: Props) {
  const abortRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<RecognizedContent | null>(null);

  const updateBusy = (next: boolean) => {
    setBusy(next);
    onBusyChange?.(next);
  };

  useEffect(() => () => {
    abortRef.current?.abort();
    onBusyChange?.(false);
  }, [onBusyChange]);

  const recognize = async () => {
    if (busy) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    updateBusy(true);
    setError('');
    try {
      setResult(await recognizeFormulaContent(capture.image, token || undefined, controller.signal));
    } catch (recognitionError) {
      if (!controller.signal.aborted) {
        setError(recognitionError instanceof Error ? recognitionError.message : '内容提取失败，请重试');
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        updateBusy(false);
      }
    }
  };

  const cancelRecognition = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    updateBusy(false);
  };

  const close = () => {
    cancelRecognition();
    onClose();
  };

  if (result) {
    return <RecognizedContentCard
      image={capture.image}
      blocks={result.blocks}
      warnings={result.warnings}
      onInsert={onInsert}
      onRetry={() => { setResult(null); void recognize(); }}
      onQuestion={onQuestion}
      questionLabel="转为提问"
      onClose={close}
    />;
  }

  return (
    <div className="fixed inset-0 z-[105] grid place-items-center bg-slate-950/50 p-3">
      <section className="flex max-h-[92dvh] w-[min(560px,100%)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" role="dialog" aria-modal="true" aria-label="框选内容预览">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-700">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><Scissors className="h-4 w-4 text-indigo-500" />框选内容</div>
          <button type="button" onClick={close} disabled={busy} aria-label="取消并关闭" className="icon-button"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <img src={capture.image} alt="框选内容预览" className="max-h-[55dvh] w-full rounded-lg border border-slate-200 bg-white object-contain dark:border-slate-700" />
          {busy && <div className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300" role="status"><LoaderCircle className="h-4 w-4 animate-spin text-indigo-500" />正在提取文字与公式…</div>}
          {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-300" role="alert">{error}</p>}
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 p-3 dark:border-slate-700">
          <button type="button" onClick={onReselect} disabled={busy} className="toolbar-button"><RotateCcw className="h-4 w-4" />重新框选</button>
          {busy ? <button type="button" onClick={cancelRecognition} className="toolbar-button"><X className="h-4 w-4" />取消提取</button>
            : <button type="button" onClick={() => void recognize()} className="toolbar-button"><FilePenLine className="h-4 w-4" />提取并编辑</button>}
          <button type="button" onClick={onQuestion} disabled={busy} className="toolbar-button toolbar-button-primary"><MessageCircle className="h-4 w-4" />提问</button>
        </footer>
      </section>
    </div>
  );
}
