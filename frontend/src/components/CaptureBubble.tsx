import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle2, GripHorizontal, LoaderCircle, PanelRightOpen, Send, X } from 'lucide-react';

import MarkdownRenderer from './MarkdownRenderer';
import type { Marker } from './PageMarker';
import type { CropBBox, Message } from '../types';
import type { SendMessageOptions } from '../hooks/useChat';

export interface CaptureDraft {
  image: string;
  cropBBox: CropBBox;
  page: number;
}

interface Props {
  capture: CaptureDraft;
  mobile: boolean;
  messages: Message[];
  isLoading: boolean;
  error?: string | null;
  thinkingStage?: string;
  thinkingStageKey?: string;
  onSend: (content: string, options?: SendMessageOptions) => Promise<Marker | null>;
  onClose: () => void;
  onExpand: (marker: Marker) => void;
}

type BubbleState = 'draft' | 'streaming' | 'complete';
type RatioPosition = { x: number; y: number };

const BUBBLE_WIDTH = 344;
const EDGE_GAP = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export default function CaptureBubble({ capture, mobile, messages, isLoading, error, thinkingStage, thinkingStageKey, onSend, onClose, onExpand }: Props) {
  const [state, setState] = useState<BubbleState>('draft');
  const [input, setInput] = useState('');
  const [marker, setMarker] = useState<Marker | null>(null);
  const [parentSize, setParentSize] = useState({ width: 0, height: 0 });
  const [bubbleHeight, setBubbleHeight] = useState(300);
  const [dragPosition, setDragPosition] = useState<RatioPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);
  const assistant = [...messages].reverse().find(message => message.role === 'assistant');

  useLayoutEffect(() => {
    const parent = rootRef.current?.parentElement;
    const bubble = bubbleRef.current;
    if (!parent || !bubble || mobile) return;
    const update = () => {
      setParentSize({ width: parent.clientWidth, height: parent.clientHeight });
      setBubbleHeight(bubble.offsetHeight || 300);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    observer.observe(bubble);
    return () => observer.disconnect();
  }, [mobile, state]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || state === 'streaming') return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, state]);

  const defaultPosition = (): RatioPosition => {
    const { width, height } = parentSize;
    if (!width || !height) return { x: 0, y: 0 };
    const box = capture.cropBBox;
    const selectionLeft = box.x * width;
    const selectionRight = (box.x + box.width) * width;
    const selectionTop = box.y * height;
    const selectionBottom = (box.y + box.height) * height;
    let left = selectionRight + EDGE_GAP;
    let top = selectionTop;

    if (left + BUBBLE_WIDTH > width - EDGE_GAP) left = selectionLeft - BUBBLE_WIDTH - EDGE_GAP;
    if (left < EDGE_GAP) {
      left = clamp(selectionLeft, EDGE_GAP, Math.max(EDGE_GAP, width - BUBBLE_WIDTH - EDGE_GAP));
      top = selectionBottom + EDGE_GAP;
      if (top + bubbleHeight > height - EDGE_GAP) top = selectionTop - bubbleHeight - EDGE_GAP;
    }
    left = clamp(left, EDGE_GAP, Math.max(EDGE_GAP, width - BUBBLE_WIDTH - EDGE_GAP));
    top = clamp(top, EDGE_GAP, Math.max(EDGE_GAP, height - bubbleHeight - EDGE_GAP));
    return { x: left / width, y: top / height };
  };

  const position = dragPosition || defaultPosition();
  const left = parentSize.width ? position.x * parentSize.width : 0;
  const top = parentSize.height ? position.y * parentSize.height : 0;

  const submit = async () => {
    const question = input.trim();
    if (!question || state === 'streaming' || isLoading) return;
    const firstQuestion = state === 'draft';
    setInput('');
    setState('streaming');
    const result = await onSend(question, firstQuestion
      ? { newThread: true, capture: { image: capture.image, cropBBox: capture.cropBBox } }
      : undefined);
    if (result) setMarker(result);
    setState('complete');
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mobile || !bubbleRef.current || (event.target as HTMLElement).closest('button')) return;
    const rect = bubbleRef.current.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const parent = rootRef.current?.parentElement?.getBoundingClientRect();
    if (!drag || !parent || drag.pointerId !== event.pointerId) return;
    const nextLeft = clamp(event.clientX - parent.left - drag.dx, EDGE_GAP, Math.max(EDGE_GAP, parent.width - BUBBLE_WIDTH - EDGE_GAP));
    const nextTop = clamp(event.clientY - parent.top - drag.dy, EDGE_GAP, Math.max(EDGE_GAP, parent.height - bubbleHeight - EDGE_GAP));
    setDragPosition({ x: nextLeft / parent.width, y: nextTop / parent.height });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const close = () => {
    if (state !== 'streaming') onClose();
  };

  const card = (
    <div
      ref={bubbleRef}
      data-testid="capture-bubble"
      data-state={state}
      role="dialog"
      aria-modal="true"
      aria-label="框选提问"
      className={`${mobile ? 'w-full rounded-t-2xl' : 'w-[344px] rounded-xl'} flex max-h-[60dvh] flex-col overflow-hidden border border-indigo-100 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.24)] dark:border-slate-700 dark:bg-slate-900`}
      style={mobile ? undefined : { position: 'absolute', left, top }}
      onPointerDown={event => event.stopPropagation()}
    >
      <div
        className={`flex h-11 shrink-0 items-center gap-2 border-b border-slate-200 px-3 dark:border-slate-700 ${mobile ? '' : 'cursor-move touch-none'}`}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <GripHorizontal className="h-4 w-4 text-slate-400" />
        <span className="min-w-0 flex-1 text-sm font-semibold text-slate-700 dark:text-slate-100">框选提问</span>
        {state === 'streaming' && <span className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-300"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />{thinkingStageKey === 'evidence_report' ? '记录中' : '回答中'}</span>}
        {state === 'complete' && <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />已保存</span>}
        <button type="button" onPointerDown={event => event.stopPropagation()} onClick={close} disabled={state === 'streaming'} className="icon-button" title={state === 'streaming' ? '回答完成后可关闭' : '关闭'} aria-label="关闭框选提问"><X className="h-4 w-4" /></button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <img src={capture.image} alt="框选内容" className="h-24 w-full rounded-lg border border-slate-200 object-cover object-top dark:border-slate-700" />
        {state !== 'draft' && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {assistant?.content ? <><MarkdownRenderer className="markdown-body text-sm">{assistant.content}</MarkdownRenderer>{thinkingStageKey === 'evidence_report' && <div data-testid="capture-evidence-report-status" className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-700"><LoaderCircle className="h-4 w-4 animate-spin text-indigo-500" />{thinkingStage}</div>}</> : <div className="flex items-center gap-2 text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin text-indigo-500" />{thinkingStage || '正在准备回答…'}</div>}
          </div>
        )}
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}
      </div>

      <form onSubmit={event => { event.preventDefault(); void submit(); }} className="shrink-0 border-t border-slate-200 p-3 dark:border-slate-700">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            disabled={state === 'streaming'}
            rows={2}
            autoFocus
            placeholder={state === 'complete' ? '继续追问…' : '想问什么？'}
            className="min-h-[44px] min-w-0 flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-900"
          />
          <button type="submit" disabled={!input.trim() || state === 'streaming' || isLoading} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="发送" title="发送"><Send className="h-4 w-4" /></button>
        </div>
        {state === 'complete' && marker && <button type="button" onPointerDown={event => event.stopPropagation()} onClick={() => onExpand(marker)} className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40"><PanelRightOpen className="h-4 w-4" />在右栏展开</button>}
      </form>
    </div>
  );

  if (mobile) {
    return <div ref={rootRef} className="fixed inset-0 z-[130] flex items-end bg-slate-950/35" onPointerDown={close}>{card}</div>;
  }
  return <div ref={rootRef} className="absolute inset-0 z-[70]" onPointerDown={close}>{card}</div>;
}
