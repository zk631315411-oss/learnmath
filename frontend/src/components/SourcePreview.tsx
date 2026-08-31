import { BookOpen, ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { Source } from '../types';

interface Props {
  source: Source | null;
  onClose: () => void;
  onViewInTextbook: (source: Source) => Promise<void>;
}

export default function SourcePreview({ source, onClose, onViewInTextbook }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setError(null); setLoading(false); }, [source?.source_code]);
  if (!source) return null;

  const handleView = async () => {
    setLoading(true);
    setError(null);
    try {
      await onViewInTextbook(source);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法定位到教材位置');
    } finally {
      setLoading(false);
    }
  };

  return <div className="fixed inset-0 z-[10020] flex items-end bg-black/35 md:items-center md:justify-center" role="dialog" aria-modal="true" aria-label="教材出处预览" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="max-h-[82vh] w-full overflow-y-auto rounded-t-lg border border-[var(--lm-border)] bg-[var(--lm-surface)] shadow-2xl md:w-[520px] md:rounded-lg">
      <div className="sticky top-0 flex items-center gap-3 border-b border-[var(--lm-border)] bg-[var(--lm-surface)] px-4 py-3">
        <BookOpen className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">教材出处</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭出处预览" title="关闭"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-4 px-4 py-4">
        <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <dt className="text-slate-400">教材</dt><dd className="font-medium text-slate-800 dark:text-slate-100">{source.textbook_name}</dd>
          <dt className="text-slate-400">章节</dt><dd className="text-slate-700 dark:text-slate-200">{source.chapter}</dd>
          <dt className="text-slate-400">小节</dt><dd className="text-slate-700 dark:text-slate-200">{source.section}</dd>
          <dt className="text-slate-400">知识点</dt><dd className="text-slate-700 dark:text-slate-200">{source.node_name}</dd>
        </dl>
        <blockquote className="border-l-2 border-indigo-300 bg-[var(--lm-bg)] px-3 py-3 text-sm leading-6 text-slate-600 dark:border-indigo-700 dark:text-slate-300">{source.snippet}</blockquote>
        {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">{error}</p>}
        <div className="flex justify-end">
          <button type="button" onClick={() => void handleView()} disabled={loading} className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60">
            <ExternalLink className="h-4 w-4" />{loading ? '正在定位…' : '在教材中查看'}
          </button>
        </div>
      </div>
    </div>
  </div>;
}
