import { BookOpen, MessageSquareText, X } from 'lucide-react';

import type { ChapterCatalogEdge } from '../../catalog/types';
import type { LearningMapNode } from '../../services/api';
import InlineMathText from '../InlineMathText';
import FocusSubgraph from './FocusSubgraph';
import NodeGlyph from './NodeGlyph';
import { STATUS_LABEL, STATUS_VAR, relLabel, typeMeta } from './shared';

/**
 * 节点详情卡（内联，替代已废弃的 NodeEgoPanel 浮层）：
 * 聚焦子图 + 关系 chips（可点击钻取）+ 跨章「通往」chips + 继续学习/来源提问。
 * edges 为整章边数组；章内邻居可点击，跨章端点显示为不可点 chip。
 */
export default function NodeDetailCard({ node, nodes, edges, onSelect, onClose, onContinueNode, onOpenChat }: {
  node: LearningMapNode;
  nodes: LearningMapNode[];
  edges: ChapterCatalogEdge[];
  onSelect: (nodeId: string) => void;
  onClose: () => void;
  onContinueNode?: (node: LearningMapNode) => void;
  onOpenChat: (chatId: string) => void;
}) {
  const nodeById = new Map(nodes.map(item => [item.node_id, item]));
  const touching = edges.filter(edge => edge.source === node.node_id || edge.target === node.node_id);
  const internal = touching.filter(edge => nodeById.has(edge.source) && nodeById.has(edge.target));
  const cross = touching.filter(edge => !(nodeById.has(edge.source) && nodeById.has(edge.target)));
  const outs = internal.filter(edge => edge.source === node.node_id);
  const ins = internal.filter(edge => edge.target === node.node_id);
  const meta = typeMeta(node.type);
  const continueLabel = node.status === 'needs_review' ? '复习' : node.status === 'unexplored' ? '开始学习' : '继续学习';

  return <section aria-label={`${node.name}详情`} className="relative mx-auto mt-4 w-full max-w-3xl rounded-xl border border-[var(--lm-border)] bg-[var(--lm-bg)] p-4" data-testid="node-detail-card">
    <button type="button" onClick={onClose} className="icon-button absolute right-3 top-3" title="关闭详情" aria-label="关闭详情"><X className="h-4 w-4" /></button>
    <div className="flex flex-wrap items-center gap-2 pr-10">
      <svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true"><NodeGlyph node={node} x={0} y={0} /></svg>
      <span className="text-base font-bold text-slate-800 dark:text-slate-100"><InlineMathText>{node.name}</InlineMathText></span>
      <span className="rounded-full border px-2.5 py-0.5 text-xs" style={{ color: meta.color, borderColor: meta.color }}>{meta.label}</span>
      <span className="rounded-full border px-2.5 py-0.5 text-xs" style={{ color: STATUS_VAR[node.status], borderColor: STATUS_VAR[node.status] }}>{STATUS_LABEL[node.status]}</span>
      {node.blocked && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">可能受阻</span>}
    </div>
    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">所属：<InlineMathText>{node.section}</InlineMathText> · {outs.length} 条出边 · {ins.length} 条入边（整章）</p>

    <div className="mt-3">
      <FocusSubgraph node={node} edges={internal} nodeById={nodeById} onSelect={onSelect} />
      {internal.length === 0 && cross.length === 0 && <div className="rounded-lg border border-dashed border-[var(--lm-border)] px-4 py-5 text-center text-xs text-slate-400">整章范围内暂无已连关系（孤立点）</div>}
    </div>

    <div className="mt-3">
      {outs.map(edge => <button key={`out-${edge.target}-${edge.type}`} type="button" onClick={() => onSelect(edge.target)} className="kg-relchip kg-out">
        {relLabel(edge.type)} → <InlineMathText>{nodeById.get(edge.target)?.name ?? ''}</InlineMathText>
      </button>)}
      {ins.map(edge => <button key={`in-${edge.source}-${edge.type}`} type="button" onClick={() => onSelect(edge.source)} className="kg-relchip kg-in">
        <InlineMathText>{nodeById.get(edge.source)?.name ?? ''}</InlineMathText> → {relLabel(edge.type)}
      </button>)}
      {cross.map((edge, index) => {
        const outgoing = edge.source === node.node_id;
        const chapter = outgoing ? edge.targetChapter : edge.sourceChapter;
        return <span key={`cross-${index}`} className="kg-relchip cursor-default opacity-75" title="跨章关系">
          通往 {chapter || '其他章节'} · {relLabel(edge.type)}
        </span>;
      })}
    </div>

    <div className="mt-4 flex gap-2">
      {onContinueNode && <button type="button" onClick={() => onContinueNode(node)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-4 text-xs font-medium text-white hover:bg-indigo-700"><BookOpen className="h-3.5 w-3.5" />{continueLabel}</button>}
      <button type="button" disabled={!node.chat.available || !node.chat.id} onClick={() => node.chat.id && onOpenChat(node.chat.id)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--lm-border)] px-4 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"><MessageSquareText className="h-3.5 w-3.5" />来源提问</button>
    </div>
  </section>;
}
