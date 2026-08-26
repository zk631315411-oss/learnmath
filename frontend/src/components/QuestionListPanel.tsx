/**
 * 提问记录侧栏组件
 *
 * 职责：把某用户的全量提问按页码分组升序展示；点击条目回调 onSelect，由上层负责跳页与加载对话。
 * 桌面端作为左栏常驻列表、移动端作为抽屉内容复用同一组件，宽度与滚动由外层容器控制，本组件不感知形态差异。
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Camera, Check, Pencil, Trash2, Type, X } from 'lucide-react';

import { updateChatTitle } from '../services/api';
import { deleteSwipeOffset, isHorizontalDeleteSwipe, settleDeleteSwipe, MOBILE_DELETE_REVEAL } from '../utils/mobileDelete';
import type { Marker } from './PageMarker';

interface Props {
  items: Marker[];
  loading: boolean;
  onSelect: (marker: Marker) => void;
  // 抽屉形态下的关闭入口；桌面常驻侧栏不传，则不渲染关闭按钮
  onClose?: () => void;
  // 页码 -> 顶级小节号（如 "1.2"）映射；缺失时只显示页码
  pageSections?: Record<string, string>;
  // 自定义标题保存成功后回调，由上层刷新提问记录
  onRenamed?: () => void;
  // 移动端交互与权限回调；桌面端不渲染删除操作
  mobile?: boolean;
  isAnonymous?: boolean;
  onDelete?: (marker: Marker) => void | Promise<void>;
  onRequestAuth?: (mode: 'login' | 'register') => void;
}

// 按页码分组并按页码升序返回；同页内保持传入顺序（后端按 created_at DESC，最新在上）
function groupByPage(items: Marker[]): Array<{ page: number; items: Marker[] }> {
  const groups = new Map<number, Marker[]>();
  for (const item of items) {
    const list = groups.get(item.page_number);
    if (list) list.push(item);
    else groups.set(item.page_number, [item]);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([page, list]) => ({ page, items: list }));
}

// SQLite 的 CURRENT_TIMESTAMP 存 UTC 的 "YYYY-MM-DD HH:MM:SS"，手动补 Z 标记 UTC 再转本地，
// 避免各浏览器对带空格日期字符串解析不一致；解析失败则返回空串（不显示时间）
function formatTime(createdAt?: string | null): string {
  if (!createdAt) return '';
  const date = new Date(createdAt.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function QuestionListPanel({ items, loading, onSelect, onClose, pageSections, onRenamed, mobile = false, isAnonymous = false, onDelete, onRequestAuth }: Props) {
  const groups = useMemo(() => groupByPage(items), [items]);
  const sectionOf = (page: number) => pageSections?.[String(page)];
  // 正在内联重命名的记录 id 及其草稿文本
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [swipeOffsets, setSwipeOffsets] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState<Marker | null>(null);
  const [authPrompt, setAuthPrompt] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const swipeRef = useRef<{ id: string; pointerId: number; startX: number; startY: number; active: boolean } | null>(null);
  const swipeOffsetRef = useRef<Record<string, number>>({});
  // 桌面端保留行内两击确认；移动端使用左滑后的独立确认层。
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!pendingDeleteId) return;
    const timer = setTimeout(() => setPendingDeleteId(null), 3000);
    return () => clearTimeout(timer);
  }, [pendingDeleteId]);

  const requestDesktopDelete = async (item: Marker) => {
    if (!onDelete || mobile) return;
    if (pendingDeleteId !== item.id) {
      setPendingDeleteId(item.id);
      return;
    }
    setPendingDeleteId(null);
    setDeleting(true);
    try {
      await onDelete(item);
    } finally {
      setDeleting(false);
    }
  };

  const startEdit = (item: Marker) => {
    setEditingId(item.id);
    setDraft(item.title ?? item.question);
  };
  const cancelEdit = () => { setEditingId(null); setDraft(''); };
  const commitEdit = async (item: Marker) => {
    const title = draft.trim();
    setSaving(true);
    try {
      await updateChatTitle(item.id, title);
      setEditingId(null);
      setDraft('');
      onRenamed?.();
    } finally {
      setSaving(false);
    }
  };

  const closeSwipe = (id?: string) => {
    const target = id || swipedId;
    if (!target) return;
    swipeOffsetRef.current[target] = 0;
    setSwipeOffsets(previous => ({ ...previous, [target]: 0 }));
    setSwipedId(null);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>, item: Marker) => {
    if (!mobile || event.pointerType !== 'touch' || editingId === item.id) return;
    swipeRef.current = {
      id: item.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>, item: Marker) => {
    const gesture = swipeRef.current;
    if (!gesture || gesture.id !== item.id || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.active) {
      if (!isHorizontalDeleteSwipe(deltaX, deltaY)) {
        if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) swipeRef.current = null;
        return;
      }
      gesture.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    if (swipedId && swipedId !== item.id) closeSwipe(swipedId);
    const offset = deleteSwipeOffset(deltaX);
    setSwipedId(item.id);
    swipeOffsetRef.current[item.id] = offset;
    setSwipeOffsets(previous => ({ ...previous, [item.id]: offset }));
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>, item: Marker) => {
    const gesture = swipeRef.current;
    if (!gesture || gesture.id !== item.id || gesture.pointerId !== event.pointerId) return;
    swipeRef.current = null;
    if (!gesture.active) return;
    const offset = swipeOffsetRef.current[item.id] || 0;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (settleDeleteSwipe(offset) === 'open') {
      setSwipedId(item.id);
      swipeOffsetRef.current[item.id] = MOBILE_DELETE_REVEAL;
      setSwipeOffsets(previous => ({ ...previous, [item.id]: MOBILE_DELETE_REVEAL }));
    } else {
      closeSwipe(item.id);
    }
  };

  const requestDelete = (item: Marker) => {
    closeSwipe(item.id);
    setDeleteError(null);
    if (isAnonymous) {
      setAuthPrompt(true);
      return;
    }
    setConfirming(item);
  };

  const performDelete = async () => {
    if (!confirming || !onDelete || deletingId) return;
    const item = confirming;
    setDeletingId(item.id);
    setDeleteError(null);
    try {
      await onDelete(item);
      setConfirming(null);
    } catch {
      setDeleteError('删除失败，请重试');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-700">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">提问记录</span>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="关闭提问记录"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-6 text-sm text-slate-400">加载中…</div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-6 text-center text-sm text-slate-400">
          <p>还没有提问记录</p>
          <p className="mt-2 text-xs leading-5 text-slate-400">{mobile ? '点击工具栏的“框选”按钮，选中不懂的内容后发起提问。' : '点击“框选”按钮，选中不懂的内容后发起提问。'}</p>
        </div>
      ) : (
        groups.map(group => (
          <div key={group.page} className="border-b border-slate-100 dark:border-slate-800">
            <div className="bg-slate-50 px-3 py-1.5 dark:bg-slate-700/40">
              {(() => {
                const section = sectionOf(group.page);
                return (
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {section ? `${section}节 · ` : ''}第 {group.page} 页
                  </span>
                );
              })()}
            </div>
            {group.items.map(item => {
              const time = formatTime(item.created_at);
              const isEditing = editingId === item.id;
              const displayTitle = (item.title && item.title.trim()) ? item.title : item.question;
              const status = item.generation_status ?? (item.answer ? 'completed' : 'pending');
              const pending = status === 'pending';
              const offset = mobile ? (swipeOffsets[item.id] || 0) : 0;
              return (
                <div key={item.id} className="relative overflow-hidden">
                  {mobile && (
                    <div className="absolute inset-y-0 right-0 flex w-[88px] items-center justify-center bg-rose-600">
                      <button
                        type="button"
                        data-testid="mobile-delete-action"
                        disabled={pending}
                        onClick={() => requestDelete(item)}
                        aria-label={pending ? '回答生成中，完成后可删除' : '删除提问记录'}
                        title={pending ? '回答生成中，完成后可删除' : '删除提问记录'}
                        className="flex h-full w-full items-center justify-center text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                <div
                  data-testid={mobile ? `mobile-question-row-${item.id}` : undefined}
                  data-swipe-offset={mobile ? String(offset) : undefined}
                  className="group relative flex w-full items-start gap-2 bg-[var(--lm-surface)] px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50"
                  style={{ transform: mobile ? `translateX(-${offset}px)` : undefined, touchAction: mobile ? 'pan-y' : undefined }}
                  onPointerDown={event => handlePointerDown(event, item)}
                  onPointerMove={event => handlePointerMove(event, item)}
                  onPointerUp={event => handlePointerEnd(event, item)}
                  onPointerCancel={event => { swipeRef.current = null; closeSwipe(item.id); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                >
                  <span className={`mt-0.5 shrink-0 ${item.marker_type === 'screenshot' ? 'text-red-500' : 'text-indigo-500'}`}>
                    {item.marker_type === 'screenshot' ? <Camera className="h-4 w-4" /> : <Type className="h-4 w-4" />}
                  </span>
                  {isEditing ? (
                    <span className="min-w-0 flex-1">
                      <input
                        autoFocus
                        value={draft}
                        disabled={saving}
                        onChange={event => setDraft(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') void commitEdit(item);
                          if (event.key === 'Escape') cancelEdit();
                        }}
                        placeholder="输入对话主题…"
                        aria-label="重命名对话"
                        className="w-full rounded border border-indigo-300 bg-white px-1.5 py-1 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                      />
                      <span className="mt-1 flex items-center gap-1">
                        <button type="button" disabled={saving} onClick={() => void commitEdit(item)} aria-label="保存标题"
                          className="flex h-6 items-center gap-0.5 rounded px-1.5 text-xs text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-slate-700">
                          <Check className="h-3.5 w-3.5" />保存
                        </button>
                        <button type="button" disabled={saving} onClick={cancelEdit} aria-label="取消重命名"
                          className="flex h-6 items-center rounded px-1.5 text-xs text-slate-400 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700">
                          取消
                        </button>
                      </span>
                    </span>
                  ) : (
                    <>
                      <button type="button" onClick={() => { if (mobile && offset > 0) { closeSwipe(item.id); return; } onSelect(item); }} title={displayTitle} className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-sm text-slate-700 dark:text-slate-200">{displayTitle}</span>
                        {time && <span className="mt-0.5 block text-xs text-slate-400">{time}</span>}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(item)}
                        aria-label="重命名对话"
                        title="重命名对话"
                        className="mt-0.5 shrink-0 rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-500 focus:opacity-100 group-hover:opacity-100 dark:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {!mobile && onDelete && (pendingDeleteId === item.id ? (
                        <button
                          type="button"
                           onClick={() => void requestDesktopDelete(item)}
                          disabled={deleting}
                          aria-label="确认删除对话"
                          className="mt-0.5 shrink-0 rounded bg-red-50 px-1.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 dark:bg-red-900/40 dark:text-red-400 dark:hover:bg-red-900/70"
                        >
                          确认删除
                        </button>
                      ) : (
                        <button
                          type="button"
                           onClick={() => void requestDesktopDelete(item)}
                          aria-label="删除对话"
                          title="删除对话"
                          className="mt-0.5 shrink-0 rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 focus:opacity-100 group-hover:opacity-100 dark:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ))}
                    </>
                  )}
                </div>
                {mobile && offset > 0 && pending && <p className="absolute bottom-1 right-[92px] text-[10px] text-slate-400">回答生成中，完成后可删除</p>}
                </div>
              );
            })}
          </div>
        ))
      )}

      {confirming && (
        <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/30 px-4" role="dialog" aria-modal="true" aria-label="确认删除提问记录">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-2xl dark:bg-slate-800">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">删除这条提问记录？</h2>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">删除后将移除聊天记录和相关动画，但不会删除学习证据、学习进度或学生模型数据。</p>
            {deleteError && <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-300">{deleteError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={Boolean(deletingId)} onClick={() => { setConfirming(null); setDeleteError(null); }} className="rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700">取消</button>
              <button type="button" disabled={Boolean(deletingId)} onClick={() => void performDelete()} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50">{deletingId ? '删除中…' : deleteError ? '重试删除' : '确认删除'}</button>
            </div>
          </div>
        </div>
      )}

      {authPrompt && (
        <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/30 px-4" role="dialog" aria-modal="true" aria-label="登录后删除提问记录">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-2xl dark:bg-slate-800">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">登录后管理提问记录</h2>
            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">登录或注册后即可删除自己的提问记录。</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAuthPrompt(false)} className="rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">暂不</button>
              <button type="button" onClick={() => { setAuthPrompt(false); onRequestAuth?.('register'); }} className="rounded-lg border border-[var(--lm-border)] px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">注册</button>
              <button type="button" onClick={() => { setAuthPrompt(false); onRequestAuth?.('login'); }} className="rounded-lg bg-[var(--lm-brand)] px-3 py-2 text-xs font-medium text-white hover:opacity-90">登录</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
