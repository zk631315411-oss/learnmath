import { BookOpen, ChevronRight, ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import MarkdownRenderer from './MarkdownRenderer';
import type { Source } from '../types';

interface Props {
  source: Source | null;
  onClose: () => void;
  onViewInTextbook: (source: Source) => Promise<void>;
}

/** 面包屑路径：教材 › 章节 › 小节 › 知识点，段内 LaTeX 经 KaTeX 渲染 */
function SourceBreadcrumb({ source }: { source: Source }) {
  const segments = [source.textbook_name, source.chapter, source.section, source.node_name].filter(Boolean) as string[];
  return (
    <nav aria-label="出处路径" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
      {segments.map((segment, index) => (
        <span key={index} className="flex min-w-0 items-center gap-1">
          {index > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden />}
          <span className={`min-w-0 [&_p]:mb-0 [&_p]:inline ${index === segments.length - 1
            ? 'font-medium text-slate-800 dark:text-slate-100'
            : 'text-slate-500 dark:text-slate-400'}`}>
            <MarkdownRenderer>{segment}</MarkdownRenderer>
          </span>
        </span>
      ))}
    </nav>
  );
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
        <SourceBreadcrumb source={source} />
        <blockquote className="border-l-2 border-indigo-300 bg-[var(--lm-bg)] px-3 py-3 text-sm leading-6 text-slate-600 dark:border-indigo-700 dark:text-slate-300">
          <MarkdownRenderer>{source.snippet || ''}</MarkdownRenderer>
        </blockquote>
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
