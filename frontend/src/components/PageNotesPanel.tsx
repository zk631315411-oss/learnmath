import { ArrowLeft, MessageSquarePlus } from 'lucide-react';
import { useEffect, useState } from 'react';

import ChatPanel from './ChatPanel';
import type { Marker } from './PageMarker';
import { answerDigest } from '../utils/answerDigest';
import type { Message, PendingImage, RecognizedBlock } from '../types';

export interface PageNotesData {
  currentPage: number;
  items: Marker[];
  activeMarker: Marker | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onOpenThread: (marker: Marker) => void;
  threadRequestKey?: number;
}

export interface PageNotesConversation {
  messages: Message[];
  isLoading: boolean;
  token?: string | null;
  pendingImages: PendingImage[];
  error?: string | null;
  thinkingStage?: string;
  thinkingStageKey?: string;
  isThinking?: boolean;
  onSendNew: (content: string) => void;
  onSendFollowUp: (content: string) => void;
  onClearMessages: () => void;
  onRemovePendingImage: (id: string) => void;
  onClearPendingImages: () => void;
  onCancelGeneration?: () => void;
}

export interface PageNotesComposer {
  onOpenPhoto?: (file: File) => void;
  externalContent?: { blocks: RecognizedBlock[]; nonce: string } | null;
  onExternalContentConsumed?: (nonce: string) => void;
}

interface Props {
  page: PageNotesData;
  conversation: PageNotesConversation;
  composer: PageNotesComposer;
}

function Starters({ page, onSelect }: { page: number; onSelect: (value: string) => void }) {
  const prompts = ['这页哪里没看懂？', '帮我讲讲本页的核心概念', '用一个例子检验我的理解'];
  return <div className="flex h-full flex-col items-center justify-center px-5 text-center"><MessageSquarePlus className="h-6 w-6 text-[var(--lm-text-muted)]" /><p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">第 {page} 页还没有提问</p><p className="mt-1 text-xs text-slate-400">从一个小问题开始，AI 会把回答钉回这一页。</p><div className="mt-4 flex w-full flex-col gap-2">{prompts.map(prompt => <button key={prompt} type="button" onClick={() => onSelect(prompt)} className="rounded-xl border border-[var(--lm-border)] bg-[var(--lm-surface)] px-3 py-2 text-left text-xs text-slate-600 transition hover:border-indigo-300 hover:bg-[var(--lm-bg)] dark:text-slate-300 dark:hover:border-indigo-800">{prompt}</button>)}</div></div>;
}

