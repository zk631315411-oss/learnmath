/**
 * 提问记录侧栏组件
 *
 * 职责：把某用户的全量提问按页码分组升序展示；点击条目回调 onSelect，由上层负责跳页与加载对话。
 * 桌面端作为左栏常驻列表、移动端作为抽屉内容复用同一组件，宽度与滚动由外层容器控制，本组件不感知形态差异。
 */
import { useMemo } from 'react';
import { Camera, Type, X } from 'lucide-react';

import type { Marker } from './PageMarker';

interface Props {
  items: Marker[];
  loading: boolean;
  onSelect: (marker: Marker) => void;
  // 抽屉形态下的关闭入口；桌面常驻侧栏不传，则不渲染关闭按钮
  onClose?: () => void;
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

export default function QuestionListPanel({ items, loading, onSelect, onClose }: Props) {
  const groups = useMemo(() => groupByPage(items), [items]);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
        <span className="text-xs font-semibold text-slate-500">提问记录</span>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="关闭提问记录"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
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
          <div key={group.page} className="border-b border-slate-100">
            <div className="bg-slate-50 px-3 py-1.5">
              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-600">第 {group.page} 页</span>
            </div>
            {group.items.map(item => {
              const time = formatTime(item.created_at);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item)}
                  title={item.question}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                >
                  <span className={`mt-0.5 shrink-0 ${item.marker_type === 'screenshot' ? 'text-red-500' : 'text-blue-500'}`}>
                    {item.marker_type === 'screenshot' ? <Camera className="h-4 w-4" /> : <Type className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-700">{item.question}</span>
                    {time && <span className="mt-0.5 block text-xs text-slate-400">{time}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
