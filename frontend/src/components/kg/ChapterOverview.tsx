import { useState } from 'react';
import { ChevronRight, Route } from 'lucide-react';

import type { ChapterCatalogEdge } from '../../catalog/types';
import type { LearningMapNode, NodeMapResponse } from '../../services/api';
import InlineMathText from '../InlineMathText';
import { STATUS_LABEL, STATUS_ORDER, STATUS_VAR } from './shared';
import SectionLadder from './SectionLadder';
import NodeDetailCard from './NodeDetailCard';

/**
 * 章总览（地图模式首屏）：节列表 + 五态聚合条 + 关系统计。
 * 点开小节就地展开知识梯子，不再跳转。
 */
export default function ChapterOverview({ data, edges, onOpenIslands, onOpenChat, onContinueNode }: {
  data: NodeMapResponse;
  edges: ChapterCatalogEdge[];
  /** 俯瞰入口：整章岛屿总览 */
  onOpenIslands?: () => void;
  onOpenChat?: (chatId: string) => void;
  onContinueNode?: (node: LearningMapNode) => void;
}) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const nodes = data.sections.flatMap(section => section.nodes);
  const nodeById = new Map(nodes.map(node => [node.node_id, node]));
  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };
  const toggleProblems = () => setShowProblems(value => !value);

  return <div className="mx-auto w-full max-w-3xl px-4 py-4">
    <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">点开小节查看知识梯子；状态条按节内节点占比着色。</p>
    <div className="rounded-xl border border-[var(--lm-border)] bg-[var(--lm-surface)]">
      {data.sections.map((group, index) => {
        const ids = new Set(group.nodes.map(node => node.node_id));
        const edgeCount = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).length;
        const sectionEdges = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
        const counts = new Map<string, number>();
        group.nodes.forEach(node => counts.set(node.status, (counts.get(node.status) ?? 0) + 1));
        const isExpanded = expandedSection === group.section;
        return <div key={group.section} className={`${index > 0 ? 'border-t border-[var(--lm-border)]' : ''}`}>
          <button
            type="button"
            data-testid={`overview-section-${group.section}`}
            onClick={() => toggleSection(group.section)}
            aria-expanded={isExpanded}
            className="group flex w-full flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
          >
            <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} aria-hidden="true" />
            <span className="min-w-0 flex-1 basis-48 truncate text-sm font-medium text-slate-700 group-hover:text-indigo-700 dark:text-slate-200 dark:group-hover:text-indigo-300" title={group.section}><InlineMathText>{group.section}</InlineMathText></span>
            <span className="flex h-2 min-w-28 flex-1 basis-40 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
              {STATUS_ORDER.map(status => {
                const count = counts.get(status) ?? 0;
                if (!count || group.nodes.length === 0) return null;
                return <span key={status} style={{ width: `${(count / group.nodes.length) * 100}%`, background: STATUS_VAR[status] }} title={`${STATUS_LABEL[status]} ${count}`} />;
              })}
            </span>
            <span className="shrink-0 whitespace-nowrap text-xs text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-300">{group.nodes.length} 知识点 · {edgeCount} 关系</span>
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-300 transition-colors group-hover:bg-indigo-50 group-hover:text-indigo-600 dark:text-slate-600 dark:group-hover:bg-indigo-950/40 dark:group-hover:text-indigo-300"><Route className="h-3.5 w-3.5" aria-hidden="true" /></span>
          </button>
          {isExpanded && <div className="px-4 pb-4">
            <div className="mb-2 flex items-center justify-end">
              <button type="button" aria-pressed={showProblems} onClick={toggleProblems} className={`inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-medium transition-colors ${showProblems ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900' : 'border-[var(--lm-border)] text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>显示题型</button>
            </div>
            <SectionLadder section={group} edges={sectionEdges} showProblems={showProblems} selectedId={selectedId} onSelect={setSelectedId} />
            {selectedNode && <div className="mt-4"><NodeDetailCard node={selectedNode} nodes={nodes} edges={edges} onSelect={setSelectedId} onClose={() => setSelectedId(null)} onOpenChat={onOpenChat ?? (() => {})} onContinueNode={onContinueNode} /></div>}
          </div>}
        </div>;
      })}
      {data.sections.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">本章暂无知识点。</div>}
    </div>
    {onOpenIslands && <div className="mt-3 text-center">
      <button type="button" data-testid="open-islands" onClick={onOpenIslands} className="text-xs text-slate-400 underline-offset-4 transition-colors hover:text-indigo-600 hover:underline dark:hover:text-indigo-300">俯瞰整章结构（岛屿总览）→</button>
    </div>}
  </div>;
}
