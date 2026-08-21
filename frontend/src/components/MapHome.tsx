import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronRight, CircleAlert, Play, RefreshCw } from 'lucide-react';

import type { ChapterMapItem, LearningMapNode, LearningStatus, NodeMapResponse } from '../services/api';
import type { ChapterCatalogEdge } from '../catalog/types';
import { splitChapterTitle } from '../utils/chapterTitle';
import ChapterMapView from './ChapterMapView';
import InlineMathText from './InlineMathText';

interface TextbookOption { textbookId: string; name: string }

interface Props {
  textbookName: string;
  chapters: ChapterMapItem[];
  nodesByChapter: Record<string, NodeMapResponse>;
  edgesByChapter: Record<string, ChapterCatalogEdge[]>;
  errors: Record<string, string>;
  loading: boolean;
  onContinue: (chapter: string, node?: LearningMapNode) => void;
  onOpenChapter: (chapter: string) => void;
  selectedChapter?: string | null;
  selectedChapterMap?: NodeMapResponse | null;
  selectedChapterError?: string;
  onBackToChapters?: () => void;
  onStartChapter?: () => void;
  onContinueNode?: (node: LearningMapNode) => void;
  onOpenChat?: (chatId: string) => void;
  onRetry: () => void;
  onStartReading: () => void;
  textbookId: string;
  textbooks: TextbookOption[];
  onTextbookChange: (textbookId: string) => void;
}

const statusLabel: Record<LearningStatus, string> = {
  unexplored: '未探索', learning: '学习中', basically_mastered: '基本掌握', mastered: '已掌握', needs_review: '需要巩固',
};

function chapterNodes(response?: NodeMapResponse): LearningMapNode[] {
  return response?.sections.flatMap(section => section.nodes) || [];
}

