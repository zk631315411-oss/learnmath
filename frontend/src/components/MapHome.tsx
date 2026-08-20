import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronRight, CircleAlert, MessageSquareText, Play, RefreshCw } from 'lucide-react';

import type { Marker } from './PageMarker';
import type { ChapterMapItem, LearningMapNode, NodeMapResponse } from '../services/api';
import InlineMathText from './InlineMathText';
import ChapterMapView from './ChapterMapView';
import { splitChapterTitle } from '../utils/chapterTitle';
import type { LearningStatus } from '../services/api';

interface TextbookOption { textbookId: string; name: string }

const statusLabel: Record<LearningStatus, string> = {
  unexplored: '未探索', learning: '学习中', basically_mastered: '基本掌握', mastered: '已掌握', needs_review: '需要巩固',
};
const statusDot: Record<LearningStatus, string> = {
  unexplored: 'bg-slate-300', learning: 'bg-amber-400', basically_mastered: 'bg-emerald-300', mastered: 'bg-emerald-600', needs_review: 'bg-rose-400',
};

interface Props {
  textbookName: string;
  chapters: ChapterMapItem[];
  nodesByChapter: Record<string, NodeMapResponse>;
  errors: Record<string, string>;
  loading: boolean;
  questionItems: Marker[];
  onContinue: (chapter: string, node?: LearningMapNode) => void;
  onOpenChapter: (chapter: string) => void;
  selectedChapter?: string | null;
  selectedChapterMap?: NodeMapResponse | null;
  selectedChapterError?: string;
  onBackToChapters?: () => void;
  onStartChapter?: () => void;
  onContinueNode?: (node: LearningMapNode) => void;
  onOpenChat?: (chatId: string) => void;
  onOpenQuestion: (marker: Marker) => void;
  onRetry: () => void;
  onStartReading: () => void;
  textbookId: string;
  textbooks: TextbookOption[];
  onTextbookChange: (textbookId: string) => void;
}

function chapterNodes(response?: NodeMapResponse): LearningMapNode[] {
  return response?.sections.flatMap(section => section.nodes) || [];
}

