import type { LearningMapNode } from '../services/api';
import type { ChapterCatalogEdge } from '../catalog/types';

/**
 * E v3 定稿布局（参照 artifacts/kg-map-mockup/gaodai-ch1.html 案例⑦的实际代码）：
 * - 节梯子：核心节点竖向正弦蜿蜒 x = cx + amp·sin(i·0.92)，题型作侧枝挂载
 * - 岛屿总览：整章连通分量，岛内教材序蛇形分行
 * 全部为纯函数，不依赖 DOM，可单测。
 */

export const LADDER = {
  width: 700,
  cx: 350,
  amp: 150,
  gapY: 92,
  padTop: 56,
  twigBase: 54,
  twigStep: 58,
  twigDrop: 30,
} as const;

export const ISLAND = {
  stepX: 110,
  padX: 56,
  padTop: 56,
  padBottom: 56,
  minGapY: 32,
  minWidth: 480,
  relaxIterations: 12,
} as const;

const isProblem = (node: LearningMapNode) => node.type?.toLowerCase() === 'problemclass';

const byOrder = (a: LearningMapNode, b: LearningMapNode) => (a.order ?? 0) - (b.order ?? 0);

export interface GlyphPosition {
  nodeId: string;
  x: number;
  y: number;
  /** 侧枝节点：所挂核心节点 id */
  twigOf?: string;
  /** 名称标签朝向（核心节点用） */
  labelSide: 'left' | 'right';
}

export interface SectionLadderLayout {
  width: number;
  height: number;
  positions: GlyphPosition[];
  coreOrder: string[];
  twigs: Array<{ from: string; pc: string }>;
}

/**
 * 节内正弦梯子。nodes/edges 均应为节内切片（edges 两端都在节内）。
 * showProblems=false 时题型不参与布局（也没有宿主挂载）。
 */
export function layoutSineLadder(
  nodes: LearningMapNode[],
  edges: ChapterCatalogEdge[],
  opts?: { showProblems?: boolean },
): SectionLadderLayout {
  const showProblems = opts?.showProblems ?? true;
  const sorted = [...nodes].sort(byOrder);

  const core = sorted.filter(node => !isProblem(node));
  const problems = showProblems ? sorted.filter(isProblem) : [];
  const coreIndex = new Map<string, number>();
  const positions = new Map<string, GlyphPosition>();

  core.forEach((node, index) => {
    const x = LADDER.cx + LADDER.amp * Math.sin(index * 0.92);
    const y = LADDER.padTop + index * LADDER.gapY;
    positions.set(node.node_id, { nodeId: node.node_id, x, y, labelSide: x >= LADDER.cx ? 'right' : 'left' });
    coreIndex.set(node.node_id, index);
  });

  const twigs: Array<{ from: string; pc: string }> = [];
  if (problems.length > 0 && core.length > 0) {
    // 题型侧枝：挂到它在节内第一条出/入边所连的核心节点；无关系则挂讲授序最近的核心节点
    const byTarget = new Map<string, LearningMapNode[]>();
    problems.forEach(pc => {
      const out = edges.find(edge => edge.source === pc.node_id && coreIndex.has(edge.target));
      const inc = edges.find(edge => edge.target === pc.node_id && coreIndex.has(edge.source));
      let target = out ? out.target : inc ? inc.source : undefined;
      if (!target) {
        let bestDistance = Number.POSITIVE_INFINITY;
        const pcOrder = pc.order ?? 0;
        core.forEach(node => {
          const distance = Math.abs((node.order ?? 0) - pcOrder);
          if (distance < bestDistance) { bestDistance = distance; target = node.node_id; }
        });
      }
      if (!target) return;
      const list = byTarget.get(target) ?? [];
      list.push(pc);
      byTarget.set(target, list);
    });
    byTarget.forEach((list, hostId) => {
      const host = positions.get(hostId);
      if (!host) return;
      const side = host.x >= LADDER.cx ? 1 : -1;
      list.forEach((pc, k) => {
        positions.set(pc.node_id, {
          nodeId: pc.node_id,
          x: host.x + side * (LADDER.twigBase + k * LADDER.twigStep),
          y: host.y + LADDER.twigDrop,
          twigOf: hostId,
          labelSide: host.x + side * (LADDER.twigBase + k * LADDER.twigStep) < LADDER.cx ? 'right' : 'left',
        });
        twigs.push({ from: hostId, pc: pc.node_id });
      });
    });
  }

  const height = Math.max(
    LADDER.padTop * 2,
    LADDER.padTop * 2 + (core.length - 1) * LADDER.gapY + LADDER.twigDrop,
  );
  return {
    width: LADDER.width,
    height,
    positions: [...positions.values()],
    coreOrder: core.map(node => node.node_id),
    twigs,
  };
}

/* ---------- 岛屿总览 ---------- */

export interface IslandNodePosition {
  nodeId: string;
  x: number;
  y: number;
  /** 岛内教材序序号（边弧度用） */
  i: number;
}

