import type { ChapterCatalogEdge } from '../../catalog/types';
import type { LearningMapNode } from '../../services/api';
import { islandEdgePath, layoutIslands } from '../../utils/ladderLayout';
import NodeGlyph, { GlyphShape } from './NodeGlyph';
import { sectionTag, stripMath } from './shared';

function IslandName({ name, section, x, y, dim }: { name: string; section: string; x: number; y: number; dim: boolean }) {
  const raw = stripMath(name);
  const shown = raw.length > 8 ? `${raw.slice(0, 8)}…` : raw;
  return <text className={`kg-nm kg-dlabel${dim ? ' kg-nm-dim' : ''}`} x={x} y={y + 16} textAnchor="middle" fontSize="10.5">
    <tspan fill="var(--lm-text-muted)" fontSize="9">{sectionTag(section)}·</tspan>
    {shown}
  </text>;
}

/**
 * 岛屿总览：整章连通分量分岛。岛内蛇形横轴=教材出现顺序（隐藏轴），
 * 同行边上弯弧、跨行边竖向三次曲线；孤立点合并列出。
 * nodes 为整章可见节点（调用方做题型过滤），edges 为章内边。
 */
export default function ChapterIslands({ nodes, edges, selectedId, onSelect }: {
  nodes: LearningMapNode[];
  edges: ChapterCatalogEdge[];
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const nodeById = new Map(nodes.map(node => [node.node_id, node]));
  const ids = new Set(nodes.map(node => node.node_id));
  const rel = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  const layout = layoutIslands(nodes, edges);
  const mainSize = Math.max(0, ...layout.islands.map(island => island.memberIds.length));

  if (layout.islands.length === 0 && layout.singleIds.length === 0) {
    return <div className="mx-4 my-6 rounded-lg border border-dashed border-[var(--lm-border)] px-4 py-10 text-center text-sm text-slate-400">本章暂无可显示的节点。</div>;
  }

  return <div data-testid="chapter-islands">
    {layout.islands.map((island, index) => {
      const inset = new Set(island.memberIds);
      const iedges = rel.filter(edge => inset.has(edge.source) && inset.has(edge.target));
      const posById = new Map(island.positions.map(position => [position.nodeId, position]));
      const secs = [...new Set(island.memberIds.map(id => sectionTag(nodeById.get(id)?.section ?? '')))].join('/');
      const sel = selectedId && inset.has(selectedId) ? selectedId : null;
      const nb = new Set<string>();
      if (sel) iedges.forEach(edge => {
        if (edge.source === sel) nb.add(edge.target);
        if (edge.target === sel) nb.add(edge.source);
      });
      // 降乱：默认只画前置主干（PREREQUISITE_OF）；选中节点时叠加它的一跳出入边
      const visibleEdges = sel
        ? iedges.filter(edge => edge.type === 'PREREQUISITE_OF' || edge.source === sel || edge.target === sel)
        : iedges.filter(edge => edge.type === 'PREREQUISITE_OF');
      return <section key={island.memberIds[0]} className="border-t border-[var(--lm-border)] px-2 py-2 first:border-t-0">
        <div className="px-2 py-0.5 text-xs text-slate-500 dark:text-slate-400">
          岛 {index + 1} · {island.memberIds.length} 节点 · 跨 {secs}{island.memberIds.length === mainSize ? '（本章主干）' : ''} · 横轴=教材出现顺序，纵向按关系聚拢 · 连线只画前置主干，点图形看它的关系
        </div>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${island.width} ${island.height}`} width={island.width} height={island.height} style={{ display: 'block', margin: '0 auto' }}>
            {visibleEdges.map((edge, edgeIndex) => {
              const a = posById.get(edge.source);
              const b = posById.get(edge.target);
              if (!a || !b) return null;
              let cls = 'kg-e-edge';
              if (sel) cls += edge.source === sel ? ' kg-out' : edge.target === sel ? ' kg-in' : ' kg-dim';
              return <path key={`${edge.source}-${edge.target}-${edge.type}-${edgeIndex}`} className={cls} d={islandEdgePath(a, b)}><title>{`${stripMath(nodeById.get(edge.source)?.name ?? '')} → ${stripMath(nodeById.get(edge.target)?.name ?? '')}`}</title></path>;
            })}
            {island.positions.map(position => {
              const node = nodeById.get(position.nodeId);
              if (!node) return null;
              return <g key={position.nodeId}>
                <NodeGlyph node={node} x={position.x} y={position.y} selected={position.nodeId === sel} neighbor={nb.has(position.nodeId)} onSelect={onSelect} />
                <IslandName name={node.name} section={node.section} x={position.x} y={position.y} dim={!!sel && position.nodeId !== sel && !nb.has(position.nodeId)} />
              </g>;
            })}
            <text className="kg-xlab" x={island.width - 8} y={island.height - 6} textAnchor="end">教材出现顺序 → · 纵向按关系聚拢</text>
          </svg>
        </div>
      </section>;
    })}
    {layout.singleIds.length > 0 && <section className="border-t border-[var(--lm-border)] px-2 py-2">
      <div className="px-2 py-0.5 text-xs text-slate-500 dark:text-slate-400">孤立点 ×{layout.singleIds.length}（整章暂无已连关系——多为关系尚未抽取或审核）</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 py-2">
        {layout.singleIds.map(id => {
          const node = nodeById.get(id);
          if (!node) return null;
          return <button key={id} type="button" onClick={() => onSelect(id)} aria-label={`${stripMath(node.name)}，${node.section}`} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            <svg width="16" height="16" viewBox="-9 -9 18 18" aria-hidden="true"><GlyphShape type={node.type} /></svg>
            {stripMath(node.name)}
            <span className="text-[10.5px] text-slate-400">{sectionTag(node.section)}</span>
          </button>;
        })}
      </div>
    </section>}
  </div>;
}
