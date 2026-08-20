import { useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight, MessageSquareText } from 'lucide-react';

import type { LearningMapNode, NodeMapResponse, LearningStatus } from '../services/api';
import InlineMathText from './InlineMathText';
import { splitChapterTitle } from '../utils/chapterTitle';

const statusLabel: Record<LearningStatus, string> = {
  unexplored: '未探索', learning: '学习中', basically_mastered: '基本掌握', mastered: '已掌握', needs_review: '需要巩固',
};
const statusColor: Record<LearningStatus, string> = {
  unexplored: 'bg-slate-300', learning: 'bg-amber-400', basically_mastered: 'bg-emerald-300', mastered: 'bg-emerald-600', needs_review: 'bg-rose-400',
};

export default function ChapterMapView({ data, onBack, onOpenChat, onStartReading, onContinueNode }: {
  data: NodeMapResponse; onBack: () => void; onOpenChat: (chatId: string) => void;
  onStartReading?: () => void; onContinueNode?: (node: LearningMapNode) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const sections = useMemo(() => data.sections.map(group => ({
    ...group, nodes: showAll ? group.nodes : group.nodes.filter(node => node.status !== 'unexplored' || node.blocked),
  })).filter(group => showAll || group.nodes.length > 0), [data.sections, showAll]);
  const toggle = (section: string) => setOpenSections(current => {
    const next = new Set(current); next.has(section) ? next.delete(section) : next.add(section); return next;
  });

  const title = splitChapterTitle(data.chapter);

  return <div className="flex h-full flex-col bg-[var(--lm-bg)]">
    <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <button type="button" onClick={onBack} aria-label="返回章节总览" title="返回章节总览" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800">
        <ArrowLeft className="h-4 w-4" />
        <span>返回章节总览</span>
      </button>
      <div className="min-w-0 flex-1">
        {title.number && <p className="text-xs font-medium text-slate-400">{title.number}</p>}
        <h1 className="truncate text-base font-semibold text-slate-800 dark:text-slate-100">{title.title || title.display}</h1>
      </div>
      <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} />显示全部</label>
      {onStartReading && <button type="button" onClick={onStartReading} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-700"><BookOpen className="h-3.5 w-3.5" />开始本章</button>}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {sections.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900">本章还没有学习记录，打开“显示全部”查看知识点。</div>}
      {sections.map(group => {
        const open = openSections.has(group.section);
        return <div key={group.section} className="overflow-hidden border-b border-slate-100 bg-white first:rounded-t-xl last:rounded-b-xl dark:border-slate-800 dark:bg-slate-900">
          <button type="button" onClick={() => toggle(group.section)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/40">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<span className="min-w-0 flex-1 truncate">{group.section}</span><span>{group.nodes.length}</span>
          </button>
          {open && group.nodes.map((node: LearningMapNode) => <div key={node.node_id} className="flex min-h-12 items-center gap-2 border-t border-slate-100 px-3 py-2 dark:border-slate-700/60">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusColor[node.status]}`} />
            <div className="min-w-0 flex-1"><div className="truncate text-sm text-slate-700 dark:text-slate-200" title={node.name}><InlineMathText>{node.name}</InlineMathText></div><div className="flex flex-wrap gap-1 text-xs text-slate-400"><span>{statusLabel[node.status]}</span>{node.blocked && <span className="rounded bg-amber-100 px-1 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">可能受阻</span>}</div></div>
            {onContinueNode && node.status !== 'unexplored' && <button type="button" onClick={() => onContinueNode(node)} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300">{node.status === 'needs_review' ? '复习' : '继续'}</button>}
            <button type="button" disabled={!node.chat.available || !node.chat.id} onClick={() => node.chat.id && onOpenChat(node.chat.id)} aria-label="打开来源提问" title={node.chat.available ? '打开来源提问' : '来源提问已删除'} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-slate-700 dark:hover:text-indigo-300"><MessageSquareText className="h-4 w-4" /></button>
          </div>)}
        </div>;
      })}
    </div>
  </div>;
}
