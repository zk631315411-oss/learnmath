/**
 * 提问记录侧栏组件
 *
 * 职责：把某用户的全量提问按页码分组升序展示；点击条目回调 onSelect，由上层负责跳页与加载对话。
 * 桌面端作为左栏常驻列表、移动端作为抽屉内容复用同一组件，宽度与滚动由外层容器控制，本组件不感知形态差异。
 */
import { useEffect, useMemo, useState } from 'react';
import { Camera, Check, Pencil, Trash2, Type, X } from 'lucide-react';

import { updateChatTitle } from '../services/api';
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
  // 删除记录回调（桌面端 hover 行内入口）；不传则不渲染删除按钮
  onDelete?: (item: Marker) => void | Promise<void>;
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

export default function QuestionListPanel({ items, loading, onSelect, onClose, pageSections, onRenamed, onDelete }: Props) {
  const groups = useMemo(() => groupByPage(items), [items]);
  const sectionOf = (page: number) => pageSections?.[String(page)];
  // 正在内联重命名的记录 id 及其草稿文本
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // 删除两击确认：第一击置为待确认（红字"确认删除"），3 秒内第二击执行，超时自动还原
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!pendingDeleteId) return;
    const timer = setTimeout(() => setPendingDeleteId(null), 3000);
    return () => clearTimeout(timer);
  }, [pendingDeleteId]);

  const requestDelete = async (item: Marker) => {
    if (!onDelete) return;
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
        <div className="flex flex-1 items-center justify-center px-3 py-6 text-center text-sm text-slate-400">还没有提问记录</div>
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
              return (
                <div
                  key={item.id}
                  className="group relative flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50"
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
                      <button type="button" onClick={() => onSelect(item)} title={displayTitle} className="min-w-0 flex-1 text-left">
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
                      {onDelete && (pendingDeleteId === item.id ? (
                        <button
                          type="button"
                          onClick={() => void requestDelete(item)}
                          disabled={deleting}
                          aria-label="确认删除对话"
                          className="mt-0.5 shrink-0 rounded bg-red-50 px-1.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 dark:bg-red-900/40 dark:text-red-400 dark:hover:bg-red-900/70"
                        >
                          确认删除
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void requestDelete(item)}
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
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
