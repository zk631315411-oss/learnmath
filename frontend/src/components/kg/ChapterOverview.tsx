import { ChevronRight } from 'lucide-react';

import type { ChapterCatalogEdge } from '../../catalog/types';
import type { NodeMapResponse } from '../../services/api';
import InlineMathText from '../InlineMathText';
import { STATUS_LABEL, STATUS_ORDER, STATUS_VAR } from './shared';

/**
 * 章总览（地图模式首屏）：节列表 + 五态聚合条 + 关系统计。
 * 不画图——图在点开小节后才出现。
 */
export default function ChapterOverview({ data, edges, onOpenSection }: {
  data: NodeMapResponse;
  edges: ChapterCatalogEdge[];
  onOpenSection: (section: string) => void;
}) {
  return <div className="mx-auto w-full max-w-3xl px-4 py-4">
    <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">点开小节查看知识梯子；状态条按节内节点占比着色。</p>
    <div className="rounded-xl border border-[var(--lm-border)] bg-[var(--lm-surface)]">
      {data.sections.map((group, index) => {
        const ids = new Set(group.nodes.map(node => node.node_id));
        const edgeCount = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).length;
        const counts = new Map<string, number>();
        group.nodes.forEach(node => counts.set(node.status, (counts.get(node.status) ?? 0) + 1));
        return <button
          key={group.section}
          type="button"
          data-testid={`overview-section-${group.section}`}
          onClick={() => onOpenSection(group.section)}
          className={`group flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 ${index > 0 ? 'border-t border-[var(--lm-border)]' : ''}`}
        >
          <span className="min-w-0 flex-1 basis-48 truncate text-sm font-medium text-slate-700 dark:text-slate-200" title={group.section}><InlineMathText>{group.section}</InlineMathText></span>
          <span className="flex h-2 min-w-28 flex-1 basis-40 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
            {STATUS_ORDER.map(status => {
              const count = counts.get(status) ?? 0;
              if (!count || group.nodes.length === 0) return null;
              return <span key={status} style={{ width: `${(count / group.nodes.length) * 100}%`, background: STATUS_VAR[status] }} title={`${STATUS_LABEL[status]} ${count}`} />;
            })}
          </span>
          <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">{group.nodes.length} 知识点 · {edgeCount} 关系</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-indigo-500 dark:text-slate-600" aria-hidden="true" />
        </button>;
      })}
      {data.sections.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">本章暂无知识点。</div>}
    </div>
  </div>;
}
