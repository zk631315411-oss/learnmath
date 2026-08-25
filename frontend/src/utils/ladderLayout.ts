import type { LearningMapNode } from '../services/api';
import type { ChapterCatalogEdge } from '../catalog/types';

/**
 * 节梯子布局（纯概念梯子）：主干只放 Concept/Theorem/Formula，
 * 按教材 order 自上而下，x = cx + amp·sin(i·0.92) 正弦蜿蜒。
 * Method/ProblemClass 不上主干（下放到聚焦详情卡与节尾清单区），
 * 传入也不参与布局。纯函数，不依赖 DOM，可单测。
 */

export const LADDER = {
  width: 700,
  cx: 350,
  amp: 150,
  gapY: 92,
  padTop: 56,
  bottomPad: 60,
} as const;

/** 整章全景用的紧凑间距：gapY 收紧，减少整章串联后的总长度。 */
export const COMPACT_GAP_Y = 72;

const STEM_TYPES = new Set(['concept', 'theorem', 'formula']);

const isStem = (node: LearningMapNode) => STEM_TYPES.has(node.type?.toLowerCase() ?? '');

/**
 * 记法公式不该单独上主干。判断只依据 KG 边的语义，不靠名字猜：
 *  - Concept --HAS_PROPERTY--> Formula：公式是概念的记法/属性（如「当 x→+∞ 时函数的极限」的记法公式）。
 *  - Formula --GETS--> Concept：公式定义/得到该概念（如 左导数公式→左导数、导函数公式→导函数）。
 * 这两类公式是对应概念的「另一半」，收进详情卡，而非在梯子上单占一个点。
 *
 * 明确不合并的边（语义不是「记法」）：
 *  - Formula --DERIVES--> X：公式推导出 X（X 常是另一个概念/定理，如 切线关系式→导数的几何意义）。
 *  - Formula --PART_OF--> X：公式是某规则组/方法的成员，不是记法。
 *  - 定理↔其公式（如 拉格朗日中值定理↔拉格朗日中值公式）KG 未建边，前端不合并（B 类，待数据侧补边）。
 */

/**
 * 某节点的记法公式：通过 HAS_PROPERTY / GETS 边与本节点相连的 Formula。
 * 供详情卡展示用；与 collectNotationFormulaIds 的判定保持一致（同一套边规则）。
 */
export function getNotationFormulas(
  node: LearningMapNode,
  allNodes: LearningMapNode[],
  edges: ChapterCatalogEdge[],
): LearningMapNode[] {
  const byId = new Map(allNodes.map(n => [n.node_id, n]));
  const result = new Map<string, LearningMapNode>();
  edges.forEach(edge => {
    // Concept --HAS_PROPERTY--> Formula
    if (edge.type === 'HAS_PROPERTY' && edge.source === node.node_id) {
      const f = byId.get(edge.target);
      if (f?.type?.toLowerCase() === 'formula') result.set(f.node_id, f);
    }
    // Formula --GETS--> Concept
    if (edge.type === 'GETS' && edge.target === node.node_id) {
      const f = byId.get(edge.source);
      if (f?.type?.toLowerCase() === 'formula') result.set(f.node_id, f);
    }
  });
  return [...result.values()];
}

const collectNotationFormulaIds = (nodes: LearningMapNode[], edges: ChapterCatalogEdge[]): Set<string> => {
  const result = new Set<string>();

  const conceptOrTheoremIds = new Set(
    nodes.filter(n => ['concept', 'theorem'].includes(n.type?.toLowerCase() ?? '')).map(n => n.node_id),
  );

  edges.forEach(edge => {
    // Concept --HAS_PROPERTY--> Formula（公式是概念的记法/属性）
    if (edge.type === 'HAS_PROPERTY' && conceptOrTheoremIds.has(edge.source)) {
      const target = nodes.find(n => n.node_id === edge.target);
      if (target?.type?.toLowerCase() === 'formula') result.add(edge.target);
    }
    // Formula --GETS--> Concept/Theorem（公式定义/得到该概念）
    if (edge.type === 'GETS') {
      const source = nodes.find(n => n.node_id === edge.source);
      if (source?.type?.toLowerCase() === 'formula' && conceptOrTheoremIds.has(edge.target)) {
        result.add(edge.source);
      }
    }
  });

  return result;
};

const byOrder = (a: LearningMapNode, b: LearningMapNode) => (a.order ?? 0) - (b.order ?? 0);

export interface GlyphPosition {
  nodeId: string;
  x: number;
  y: number;
  /** 名称标签朝向：凸侧（远离 cx 一侧） */
  labelSide: 'left' | 'right';
}

export interface SectionLadderLayout {
  width: number;
  height: number;
  positions: GlyphPosition[];
  coreOrder: string[];
}

/**
 * 节内正弦梯子。nodes/edges 均应为节内切片；edges 用于剔除「记法公式」
 * （作为某 Concept 的 HAS_PROPERTY 目标、或经 GETS 边定义某 Concept/Theorem 的 Formula 不上主干）。
 */
export function layoutSineLadder(
  nodes: LearningMapNode[],
  edges: ChapterCatalogEdge[] = [],
  gapY: number = LADDER.gapY,
): SectionLadderLayout {
  const notationIds = collectNotationFormulaIds(nodes, edges);
  const stem = [...nodes].filter(node => isStem(node) && !notationIds.has(node.node_id)).sort(byOrder);

  const positions: GlyphPosition[] = stem.map((node, index) => {
    const x = LADDER.cx + LADDER.amp * Math.sin(index * 0.92);
    const y = LADDER.padTop + index * gapY;
    return { nodeId: node.node_id, x, y, labelSide: x >= LADDER.cx ? 'right' : 'left' };
  });

  const height = LADDER.padTop * 2 + Math.max(0, stem.length - 1) * gapY + LADDER.bottomPad;

  return {
    width: LADDER.width,
    height,
    positions,
    coreOrder: stem.map(node => node.node_id),
  };
}