export default function MapHome({
  textbookName, chapters, nodesByChapter, edgesByChapter, errors, loading,
  onContinue, onOpenChapter, selectedChapter, selectedChapterMap, selectedChapterError,
  onBackToChapters, onStartChapter, onContinueNode, onOpenChat, onRetry,
  onStartReading, textbookId, textbooks, onTextbookChange,
}: Props) {
  const [textbookMenuOpen, setTextbookMenuOpen] = useState(false);
  const [explicitExpanded, setExplicitExpanded] = useState<string | null>(null);
  const textbookMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!textbookMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!textbookMenuRef.current?.contains(event.target as Node)) setTextbookMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTextbookMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [textbookMenuOpen]);

  if (selectedChapter && onBackToChapters && onStartChapter && onContinueNode && onOpenChat) {
    if (!selectedChapterMap) {
      return <div className="h-full overflow-y-auto bg-[var(--lm-bg)] p-4 sm:p-8 lg:p-12">
        <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden border border-[var(--lm-border)] bg-[var(--lm-surface)]">
          <div className="flex items-center gap-3 border-b border-[var(--lm-border)] px-4 py-3"><button type="button" onClick={onBackToChapters} className="icon-button" title="返回章节" aria-label="返回章节"><ChevronRight className="h-4 w-4 rotate-180" /></button><div className="h-4 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-800" /></div>
          {selectedChapterError ? <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"><CircleAlert className="h-6 w-6 text-rose-500" /><p className="text-sm text-rose-600 dark:text-rose-300">章节详情加载失败</p><button type="button" onClick={onRetry} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700">重试</button></div> : <div className="grid gap-3 p-4 sm:grid-cols-2"><div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" /><div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" /></div>}
        </div>
      </div>;
    }
    return <div className="h-full overflow-hidden bg-[var(--lm-bg)] p-3 sm:p-6 lg:p-8"><div className="mx-auto h-full max-w-7xl overflow-hidden border border-[var(--lm-border)]"><ChapterMapView data={selectedChapterMap} edges={edgesByChapter[selectedChapter] || []} onBack={onBackToChapters} onOpenChat={onOpenChat} onStartReading={onStartChapter} onContinueNode={onContinueNode} /></div></div>;
  }

  // 继续学习只推荐「可行动」的节点：需巩固 > 学习中 > 未探索（同级按教材序）。
  // 全部掌握时不推荐具体节点，hero 退化为「从第 N 章开始」+ 打开教材。
  const actionableRank = (status: LearningStatus) => status === 'needs_review' ? 0 : status === 'learning' ? 1 : status === 'unexplored' ? 2 : 3;
  const candidates = chapters.flatMap(chapter => chapterNodes(nodesByChapter[chapter.chapter])
    .map(node => ({ chapter: chapter.chapter, node })))
    .filter(item => actionableRank(item.node.status) < 3)
    .sort((left, right) => actionableRank(left.node.status) - actionableRank(right.node.status));
  const firstCandidate = candidates[0];
  const firstChapterTitle = chapters[0] ? splitChapterTitle(chapters[0].chapter) : null;
  const heroTitleParts = firstCandidate ? splitChapterTitle(firstCandidate.chapter) : null;
  const heroTitle = firstCandidate
    ? (heroTitleParts?.number ? `${heroTitleParts.number} · ${heroTitleParts.title || heroTitleParts.display}` : firstCandidate.chapter)
    : (firstChapterTitle ? `从${firstChapterTitle.number || ''}${firstChapterTitle.number ? ' ' : ''}${firstChapterTitle.title || firstChapterTitle.display}开始` : '从教材开始');
  const expandedFor = (ch: string) => explicitExpanded === ch;
  const toggleChapter = (ch: string) => setExplicitExpanded(prev => prev === ch ? null : ch);

  return (
    <div className="h-full overflow-y-auto bg-[var(--lm-bg)] px-4 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="border-b border-slate-900 pb-7 dark:border-slate-200">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <h1 className="serif-zh text-[26px] font-semibold leading-snug text-slate-900 dark:text-slate-50">{heroTitle}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                {firstCandidate && <><span>{firstCandidate.node.section} · <InlineMathText>{firstCandidate.node.name}</InlineMathText></span><span aria-hidden="true">·</span></>}
                <span>{textbookName}</span>
                {firstCandidate && <><span aria-hidden="true">·</span><span>{statusLabel[firstCandidate.node.status]}</span></>}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" onClick={() => firstCandidate ? onContinue(firstCandidate.chapter, firstCandidate.node) : onStartReading()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"><Play className="h-4 w-4" />{firstCandidate ? '继续学习' : '打开教材'}</button>
            </div>
          </div>
        </section>

        <section className="space-y-3 pb-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">学习地图</p><div ref={textbookMenuRef} className="relative mt-1 w-full sm:w-fit"><button type="button" aria-label="选择教材" aria-haspopup="listbox" aria-expanded={textbookMenuOpen} onClick={() => setTextbookMenuOpen(open => !open)} className="flex min-h-11 w-full max-w-xl items-center justify-between gap-3 rounded-lg border border-transparent px-2 text-left text-lg font-semibold text-slate-900 outline-none transition hover:border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:text-slate-100 dark:hover:border-slate-700 dark:focus:ring-indigo-900/50 sm:w-auto"><span className="min-w-0 truncate">{textbookName}</span><ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${textbookMenuOpen ? 'rotate-180' : ''}`} /></button>{textbookMenuOpen && <div role="listbox" aria-label="教材列表" className="absolute left-0 z-30 mt-2 w-full min-w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:w-96">{textbooks.map(item => <button key={item.textbookId} type="button" role="option" aria-selected={item.textbookId === textbookId} onClick={() => { onTextbookChange(item.textbookId); setTextbookMenuOpen(false); }} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${item.textbookId === textbookId ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'}`}><span className="min-w-0 flex-1">{item.name}</span>{item.textbookId === textbookId && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}</button>)}</div>}</div><p className="mt-1 text-xs text-slate-400">{chapters.length ? `${chapters.length} 章 · ${chapters.reduce((sum, item) => sum + item.node_count, 0)} 个知识点 · ${chapters.reduce((sum, item) => sum + item.exploration_progress.explored, 0)} 个已探索知识点` : textbookName}</p></div><button type="button" onClick={onRetry} disabled={loading} className="icon-button self-end" title="刷新学习地图" aria-label="刷新学习地图"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /></button></div>
          {errors.__page && <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300"><span>{errors.__page}</span><button type="button" onClick={onRetry} className="font-medium underline">重试</button></div>}
          {errors.__progress && !errors.__page && <p className="text-xs text-amber-700 dark:text-amber-300">学习进度暂未同步，仍可浏览教材目录。</p>}
          {loading && chapters.length === 0 ? <div className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">{[0, 1, 2, 3].map(i => <div key={i} className="flex items-center gap-4 px-3 py-5"><div className="h-3 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-800" /><div className="h-4 flex-1 animate-pulse rounded bg-slate-200 dark:bg-slate-800" /><div className="h-3 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800" /></div>)}</div>
            : chapters.length > 0 ? <ul className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">{chapters.map(chapter => {
            const response = nodesByChapter[chapter.chapter];
            const failed = Boolean(errors[chapter.chapter]);
            const pending = loading && !response && !failed;
            const title = splitChapterTitle(chapter.chapter);
            const counts = chapter.status_counts;
            const statusSummary = counts.needs_review ? `${counts.needs_review} 个需巩固` : counts.learning ? `${counts.learning} 个学习中` : counts.mastered === chapter.node_count && chapter.node_count > 0 ? '全部掌握' : chapter.exploration_progress.explored === 0 ? '尚未开始' : `${chapter.exploration_progress.explored} 个已探索`;
            const exploredPct = chapter.exploration_progress.total ? chapter.exploration_progress.explored / chapter.exploration_progress.total * 100 : 0;
            const expanded = expandedFor(chapter.chapter);
            const statusClass = failed || (!pending && counts.needs_review) ? 'font-medium text-rose-600 dark:text-rose-300' : 'text-slate-400';
            return <li key={chapter.chapter}>
              <div className="flex items-center">
                <button type="button" aria-busy={pending} aria-expanded={expanded} onClick={() => toggleChapter(chapter.chapter)} className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-4 text-left transition hover:bg-slate-900/[0.04] dark:hover:bg-slate-400/10 sm:grid-cols-[auto_minmax(0,1fr)_150px_88px]">
                  <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
                  <span className="min-w-0"><span className="block text-[11px] text-slate-400">{title.number || '章节'}</span><span className="serif-zh mt-0.5 block truncate text-base font-semibold text-slate-800 dark:text-slate-100">{title.title || title.display}</span></span>
                  <span className="hidden sm:block"><span className="block h-[3px] overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><span className="block h-full bg-slate-900 dark:bg-slate-300" style={{ width: `${exploredPct}%` }} /></span><span className="mt-1.5 block font-mono text-[11px] tabular-nums text-slate-400">{chapter.exploration_progress.explored ? `${chapter.exploration_progress.explored} / ${chapter.exploration_progress.total} 已探索` : `${chapter.node_count} 个知识点`}</span></span>
                  <span className={`hidden text-right text-xs sm:block ${statusClass}`}>{failed ? '加载失败 · 点击重试' : pending ? '详情准备中…' : statusSummary}</span>
                </button>
                <button type="button" onClick={() => failed ? onRetry() : onOpenChapter(chapter.chapter)} className="mr-2 shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:text-indigo-700 dark:text-slate-400 dark:hover:text-indigo-300">查看地图 →</button>
              </div>
              {expanded && <div className="pb-4 pl-12 pr-4">
                {response?.sections.length ? <ul>{response.sections.map(section => {
                  const sectionNodes = section.nodes;
                  const sectionExplored = sectionNodes.filter(node => node.status !== 'unexplored').length;
                  const sectionReview = sectionNodes.filter(node => node.status === 'needs_review').length;
                  const sectionLearning = sectionNodes.some(node => node.status === 'learning');
                  const sectionStatus = sectionReview ? `${sectionReview} 个需巩固` : sectionLearning ? '学习中' : sectionExplored === 0 ? '未探索' : sectionExplored === sectionNodes.length ? '已探索' : `${sectionExplored}/${sectionNodes.length} 已探索`;
                  return <li key={section.section} className="flex items-baseline justify-between gap-4 border-t border-dashed border-slate-200 py-2 text-sm first:border-t-0 dark:border-slate-800"><span className="min-w-0 truncate text-slate-600 dark:text-slate-300"><InlineMathText>{section.section}</InlineMathText></span><span className={`shrink-0 text-xs ${sectionReview ? 'text-rose-600 dark:text-rose-300' : 'text-slate-400'}`}>{sectionStatus}</span></li>;
                })}</ul> : <p className="py-2 text-xs text-slate-400">{pending ? '小节详情准备中…' : '点击「查看地图」进入本章地图'}</p>}
              </div>}
            </li>;
          })}</ul> : <div className="py-16 text-center"><p className="text-sm text-slate-500">教材目录暂不可用</p><button type="button" onClick={onStartReading} className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"><BookOpen className="h-4 w-4" />打开教材</button></div>}
        </section>

      </div>
    </div>
  );
}
