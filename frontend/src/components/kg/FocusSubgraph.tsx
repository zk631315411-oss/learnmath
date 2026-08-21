import type { ChapterCatalogEdge } from '../../catalog/types';
import type { LearningMapNode } from '../../services/api';
import NodeGlyph from './NodeGlyph';
import { relLabel, sectionTag, stripMath } from './shared';

const FW = 680;
const LX = 130;
const RX = 550;
const CCX = 340;
const ROW_H = 46;
const PAD_T = 40;

function WrappedName({ name, x, y, anchor }: { name: string; x: number; y: number; anchor: 'start' | 'end' }) {
  if (name.length <= 9) {
    return <text className="kg-nm kg-dlabel" x={x} y={y + 4} textAnchor={anchor} fontSize="11.5">{name}</text>;
  }
  const mid = Math.ceil(name.length / 2);
  return <text className="kg-nm kg-dlabel" textAnchor={anchor} fontSize="11.5">
    <tspan x={x} y={y - 3}>{name.slice(0, mid)}</tspan>
    <tspan x={x} y={y + 11}>{name.slice(mid)}</tspan>
  </text>;
}

/**
 * 三栏聚焦子图：左列「来源·入」（橙）、中选点、右列「去向·出」（紫），
 * 关系词写在贝塞尔流中点；邻居图形可点击继续钻取。
 * edges：整章范围内触及本节点、且两端都在章内的边。
 */
export default function FocusSubgraph({ node, edges, nodeById, onSelect }: {
  node: LearningMapNode;
  edges: ChapterCatalogEdge[];
  nodeById: Map<string, LearningMapNode>;
  onSelect: (nodeId: string) => void;
}) {
  if (edges.length === 0) return null;
  const outs = edges.filter(edge => edge.source === node.node_id);
  const ins = edges.filter(edge => edge.target === node.node_id);
  const rows = Math.max(outs.length, ins.length, 1);
  const FH = PAD_T * 2 + rows * ROW_H;
  const ccy = FH / 2;
  const secPre = (member: LearningMapNode) => member.section === node.section ? '' : `${sectionTag(member.section)}·`;

  const place = (list: ChapterCatalogEdge[], x: number) => list.map((edge, i) => ({
    edge,
    id: edge.source === node.node_id ? edge.target : edge.source,
    x,
    y: PAD_T + ROW_H / 2 + (i + (rows - list.length) / 2) * ROW_H,
  }));

  return <div className="overflow-hidden rounded-lg border border-[var(--lm-border)] bg-[var(--lm-surface)]" data-testid="focus-subgraph">
    <svg viewBox={`0 0 ${FW} ${FH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <text className="kg-focus-lab" x={LX} y="22" textAnchor="middle" fill="var(--lm-edge-in)">← 来源（支撑它）</text>
      <text className="kg-focus-lab" x={RX} y="22" textAnchor="middle" fill="var(--lm-brand)">去向（它支撑）→</text>
      {place(ins, LX).map(({ edge, id, x, y }) => {
        const member = nodeById.get(id);
        if (!member) return null;
        return <g key={`in-${edge.source}-${edge.type}`}>
          <path className="kg-focus-edge kg-in" d={`M ${x + 10} ${y} C ${x + 100} ${y}, ${CCX - 100} ${ccy}, ${CCX - 12} ${ccy}`} />
          <text className="kg-focus-lab" x={(x + CCX) / 2} y={(y + ccy) / 2 - 5} textAnchor="middle" fill="var(--lm-edge-in)">{relLabel(edge.type)}</text>
          <NodeGlyph node={member} x={x} y={y} onSelect={onSelect} />
          <WrappedName name={secPre(member) + stripMath(member.name)} x={x - 13} y={y} anchor="end" />
        </g>;
      })}
      {place(outs, RX).map(({ edge, id, x, y }) => {
        const member = nodeById.get(id);
        if (!member) return null;
        return <g key={`out-${edge.target}-${edge.type}`}>
          <path className="kg-focus-edge kg-out" d={`M ${CCX + 12} ${ccy} C ${CCX + 100} ${ccy}, ${x - 100} ${y}, ${x - 10} ${y}`} />
          <text className="kg-focus-lab" x={(x + CCX) / 2} y={(y + ccy) / 2 - 5} textAnchor="middle" fill="var(--lm-brand)">{relLabel(edge.type)}</text>
          <NodeGlyph node={member} x={x} y={y} onSelect={onSelect} />
          <WrappedName name={secPre(member) + stripMath(member.name)} x={x + 13} y={y} anchor="start" />
        </g>;
      })}
      <g transform={`translate(${CCX} ${ccy}) scale(1.5)`}>
        <NodeGlyph node={node} x={0} y={0} />
      </g>
      <text className="kg-nm kg-dlabel" x={CCX} y={ccy + 30} textAnchor="middle" fontWeight={700}>{stripMath(node.name)}</text>
    </svg>
  </div>;
}
