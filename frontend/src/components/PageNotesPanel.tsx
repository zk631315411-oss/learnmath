import { ArrowLeft, ChevronDown, MessageSquarePlus } from 'lucide-react';
import { useEffect, useState } from 'react';

import ChatPanel from './ChatPanel';
import type { Marker } from './PageMarker';
import type { Message, PendingImage } from '../types';

interface Props {
  currentPage: number;
  items: Marker[];
  activeMarker: Marker | null;
  messages: Message[];
  isLoading: boolean;
  token?: string | null;
  pendingImages: PendingImage[];
  error?: string | null;
  thinkingStage?: string;
  thinkingStageKey?: string;
  isThinking?: boolean;
  onOpenThread: (marker: Marker) => void;
  onSendNew: (content: string) => void;
  onSendFollowUp: (content: string) => void;
  onClearMessages: () => void;
  onRemovePendingImage: (id: string) => void;
  onClearPendingImages: () => void;
  threadRequestKey?: number;
  onModeChange?: (mode: 'page' | 'thread') => void;
  itemsLoading?: boolean;
  itemsError?: string | null;
  onRetryItems?: () => void;
}

function Starters({ page, onSelect }: { page: number; onSelect: (value: string) => void }) {
  const prompts = ['这页哪里没看懂？', '帮我讲讲本页的核心概念', '用一个例子检验我的理解'];
  return <div className="flex h-full flex-col items-center justify-center px-5 text-center"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300"><MessageSquarePlus className="h-5 w-5" /></div><p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">第 {page} 页还没有提问</p><p className="mt-1 text-xs text-slate-400">从一个小问题开始，AI 会把回答钉回这一页。</p><div className="mt-4 flex w-full flex-col gap-2">{prompts.map(prompt => <button key={prompt} type="button" onClick={() => onSelect(prompt)} className="rounded-xl border border-slate-200 px-3 py-2 text-left text-xs text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50/60 dark:border-slate-700 dark:text-slate-300 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/30">{prompt}</button>)}</div></div>;
}

export default function PageNotesPanel({ currentPage, items, activeMarker, messages, isLoading, token, pendingImages, error, thinkingStage, thinkingStageKey, isThinking, onOpenThread, onSendNew, onSendFollowUp, onClearMessages, onRemovePendingImage, onClearPendingImages, threadRequestKey = 0, onModeChange, itemsLoading = false, itemsError, onRetryItems }: Props) {
  const [mode, setMode] = useState<'page' | 'thread'>('page');
  const pageItems = items.filter(item => item.page_number === currentPage);
  const threadPage = activeMarker?.page_number;
  const sendNew = (content: string) => { setMode('thread'); onSendNew(content); };

  useEffect(() => {
    if (threadRequestKey > 0) setMode('thread');
  }, [threadRequestKey]);

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  if (mode === 'thread') {
    return <div className="flex h-full flex-col bg-white dark:bg-slate-800">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-200 px-4 dark:border-slate-700"><button type="button" onClick={() => setMode('page')} className="icon-button" title="返回本页" aria-label="返回本页"><ArrowLeft className="h-4 w-4" /></button><div className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-100">对话视图</div>{threadPage && threadPage !== currentPage && <button type="button" onClick={() => onOpenThread(activeMarker!)} className="text-xs text-indigo-600 hover:underline dark:text-indigo-300">来自第 {threadPage} 页 · 跳回</button>}</div>
      <div className="min-h-0 flex-1"><ChatPanel messages={messages} onSendMessage={onSendFollowUp} onClearMessages={onClearMessages} isLoading={isLoading} token={token} pendingImages={pendingImages} onRemovePendingImage={onRemovePendingImage} onClearPendingImages={onClearPendingImages} error={error} thinkingStage={thinkingStage} thinkingStageKey={thinkingStageKey} isThinking={isThinking} compact /></div>
    </div>;
  }

  return <div className="flex h-full flex-col bg-white dark:bg-slate-800">
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-700"><div><p className="text-xs text-slate-400">当前页</p><p className="text-sm font-semibold text-slate-700 dark:text-slate-100">第 {currentPage} 页 · {pageItems.length} 条记录</p></div><span className="text-xs text-slate-400">点击卡片查看对话</span></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">{itemsLoading ? <div data-testid="page-notes-loading" className="space-y-2"><div className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" /><div className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" /></div> : itemsError ? <div className="flex h-full min-h-64 flex-col items-center justify-center px-6 text-center"><p className="text-sm font-medium text-rose-600 dark:text-rose-300">{itemsError}</p><button type="button" onClick={onRetryItems} className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700">重试</button></div> : pageItems.length === 0 ? <div className="h-full min-h-64"><Starters page={currentPage} onSelect={sendNew} /></div> : <div className="space-y-2">{pageItems.map(item => <details key={item.id} className="group rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-900/60"><summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-3 text-sm text-slate-700 dark:text-slate-200"><ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" /><span className="min-w-0 flex-1">{item.question}</span><button type="button" data-open-thread onClick={(event) => { event.preventDefault(); onOpenThread(item); setMode('thread'); }} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300">打开</button></summary><div className="line-clamp-3 border-t border-slate-200 px-3 py-3 text-xs leading-6 text-slate-500 dark:border-slate-700 dark:text-slate-400">{item.answer || '回答生成中…'}</div></details>)}</div>}</div>
    <div className="shrink-0"><ChatPanel messages={[]} onSendMessage={sendNew} onClearMessages={onClearMessages} isLoading={isLoading} token={token} pendingImages={pendingImages} onRemovePendingImage={onRemovePendingImage} onClearPendingImages={onClearPendingImages} error={error} thinkingStage={thinkingStage} thinkingStageKey={thinkingStageKey} isThinking={isThinking} compact emptyState={<div className="hidden" />} /></div>
  </div>;
}
