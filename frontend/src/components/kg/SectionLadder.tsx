import { useMemo } from 'react';

import type { ChapterCatalogEdge } from '../../catalog/types';
import type { NodeMapResponse } from '../../services/api';
import { LADDER, layoutSineLadder } from '../../utils/ladderLayout';
import NodeGlyph from './NodeGlyph';
import { isProblemType, stripMath } from './shared';

/**
 * 节梯子：核心节点竖向正弦蜿蜒（教材顺序自上而下），题型侧枝挂载，
 * 中性灰 spine 不承载进度语义；核心节点名称全程显示，选中后非邻居变淡。
 * 关系边不在梯子上绘制（交给聚焦子图与岛屿总览）。
 */
export default function SectionLadder({ section, edges, showProblems, selectedId, onSelect }: {
  section: NodeMapResponse['sections'][number];
  edges: ChapterCatalogEdge[];
  showProblems: boolean;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const layout = useMemo(
    () => layoutSineLadder(section.nodes, edges, { showProblems }),
    [section.nodes, edges, showProblems],
  );
  const posById = new Map(layout.positions.map(position => [position.nodeId, position]));
  const nodeById = new Map(section.nodes.map(node => [node.node_id, node]));

  const rel = edges.filter(edge => posById.has(edge.source) && posById.has(edge.target));
  const nb = new Set<string>();
  if (selectedId) rel.forEach(edge => {
    if (edge.source === selectedId) nb.add(edge.target);
    if (edge.target === selectedId) nb.add(edge.source);
  });

  return <section data-testid={`ladder-section-${section.section}`} className="px-2 py-3">
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ width: '100%', height: 'auto', maxWidth: layout.width, display: 'block', margin: '0 auto' }}>
      {layout.coreOrder.slice(0, -1).map((nodeId, index) => {
        const p = posById.get(nodeId);
        const q = posById.get(layout.coreOrder[index + 1]);
        if (!p || !q) return null;
        return <line key={`spine-${nodeId}`} className="kg-spine" x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
      })}
      {layout.twigs.map(twig => {
        const from = posById.get(twig.from);
        const to = posById.get(twig.pc);
        if (!from || !to) return null;
        return <line key={`twig-${twig.pc}`} className="kg-twig" x1={from.x} y1={from.y + 8} x2={to.x} y2={to.y - 2} />;
      })}
      {layout.positions.map(position => {
        const node = nodeById.get(position.nodeId);
        if (!node) return null;
        return <NodeGlyph key={position.nodeId} node={node} x={position.x} y={position.y} selected={position.nodeId === selectedId} neighbor={nb.has(position.nodeId)} onSelect={onSelect} />;
      })}
      {layout.coreOrder.map(nodeId => {
        const node = nodeById.get(nodeId);
        const p = posById.get(nodeId);
        if (!node || !p) return null;
        const right = p.labelSide === 'right';
        const dim = !!selectedId && nodeId !== selectedId && !nb.has(nodeId);
        return <text key={`nm-${nodeId}`} className={`kg-nm kg-dlabel${dim ? ' kg-nm-dim' : ''}`} x={p.x + (right ? 16 : -16)} y={p.y + 4} textAnchor={right ? 'start' : 'end'}>{stripMath(node.name)}</text>;
      })}
      {showProblems && selectedId && (() => {
        const node = nodeById.get(selectedId);
        const p = posById.get(selectedId);
        if (!node || !p || !isProblemType(node.type)) return null;
        const anchor = p.x < LADDER.cx ? 'start' : 'end';
        return <text className="kg-nm kg-dlabel" x={p.x} y={p.y + 20} textAnchor={anchor} fontSize="11">{stripMath(node.name)}</text>;
      })()}
    </svg>
  </section>;
}
