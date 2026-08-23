import { useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight, List, MessageSquareText, Route } from 'lucide-react';

import type { ChapterCatalogEdge } from '../catalog/types';
import type { LearningMapNode, NodeMapResponse, LearningStatus } from '../services/api';
import { splitChapterTitle } from '../utils/chapterTitle';
import ChapterLadderView from './ChapterLadderView';
import InlineMathText from './InlineMathText';

const statusLabel: Record<LearningStatus, string> = {
  unexplored: '未探索', learning: '学习中', basically_mastered: '基本学过', mastered: '已学过', needs_review: '需要巩固',
};
const statusVariable: Record<LearningStatus, string> = {
  unexplored: 'var(--lm-status-unexplored)', learning: 'var(--lm-status-learning)', basically_mastered: 'var(--lm-status-basic)', mastered: 'var(--lm-status-mastered)', needs_review: 'var(--lm-status-review)',
};

function ChapterList({ data, showAll, onOpenChat, onContinueNode }: {
  data: NodeMapResponse;
  showAll: boolean;
  onOpenChat: (chatId: string) => void;
  onContinueNode?: (node: LearningMapNode) => void;
}) {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const sections = useMemo(() => data.sections.map(group => ({
    ...group,
    nodes: showAll ? group.nodes : group.nodes.filter(node => node.status !== 'unexplored' || node.blocked),
  })).filter(group => showAll || group.nodes.length > 0), [data.sections, showAll]);
  const toggle = (section: string) => setOpenSections(current => {
    const next = new Set(current); next.has(section) ? next.delete(section) : next.add(section); return next;
  });

  return <div className="min-h-0 flex-1 overflow-y-auto p-4">
    {sections.length === 0 && <div className="border border-dashed border-slate-300 bg-[var(--lm-surface)] px-4 py-10 text-center text-sm text-slate-400 dark:border-slate-700">本章还没有学习记录，打开“显示全部”查看知识点。</div>}
    {sections.map(group => {
      const open = openSections.has(group.section);
      return <div key={group.section} className="overflow-hidden border-b border-[var(--lm-border)] bg-[var(--lm-surface)]">
        <button type="button" onClick={() => toggle(group.section)} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">{open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}<span className="min-w-0 flex-1 truncate">{group.section}</span><span>{group.nodes.length}</span></button>
        {open && group.nodes.map(node => <div key={node.node_id} className="flex min-h-12 items-center gap-2 border-t border-[var(--lm-border)] px-3 py-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: statusVariable[node.status] }} />
          <div className="min-w-0 flex-1"><div className="truncate text-sm text-slate-700 dark:text-slate-200" title={node.name}><InlineMathText>{node.name}</InlineMathText></div><div className="flex flex-wrap gap-1 text-xs text-slate-400"><span>{statusLabel[node.status]}</span>{node.blocked && <span className="rounded bg-amber-100 px-1 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">可能受阻</span>}</div></div>
          {onContinueNode && <button type="button" onClick={() => onContinueNode(node)} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300">{node.status === 'needs_review' ? '复习' : node.status === 'unexplored' ? '开始' : '继续'}</button>}
          <button type="button" disabled={!node.chat.available || !node.chat.id} onClick={() => node.chat.id && onOpenChat(node.chat.id)} aria-label="打开来源提问" title={node.chat.available ? '打开来源提问' : '来源提问已删除'} className="icon-button disabled:opacity-30"><MessageSquareText className="h-4 w-4" /></button>
        </div>)}
      </div>;
    })}
  </div>;
}

export default function ChapterMapView({ data, edges, onBack, onOpenChat, onStartReading, onContinueNode, initialSection }: {
  data: NodeMapResponse;
  edges?: ChapterCatalogEdge[];
  onBack: () => void;
  onOpenChat: (chatId: string) => void;
  onStartReading?: () => void;
  onContinueNode?: (node: LearningMapNode) => void;
  initialSection?: string | null;
}) {
  const [mode, setMode] = useState<'list' | 'map'>('map');
  const [showAll, setShowAll] = useState(false);
  const title = splitChapterTitle(data.chapter);

  return <div className="flex h-full flex-col bg-[var(--lm-bg)]">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--lm-border)] bg-[var(--lm-surface)] px-3 py-2.5 sm:px-4">
      <button type="button" onClick={onBack} aria-label="返回章节总览" title="返回章节总览" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-[var(--lm-border)] px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-800"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">章节总览</span></button>
      <div className="min-w-[10rem] flex-1">{title.number && <p className="text-[11px] font-medium text-slate-400">{title.number}</p>}<h1 className="serif-zh truncate text-base font-semibold text-slate-800 dark:text-slate-100">{title.title || title.display}</h1></div>
      <div className="flex h-9 overflow-hidden rounded-md border border-[var(--lm-border)]" aria-label="章节视图">
        <button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')} className={`inline-flex w-10 items-center justify-center sm:w-auto sm:gap-1.5 sm:px-3 ${mode === 'list' ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`} title="列表视图"><List className="h-4 w-4" /><span className="hidden text-xs sm:inline">列表</span></button>
        <button type="button" aria-pressed={mode === 'map'} onClick={() => setMode('map')} className={`inline-flex w-10 items-center justify-center border-l border-[var(--lm-border)] sm:w-auto sm:gap-1.5 sm:px-3 ${mode === 'map' ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`} title="地图视图"><Route className="h-4 w-4" /><span className="hidden text-xs sm:inline">地图</span></button>
      </div>
      {mode === 'list' && <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} />显示全部</label>}
      {onStartReading && <button type="button" onClick={onStartReading} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-700"><BookOpen className="h-3.5 w-3.5" />开始本章</button>}
    </header>
    <div className="min-h-0 flex-1 overflow-hidden">{mode === 'map' ? <ChapterLadderView data={data} edges={edges || []} onOpenChat={onOpenChat} onContinueNode={onContinueNode} initialSection={initialSection} /> : <ChapterList data={data} showAll={showAll} onOpenChat={onOpenChat} onContinueNode={onContinueNode} />}</div>
  </div>;
}
