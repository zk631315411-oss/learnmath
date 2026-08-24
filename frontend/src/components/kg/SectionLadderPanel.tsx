import { useState } from 'react';

import type { ChapterCatalogEdge } from '../../catalog/types';
import type { LearningMapNode, NodeMapResponse } from '../../services/api';
import SectionLadder from './SectionLadder';
import NodeFocusCard from './NodeFocusCard';
import { stripMath, typeMeta } from './shared';

/**
 * 节就地展开区（对齐 demo v3）：左侧纯概念梯子 + 右侧聚焦详情卡；
 * 节尾平铺「本节方法·题型」pill（蓝=方法 橙=题型，不上主干），点击同样出详情卡。
 * 主页（MapHome）与地图页（ChapterMapView）共用，保证两处梯子表现一致。
 */
export default function SectionLadderPanel({ chapter, section, edges, onContinueNode }: {
  chapter: string;
  section: NodeMapResponse['sections'][number];
  edges: ChapterCatalogEdge[];
  onContinueNode?: (chapter: string, node: LearningMapNode) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const nodeById = new Map(section.nodes.map(node => [node.node_id, node]));
  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;
  const methods = section.nodes.filter(node => node.type?.toLowerCase() === 'method').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const problems = section.nodes.filter(node => node.type?.toLowerCase() === 'problemclass').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const handleJump = (nodeId: string) => setSelectedId(nodeId);
  const handleStudy = (nodeId: string) => {
    const node = nodeById.get(nodeId);
    if (node && onContinueNode) onContinueNode(chapter, node);
  };

  return <div className="rounded-xl border border-[var(--lm-border)] bg-[var(--lm-surface)]">
    <div className="flex flex-col items-start gap-3 lg:flex-row">
      <div className="min-w-0 flex-1">
        <SectionLadder section={section} edges={edges} selectedId={selectedId} onSelect={handleJump} />
      </div>
      <div className="w-full shrink-0 p-3 lg:sticky lg:top-0 lg:w-[300px]">
        {selected
          ? <NodeFocusCard node={selected} allNodes={section.nodes} edges={edges} onJump={handleJump} onStudy={handleStudy} onClose={() => setSelectedId(null)} />
          : <div className="px-4 py-10 text-center text-[13px] text-[var(--lm-text-muted)]">点击左侧主干节点（圆点或名称文字）<br />看它的前置 / 题型 / 方法</div>}
      </div>
    </div>
    {(methods.length > 0 || problems.length > 0) && <div className="border-t border-[var(--lm-border)] px-3 py-3">
      <p className="mb-2 text-xs text-[var(--lm-text-muted)]">本节方法 · 题型：方法 {methods.length} · 题型 {problems.length}</p>
      <div className="flex flex-wrap gap-2">
        {methods.map(node => <PillTag key={node.node_id} node={node} kind="m" selected={selectedId === node.node_id} onSelect={handleJump} />)}
        {problems.map(node => <PillTag key={node.node_id} node={node} kind="p" selected={selectedId === node.node_id} onSelect={handleJump} />)}
      </div>
    </div>}
  </div>;
}

function PillTag({ node, kind, selected, onSelect }: { node: LearningMapNode; kind: 'm' | 'p'; selected: boolean; onSelect: (nodeId: string) => void }) {
  const color = kind === 'm' ? 'var(--lm-type-method)' : 'var(--lm-type-problem)';
  return <button type="button" onClick={() => onSelect(node.node_id)} title={`${typeMeta(node.type).label} · ${stripMath(node.name)}`}
    className="rounded-full border px-3 py-1 text-xs transition hover:brightness-95"
    style={selected ? { background: color, borderColor: color, color: '#fff' } : { borderColor: color, color, background: 'var(--lm-surface)' }}>
    {stripMath(node.name)}
  </button>;
}