export default function PageNotesPanel({ page, conversation, composer }: Props) {
  const {
    currentPage, items, activeMarker, loading: itemsLoading = false, error: itemsError,
    onRetry: onRetryItems, onOpenThread, threadRequestKey = 0,
  } = page;
  const {
    messages, isLoading, token, pendingImages, error, thinkingStage, thinkingStageKey, isThinking,
    onSendNew, onSendFollowUp, onClearMessages, onRemovePendingImage, onClearPendingImages, onCancelGeneration,
  } = conversation;
  const { onOpenPhoto, externalContent, onExternalContentConsumed } = composer;
  const [mode, setMode] = useState<'page' | 'thread'>('page');
  const pageItems = items.filter(item => item.page_number === currentPage);
  const threadPage = activeMarker?.page_number;
  const sendNew = (content: string) => { setMode('thread'); onSendNew(content); };

  useEffect(() => {
    if (threadRequestKey > 0) setMode('thread');
  }, [threadRequestKey]);

  if (mode === 'thread') {
    return <div className="flex h-full flex-col bg-[var(--lm-surface)]">
      <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-[var(--lm-border)] px-3"><button type="button" onClick={() => setMode('page')} className="icon-button" title="返回本页" aria-label="返回本页"><ArrowLeft className="h-4 w-4" /></button><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-700 dark:text-slate-100">对话视图</p><p className="text-[11px] text-slate-400">{threadPage ? `来源第 ${threadPage} 页` : `当前第 ${currentPage} 页`}</p></div>{threadPage && threadPage !== currentPage && <button type="button" onClick={() => onOpenThread(activeMarker!)} aria-label={`来自第 ${threadPage} 页，跳回来源`} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300">跳回来源</button>}</div>
      <div className="min-h-0 flex-1"><ChatPanel messages={messages} onSendMessage={onSendFollowUp} onClearMessages={onClearMessages} isLoading={isLoading} token={token} pendingImages={pendingImages} onRemovePendingImage={onRemovePendingImage} onClearPendingImages={onClearPendingImages} error={error} thinkingStage={thinkingStage} thinkingStageKey={thinkingStageKey} isThinking={isThinking} compact externalContent={externalContent} onExternalContentConsumed={onExternalContentConsumed} onCancelGeneration={onCancelGeneration} onOpenPhoto={onOpenPhoto} /></div>
    </div>;
  }

  return <div className="flex h-full flex-col bg-[var(--lm-surface)]">
    <div className="flex min-h-14 shrink-0 items-center border-b border-[var(--lm-border)] px-4"><div><p className="text-sm font-semibold text-slate-700 dark:text-slate-100">本页概要</p><p className="mt-0.5 text-xs text-slate-400">第 {currentPage} 页 · {pageItems.length} 条记录</p></div></div>
    <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--lm-bg)] p-3">{itemsLoading ? <div data-testid="page-notes-loading" className="space-y-2"><div className="h-20 animate-pulse rounded-xl bg-[var(--lm-canvas)] dark:bg-slate-800" /><div className="h-20 animate-pulse rounded-xl bg-[var(--lm-canvas)] dark:bg-slate-800" /></div> : itemsError ? <div className="flex h-full min-h-64 flex-col items-center justify-center px-6 text-center"><p className="text-sm font-medium text-rose-600 dark:text-rose-300">{itemsError}</p><button type="button" onClick={onRetryItems} className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700">重试</button></div> : pageItems.length === 0 ? <div className="h-full min-h-64"><Starters page={currentPage} onSelect={sendNew} /></div> : <div className="space-y-2">{pageItems.map(item => {
          const status = item.generation_status ?? (item.answer ? 'completed' : 'pending');
          const digest = item.answer ? answerDigest(item.answer) : '';
          const fallback = status === 'pending' ? '回答生成中…' : status === 'interrupted' ? '回答中断，未完成' : status === 'cancelled' ? '已取消' : '暂无回答';
          const followUpCount = item.follow_ups?.length ?? 0;
          return <button key={item.id} type="button" data-open-thread aria-label={digest ? `查看对话：${digest}` : '查看对话'} onClick={() => { onOpenThread(item); setMode('thread'); }} className="group block w-full rounded-xl border border-[var(--lm-border)] bg-[var(--lm-surface)] px-3.5 py-3 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-700">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-slate-800 line-clamp-2 dark:text-slate-100">{item.question}</p>
              {status === 'pending' && <span className="mt-1 flex shrink-0 items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />生成中</span>}
              {status === 'interrupted' && <span className="mt-1 shrink-0 text-[11px] font-medium text-rose-500 dark:text-rose-400">已中断</span>}
              {status === 'cancelled' && <span className="mt-1 shrink-0 text-[11px] text-slate-400">已取消</span>}
            </div>
            <p className={`mt-1 text-xs leading-5 line-clamp-2 ${digest ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500'}`}>{digest || fallback}</p>
            {followUpCount > 0 && <p className="mt-1.5 text-[11px] text-slate-400">{followUpCount} 条追问</p>}
          </button>;
        })}</div>}</div>
    <div className="shrink-0"><ChatPanel messages={[]} onSendMessage={sendNew} onClearMessages={onClearMessages} isLoading={isLoading} token={token} pendingImages={pendingImages} onRemovePendingImage={onRemovePendingImage} onClearPendingImages={onClearPendingImages} error={error} thinkingStage={thinkingStage} thinkingStageKey={thinkingStageKey} isThinking={isThinking} compact emptyState={<div className="hidden" />} externalContent={externalContent} onExternalContentConsumed={onExternalContentConsumed} onCancelGeneration={onCancelGeneration} onOpenPhoto={onOpenPhoto} /></div>
  </div>;
}
