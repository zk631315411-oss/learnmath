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

const STEM_TYPES = new Set(['concept', 'theorem', 'formula']);

const isStem = (node: LearningMapNode) => STEM_TYPES.has(node.type?.toLowerCase() ?? '');

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
 * 节内正弦梯子。nodes/edges 均应为节内切片；edges 仅保留签名兼容，
 * 主干布局不依赖边。
 */
export function layoutSineLadder(
  nodes: LearningMapNode[],
  _edges: ChapterCatalogEdge[] = [],
): SectionLadderLayout {
  const stem = [...nodes].filter(isStem).sort(byOrder);

  const positions: GlyphPosition[] = stem.map((node, index) => {
    const x = LADDER.cx + LADDER.amp * Math.sin(index * 0.92);
    const y = LADDER.padTop + index * LADDER.gapY;
    return { nodeId: node.node_id, x, y, labelSide: x >= LADDER.cx ? 'right' : 'left' };
  });

  const height = LADDER.padTop * 2 + Math.max(0, stem.length - 1) * LADDER.gapY + LADDER.bottomPad;

  return {
    width: LADDER.width,
    height,
    positions,
    coreOrder: stem.map(node => node.node_id),
  };
}
