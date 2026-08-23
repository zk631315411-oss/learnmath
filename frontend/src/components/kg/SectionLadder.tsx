import { useMemo } from 'react';

import type { ChapterCatalogEdge } from '../../catalog/types';
import type { NodeMapResponse } from '../../services/api';
import { LADDER, layoutSineLadder } from '../../utils/ladderLayout';
import NodeGlyph from './NodeGlyph';
import { stripMath } from './shared';

/**
 * 节梯子（纯概念梯子）：主干只放 Concept/Theorem/Formula，按教材顺序自上而下
 * 正弦蜿蜒；Method/ProblemClass 不上主干（下放聚焦详情卡与节尾清单）。
 * glyph + 名称文字是同一个命中区，点击 onSelect；选中后非相关节点变淡。
 */
export default function SectionLadder({ section, edges = [], selectedId, onSelect }: {
  section: NodeMapResponse['sections'][number];
  edges?: ChapterCatalogEdge[];
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const layout = useMemo(() => layoutSineLadder(section.nodes, edges), [section.nodes, edges]);
  const posById = new Map(layout.positions.map(position => [position.nodeId, position]));
  const nodeById = new Map(section.nodes.map(node => [node.node_id, node]));

  // 相关集合 = 选中节点 + 边直连邻居（用于非相关变淡）
  const rel = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set<string>([selectedId]);
    edges.forEach(edge => {
      if (edge.source === selectedId) set.add(edge.target);
      if (edge.target === selectedId) set.add(edge.source);
    });
    return set;
  }, [edges, selectedId]);

  return <section data-testid={`ladder-section-${section.section}`} className="px-2 py-3">
    <div className="mb-1 text-xs font-medium text-[var(--lm-text-muted)]">本节讲授顺序 · 共 {layout.coreOrder.length} 个知识点</div>
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ width: '100%', height: 'auto', maxWidth: layout.width, display: 'block', margin: '0 auto' }}>
      {layout.coreOrder.slice(0, -1).map((nodeId, index) => {
        const p = posById.get(nodeId);
        const q = posById.get(layout.coreOrder[index + 1]);
        if (!p || !q) return null;
        return <line key={`spine-${nodeId}`} className="kg-spine" x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
      })}
      {layout.coreOrder.map(nodeId => {
        const node = nodeById.get(nodeId);
        const p = posById.get(nodeId);
        if (!node || !p) return null;
        const right = p.labelSide === 'right';
        const dim = !!rel && !rel.has(nodeId);
        const tx = p.x + (right ? 18 : -18);
        return <g
          key={nodeId}
          className={`kg-node${dim ? ' kg-dim' : ''}`}
          role="button"
          tabIndex={-1}
          aria-label={stripMath(node.name)}
          onClick={() => onSelect(nodeId)}
        >
          <NodeGlyph node={node} x={p.x} y={p.y} selected={nodeId === selectedId} />
          <text className="kg-nm kg-dlabel" x={tx} y={p.y + 4} textAnchor={right ? 'start' : 'end'}>{stripMath(node.name)}</text>
        </g>;
      })}
    </svg>
  </section>;
}
