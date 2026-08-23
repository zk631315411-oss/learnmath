import { ChevronRight, RefreshCw, X } from 'lucide-react';

import type { ChapterMapItem, LearningStatus, NodeMapResponse } from '../services/api';
import ChapterMapView from './ChapterMapView';

const segments: Array<{ key: LearningStatus; color: string; label: string }> = [
  { key: 'mastered', color: 'bg-emerald-600', label: '已学过' }, { key: 'basically_mastered', color: 'bg-emerald-300', label: '基本学过' },
  { key: 'learning', color: 'bg-amber-400', label: '学习中' }, { key: 'needs_review', color: 'bg-rose-400', label: '需要巩固' }, { key: 'unexplored', color: 'bg-slate-300', label: '未探索' },
];

export default function LearningMapPanel({ chapters, chapterMap, loading, unavailable, textbookSelected, onRefresh, onOpenChapter, onBack, onOpenChat, onClose }: {
  chapters: ChapterMapItem[]; chapterMap: NodeMapResponse | null; loading: boolean; unavailable: boolean; textbookSelected: boolean;
  onRefresh: () => void; onOpenChapter: (chapter: string) => void; onBack: () => void; onOpenChat: (chatId: string) => void; onClose?: () => void;
}) {
  if (chapterMap) return <ChapterMapView data={chapterMap} onBack={onBack} onOpenChat={onOpenChat} />;
  return <div className="flex h-full flex-col">
    <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-700"><span className="text-xs font-semibold text-slate-500 dark:text-slate-400">学习地图</span><div className="flex gap-1"><button type="button" onClick={onRefresh} disabled={loading} title="刷新学习地图" aria-label="刷新学习地图" className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>{onClose && <button type="button" onClick={onClose} title="关闭" aria-label="关闭学习地图" className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>}</div></div>
    <div className="flex-1 overflow-y-auto">
      {!textbookSelected ? <div className="px-4 py-8 text-center text-sm text-slate-400">请先选择教材</div> : unavailable ? <div className="px-4 py-8 text-center text-sm text-slate-500"><p>学习地图暂时不可用</p><p className="mt-1 text-xs text-slate-400">不影响继续提问</p></div> : chapters.length === 0 && !loading ? <div className="px-4 py-8 text-center text-sm text-slate-400">提问后这里会出现你的学习地图</div> : chapters.map(chapter => {
        const total = chapter.exploration_progress.total || 1; const explored = chapter.exploration_progress.explored;
        return <button key={chapter.chapter} type="button" onClick={() => onOpenChapter(chapter.chapter)} className="block w-full border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50 dark:border-slate-700/70 dark:hover:bg-slate-700/40">
          <div className="flex items-center gap-2"><span className="min-w-0 flex-1 text-sm font-medium text-slate-700 dark:text-slate-200">{chapter.chapter}</span><ChevronRight className="h-4 w-4 shrink-0 text-slate-400" /></div>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-700">{segments.map(segment => { const count = chapter.status_counts[segment.key]; return count ? <span key={segment.key} className={segment.color} style={{ width: `${count / total * 100}%` }} title={`${segment.label} ${count}`} /> : null; })}</div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-400"><span>探索进度</span><span>{explored} / {chapter.exploration_progress.total}</span></div>
          <div className="mt-1 h-1 overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-700"><div className="h-full bg-indigo-500" style={{ width: `${explored / total * 100}%` }} /></div>
        </button>;
      })}
    </div>
  </div>;
}