export interface IslandLayout {
  memberIds: string[];
  positions: IslandNodePosition[];
  width: number;
  height: number;
}

export interface ChapterIslandsLayout {
  /** 主岛（>1 节点），按岛内最小教材序排序 */
  islands: IslandLayout[];
  /** 孤立点（无任何已连边） */
  singleIds: string[];
}

/**
 * 整章连通分量分岛。nodes 为整章可见节点（调用方先做题型过滤），edges 为章内边。
 * 岛内是真二维布局：横轴钉死教材出现顺序，纵轴用重心松弛迭代向邻居聚拢、自然成团，
 * 最后按纵向最小间距排开防重叠。
 */
export function layoutIslands(nodes: LearningMapNode[], edges: ChapterCatalogEdge[]): ChapterIslandsLayout {
  const sorted = [...nodes].sort(byOrder);
  const seq = new Map<string, number>();
  sorted.forEach((node, index) => seq.set(node.node_id, index));
  const ids = new Set(sorted.map(node => node.node_id));
  const rel = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));

  const parent = new Map<string, string>();
  sorted.forEach(node => parent.set(node.node_id, node.node_id));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== cur) { const next = parent.get(cur)!; parent.set(cur, root); cur = next; }
    return root;
  };
  rel.forEach(edge => {
    const ra = find(edge.source);
    const rb = find(edge.target);
    if (ra !== rb) parent.set(rb, ra);
  });

  const groups = new Map<string, string[]>();
  sorted.forEach(node => {
    const root = find(node.node_id);
    const list = groups.get(root) ?? [];
    list.push(node.node_id);
    groups.set(root, list);
  });

  const components = [...groups.values()].sort(
    (a, b) => Math.min(...a.map(id => seq.get(id) ?? 0)) - Math.min(...b.map(id => seq.get(id) ?? 0)),
  );
  const islands: IslandLayout[] = [];
  const singleIds: string[] = [];

  components.forEach(memberIds => {
    if (memberIds.length === 1) { singleIds.push(memberIds[0]); return; }
    const n = memberIds.length;
    const indexOf = new Map(memberIds.map((id, i) => [id, i]));
    const inset = new Set(memberIds);
    const adjacency = new Map<string, string[]>();
    rel.forEach(edge => {
      if (!inset.has(edge.source) || !inset.has(edge.target)) return;
      adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
      adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
    });

    // 重心松弛：纵坐标向邻居均值靠拢；少量迭代保住局部聚类（迭代过多会摊平成噪声）
    let ys = memberIds.map((_, i) => Math.sin(i * 1.7));
    for (let round = 0; round < ISLAND.relaxIterations; round += 1) {
      ys = memberIds.map((id, i) => {
        const neighbors = adjacency.get(id);
        if (!neighbors || neighbors.length === 0) return ys[i];
        const avg = neighbors.reduce((sum, nid) => sum + ys[indexOf.get(nid)!], 0) / neighbors.length;
        return ys[i] * 0.5 + avg * 0.5;
      });
    }

    // 映射到紧凑纵向带：聚集关系决定相对高低，不强行摊满全高
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const bandH = Math.min(320, Math.max(140, n * 5));
    let py = ys.map(y => ISLAND.padTop + (maxY > minY ? ((y - minY) / (maxY - minY)) * bandH : bandH / 2));

    // 防重叠只需要管横向相邻的节点（标签宽约 90px < stepX）：
    // 单次左→右硬设——右节点沿松弛趋势方向让到 minGapY，一趟保证所有相邻对达标
    for (let i = 0; i + 1 < n; i += 1) {
      const gap = py[i + 1] - py[i];
      if (Math.abs(gap) >= ISLAND.minGapY) continue;
      const dir = ys[i + 1] >= ys[i] ? 1 : -1;
      py[i + 1] = py[i] + dir * ISLAND.minGapY;
    }
    // 归一到顶 padding
    const floor = Math.min(...py);
    py = py.map(y => y - floor + ISLAND.padTop);

    const positions = memberIds.map((nodeId, i) => ({
      nodeId,
      x: ISLAND.padX + i * ISLAND.stepX,
      y: py[i],
      i,
    }));
    islands.push({
      memberIds,
      positions,
      width: Math.max(ISLAND.minWidth, ISLAND.padX * 2 + (n - 1) * ISLAND.stepX),
      height: Math.max(...py) + ISLAND.padBottom,
    });
  });

  return { islands, singleIds };
}

/** 岛内关系边：向两点的上方弯弧，跨度越大弧越高 */
export function islandEdgePath(a: IslandNodePosition, b: IslandNodePosition): string {
  const span = Math.abs(a.i - b.i);
  const bow = Math.min(16 + span * 4, 64);
  const controlY = Math.min(a.y, b.y) - bow;
  return `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${controlY} ${b.x} ${b.y}`;
}