export default function MapHome({ textbookName, chapters, nodesByChapter, errors, loading, questionItems, onContinue, onOpenChapter, selectedChapter, selectedChapterMap, selectedChapterError, onBackToChapters, onStartChapter, onContinueNode, onOpenChat, onOpenQuestion, onRetry, onStartReading, textbookId, textbooks, onTextbookChange }: Props) {
  const [textbookMenuOpen, setTextbookMenuOpen] = useState(false);
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
        <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800"><button type="button" onClick={onBackToChapters} className="icon-button" title="返回章节" aria-label="返回章节"><ChevronRight className="h-4 w-4 rotate-180" /></button><div className="h-4 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-800" /></div>
          {selectedChapterError ? <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"><CircleAlert className="h-6 w-6 text-rose-500" /><p className="text-sm text-rose-600 dark:text-rose-300">章节详情加载失败</p><button type="button" onClick={onRetry} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700">重试</button></div> : <div className="grid gap-3 p-4 sm:grid-cols-2"><div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" /><div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" /></div>}
        </div>
      </div>;
    }
    return <div className="h-full overflow-hidden bg-[var(--lm-bg)] p-4 sm:p-8 lg:p-12"><div className="mx-auto h-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800"><ChapterMapView data={selectedChapterMap} onBack={onBackToChapters} onOpenChat={onOpenChat} onStartReading={onStartChapter} onContinueNode={onContinueNode} /></div></div>;
  }

  const candidates = chapters.flatMap(chapter => chapterNodes(nodesByChapter[chapter.chapter])
    .filter(node => node.status === 'needs_review' || node.status === 'learning')
    .map(node => ({ chapter: chapter.chapter, node })))
    // A review item is the most actionable continuation, even when the KG
    // returns learning nodes first within a section.
    .sort((left, right) => Number(right.node.status === 'needs_review') - Number(left.node.status === 'needs_review'));
  const firstCandidate = candidates[0];
  const firstChapterTitle = chapters[0] ? splitChapterTitle(chapters[0].chapter) : null;
  const markerById = new Map(questionItems.map(item => [item.id, item]));
  const firstMarker = firstCandidate?.node.chat.id ? markerById.get(firstCandidate.node.chat.id) : undefined;
  const reviewItems = candidates.filter(item => item.node.status === 'needs_review').slice(0, 6);

  return (
    <div className="h-full overflow-y-auto bg-[var(--lm-bg)] px-4 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="flex flex-col gap-5 rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm dark:border-indigo-900/40 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300"><BookOpen className="h-5 w-5" /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{firstCandidate ? '继续学习' : '开始学习'}</p>
              <h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{firstCandidate ? `${firstCandidate.chapter} · ${firstCandidate.node.name}` : (firstChapterTitle ? `从${firstChapterTitle.number || ''}${firstChapterTitle.number ? ' ' : ''}${firstChapterTitle.title || firstChapterTitle.display}开始` : '从教材开始')}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                <span>{textbookName}</span>
                {firstCandidate && <><span aria-hidden="true">·</span><span>{firstCandidate.node.section}</span><span aria-hidden="true">·</span><span>{statusLabel[firstCandidate.node.status]}</span></>}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={() => firstCandidate ? onContinue(firstCandidate.chapter, firstCandidate.node) : onStartReading()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"><Play className="h-4 w-4" />{firstCandidate ? '继续学习' : '打开教材'}</button>
            {firstMarker && <button type="button" onClick={() => onOpenQuestion(firstMarker)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><MessageSquareText className="h-4 w-4" />来源提问</button>}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">学习地图</p><div ref={textbookMenuRef} className="relative mt-1 w-full sm:w-fit"><button type="button" aria-label="选择教材" aria-haspopup="listbox" aria-expanded={textbookMenuOpen} onClick={() => setTextbookMenuOpen(open => !open)} className="flex min-h-11 w-full max-w-xl items-center justify-between gap-3 rounded-lg border border-transparent px-2 text-left text-lg font-semibold text-slate-900 outline-none transition hover:border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:text-slate-100 dark:hover:border-slate-700 dark:focus:ring-indigo-900/50 sm:w-auto"><span className="min-w-0 truncate">{textbookName}</span><ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${textbookMenuOpen ? 'rotate-180' : ''}`} /></button>{textbookMenuOpen && <div role="listbox" aria-label="教材列表" className="absolute left-0 z-30 mt-2 w-full min-w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:w-96">{textbooks.map(item => <button key={item.textbookId} type="button" role="option" aria-selected={item.textbookId === textbookId} onClick={() => { onTextbookChange(item.textbookId); setTextbookMenuOpen(false); }} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${item.textbookId === textbookId ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'}`}><span className="min-w-0 flex-1">{item.name}</span>{item.textbookId === textbookId && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}</button>)}</div>}</div><p className="mt-1 text-xs text-slate-400">{chapters.length ? `${chapters.length} 章 · ${chapters.reduce((sum, item) => sum + item.node_count, 0)} 个知识点 · ${chapters.reduce((sum, item) => sum + item.exploration_progress.explored, 0)} 个已探索知识点` : textbookName}</p></div><button type="button" onClick={onRetry} disabled={loading} className="icon-button self-end" title="刷新学习地图" aria-label="刷新学习地图"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /></button></div>
          {errors.__page && <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300"><span>{errors.__page}</span><button type="button" onClick={onRetry} className="font-medium underline">重试</button></div>}
          {loading && chapters.length === 0 ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div className="h-32 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" /><div className="h-32 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" /><div className="h-32 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" /></div> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{chapters.map(chapter => {
            const response = nodesByChapter[chapter.chapter];
            const nodes = chapterNodes(response);
            const progress = chapter.exploration_progress.total ? Math.round(chapter.exploration_progress.explored / chapter.exploration_progress.total * 100) : 0;
            const failed = Boolean(errors[chapter.chapter]);
            const pending = loading && !response && !failed;
            const title = splitChapterTitle(chapter.chapter);
            const counts = chapter.status_counts;
            const statusSummary = counts.needs_review ? `${counts.needs_review} 个需巩固` : counts.learning ? `${counts.learning} 个学习中` : counts.mastered === chapter.node_count && chapter.node_count > 0 ? '全部掌握' : chapter.exploration_progress.explored === 0 ? '尚未开始' : `${chapter.exploration_progress.explored} 个已探索`;
            const statusSegments: Array<{ key: LearningStatus; color: string }> = [{ key: 'needs_review', color: 'bg-rose-400' }, { key: 'learning', color: 'bg-amber-400' }, { key: 'basically_mastered', color: 'bg-emerald-300' }, { key: 'mastered', color: 'bg-emerald-600' }, { key: 'unexplored', color: 'bg-slate-200 dark:bg-slate-700' }];
            return <button key={chapter.chapter} type="button" aria-busy={pending} onClick={() => failed ? onRetry() : onOpenChapter(chapter.chapter)} className="group min-h-[174px] rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-800">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-slate-400">{title.number || '章节'}</p><h3 className="mt-1 line-clamp-2 font-semibold text-slate-800 dark:text-slate-100">{title.title || title.display}</h3></div><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" /></div>
              {failed ? <p className="mt-4 flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-300"><CircleAlert className="h-3.5 w-3.5" />加载失败 · 点击重试</p> : <><div className="mt-4 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">{statusSegments.map(segment => { const count = counts[segment.key] || 0; return count ? <span key={segment.key} className={segment.color} style={{ width: `${count / Math.max(1, chapter.node_count) * 100}%` }} /> : null; })}</div><div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-400"><span>{pending ? '详情准备中…' : statusSummary}</span><span>{chapter.exploration_progress.explored ? `${chapter.exploration_progress.explored} / ${chapter.exploration_progress.total} 已探索` : `${chapter.node_count} 个知识点`}</span></div><p className="mt-3 text-xs font-medium text-indigo-600 dark:text-indigo-300">查看地图 <span aria-hidden="true">→</span></p></>}
            </button>;
          })}</div>}
        </section>

        <section className="space-y-3 pb-8"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">需要巩固</p><h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{reviewItems.length ? `${reviewItems.length} 个知识点` : '目前没有待复习内容'}</h2></div>{reviewItems.length > 0 && <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">{reviewItems.map(({ chapter, node }) => { const marker = node.chat.id ? markerById.get(node.chat.id) : undefined; return <div key={node.node_id} className="flex items-center gap-3 px-4 py-3"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDot[node.status]}`} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200"><InlineMathText>{node.name}</InlineMathText></p><p className="text-xs text-slate-400">{chapter}</p></div>{marker ? <button type="button" onClick={() => onOpenQuestion(marker)} className="icon-button" title="回到来源提问" aria-label="回到来源提问"><MessageSquareText className="h-4 w-4" /></button> : <button type="button" onClick={() => onContinue(chapter, node)} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300">开始复习</button>}</div>; })}</div>}</section>
      </div>
    </div>
  );
}
