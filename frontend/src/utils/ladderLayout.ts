import type { LearningMapNode } from '../services/api';
import type { ChapterCatalogEdge } from '../catalog/types';

/**
 * 节梯子布局：核心节点竖向正弦蜿蜒 x = cx + amp·sin(i·0.92)，侧枝贴宿主凹位。
 * 纯函数，不依赖 DOM，可单测。
 *
 * 方案（对齐 design-demos/map-home/ladder-concave-demo.html）：
 * - 主干节点标签固定放凸侧（远离 cx 一侧），不做碰撞；
 * - 侧枝 glyph 放宿主凹侧（朝向 cx 一侧），同宿主侧枝竖向依次排开；
 * - 侧枝标签默认在 glyph 更凹一侧（pill 底板），若 pill 盒跨过该 y 处主干斜线
 *   则翻转到凸侧并画引线；
 * - 侧枝标签间竖向防重叠：水平区间重叠且 y 间距 <30 的下推。
 */

export const LADDER = {
  width: 760,
  cx: 350,
  amp: 150,
  gapY: 92,
  padTop: 56,
  twigOff: 52,
  twigDrop: 14,
  twigLabelGap: 56,
  flipOff: 70,
  bottomPad: 140,
} as const;

/** 侧枝标签估算参数。依据：13px 中文真实字宽≈14（含字距），宁宽勿窄防 pill 包不住字。 */
export const LABEL = {
  font: 13,
  cjk: 14,
  ascii: 7.5,
  padding: 16, // pill 左右各 8
  pillHeight: 22,
  pillPad: 8,  // pill 单边内边距
  gap: 13 + 12, // glyph 含角标外缘 gx+13，再留 12
} as const;

const STEM_TYPES = new Set(['concept', 'theorem', 'formula']);
const LEAF_TYPES = new Set(['method', 'problemclass', 'knowledgegroup', 'outcome', 'rulecase', 'conditionexpression']);

const isStem = (node: LearningMapNode) => STEM_TYPES.has(node.type?.toLowerCase() ?? '');
const isLeaf = (node: LearningMapNode) => LEAF_TYPES.has(node.type?.toLowerCase() ?? '');

const byOrder = (a: LearningMapNode, b: LearningMapNode) => (a.order ?? 0) - (b.order ?? 0);

const CJK_RE = /[㐀-鿿豈-﫿ﹰ-￮]/;

/** 文字净宽估算（不含 padding）：CJK 14px/字，ASCII 7.5px/字。 */
export function textWidth(name: string): number {
  let width = 0;
  for (const ch of name) width += CJK_RE.test(ch) ? LABEL.cjk : LABEL.ascii;
  return width;
}

export interface TwigLead {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GlyphPosition {
  nodeId: string;
  x: number;
  y: number;
  /** 侧枝节点：所挂核心节点 id */
  twigOf?: string;
  /** 名称标签朝向（核心节点用） */
  labelSide: 'left' | 'right';
  /** 侧枝节点：标签文本锚点 x */
  labelTx?: number;
  /** 侧枝节点：标签文本锚点（'start' 左对齐 / 'end' 右对齐） */
  labelAnchor?: 'start' | 'end';
  /** 侧枝节点：文字净宽（不含 pill 内边距） */
  labelW?: number;
  /** 侧枝节点：标签文本中心 y（防重叠下推后） */
  labelY?: number;
  /** 侧枝节点：压主干线翻转后从 glyph 到 pill 边缘的引线 */
  lead?: TwigLead;
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
 *
 * 侧枝过滤优先级：
 * 1. 若传入 leafTypes，只保留该集合中的类型（类型比较仍转小写）。
 * 2. 否则沿用 showProblems 布尔语义：false 时全部侧枝都不参与布局；true 时全部侧枝参与布局。
 */
export function layoutSineLadder(
  nodes: LearningMapNode[],
  edges: ChapterCatalogEdge[],
  opts?: { showProblems?: boolean; leafTypes?: Set<string> },
): SectionLadderLayout {
  const showProblems = opts?.showProblems ?? true;
  const leafTypes = opts?.leafTypes;
  const sorted = [...nodes].sort(byOrder);

  const stem = sorted.filter(isStem);
  const leaves = leafTypes
    ? sorted.filter(node => leafTypes.has(node.type?.toLowerCase() ?? ''))
    : showProblems
      ? sorted.filter(isLeaf)
      : [];
  const stemIndex = new Map<string, number>();
  const positions = new Map<string, GlyphPosition>();
  const names = new Map<string, string>();

  sorted.forEach(node => names.set(node.node_id, node.name));

  stem.forEach((node, index) => {
    const x = LADDER.cx + LADDER.amp * Math.sin(index * 0.92);
    const y = LADDER.padTop + index * LADDER.gapY;
    positions.set(node.node_id, { nodeId: node.node_id, x, y, labelSide: x >= LADDER.cx ? 'right' : 'left' });
    stemIndex.set(node.node_id, index);
  });

  // 主干点 x 随 y 的折线（用于压线检测）：主干是相邻节点连线
  const stemPoints = stem
    .map(node => positions.get(node.node_id))
    .filter((p): p is GlyphPosition => !!p);
  const stemXAt = (y: number): number => {
    if (stemPoints.length === 0) return LADDER.cx;
    if (y <= stemPoints[0]!.y) return stemPoints[0]!.x;
    for (let i = 0; i < stemPoints.length - 1; i++) {
      const a = stemPoints[i]!;
      const b = stemPoints[i + 1]!;
      if (y >= a.y && y <= b.y) {
        const t = (y - a.y) / (b.y - a.y || 1);
        return a.x + (b.x - a.x) * t;
      }
    }
    return stemPoints[stemPoints.length - 1]!.x;
  };

  const twigs: Array<{ from: string; pc: string }> = [];
  const byTarget = new Map<string, LearningMapNode[]>();
  if (leaves.length > 0 && stem.length > 0) {
    // 侧枝挂宿主：第一条出/入边所连的核心节点；无关系则挂讲授序最近的核心节点
    leaves.forEach(pc => {
      const out = edges.find(edge => edge.source === pc.node_id && stemIndex.has(edge.target));
      const inc = edges.find(edge => edge.target === pc.node_id && stemIndex.has(edge.source));
      let target = out ? out.target : inc ? inc.source : undefined;
      if (!target) {
        let bestDistance = Number.POSITIVE_INFINITY;
        const pcOrder = pc.order ?? 0;
        stem.forEach(node => {
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
      const mainDir = host.x >= LADDER.cx ? 1 : -1; // 主干标签侧（凸侧）
      const concave = -mainDir; // 凹侧
      list.forEach((pc, k) => {
        const gy = host.y + LADDER.twigDrop + k * LADDER.twigLabelGap;
        const gx = host.x + concave * LADDER.twigOff;
        const w = textWidth(names.get(pc.node_id) ?? pc.node_id);

        // 标签默认在 glyph 更凹一侧，pill 与 glyph 角标外缘留 LABEL.gap
        let anchor: 'start' | 'end' = concave < 0 ? 'end' : 'start';
        let tx = concave < 0 ? gx - LABEL.gap : gx + LABEL.gap;

        // 压线检测：pill 盒（含 8 内边距）是否跨过该 y 处主干斜线（±14）
        const sx = stemXAt(gy);
        const boxL = (anchor === 'start' ? tx : tx - w) - LABEL.pillPad;
        const boxR = (anchor === 'start' ? tx + w : tx) + LABEL.pillPad;
        const cross = Math.min(boxL, boxR) <= sx + 14 && Math.max(boxL, boxR) >= sx - 14;

        let lead: TwigLead | undefined;
        if (cross) {
          // 翻转到凸侧，用引线拉出去
          anchor = mainDir < 0 ? 'end' : 'start';
          tx = host.x + mainDir * (LADDER.twigOff + LADDER.flipOff);
          lead = { x1: gx, y1: gy, x2: anchor === 'start' ? tx - LABEL.pillPad : tx + LABEL.pillPad, y2: gy };
        }

        positions.set(pc.node_id, {
          nodeId: pc.node_id,
          x: gx,
          y: gy,
          twigOf: hostId,
          labelSide: mainDir > 0 ? 'right' : 'left',
          labelTx: tx,
          labelAnchor: anchor,
          labelW: w,
          labelY: gy,
          lead,
        });
        twigs.push({ from: hostId, pc: pc.node_id });
      });
    });
  }

  // 侧枝标签竖向防重叠：水平区间重叠（含 8px 余量）且 y 间距 <30 的下推
  const twigLabels = [...positions.values()]
    .filter(p => p.twigOf && p.labelTx != null && p.labelW != null && p.labelY != null)
    .sort((a, b) => a.labelY! - b.labelY!);
  const hSpan = (p: GlyphPosition): [number, number] =>
    p.labelAnchor === 'start' ? [p.labelTx!, p.labelTx! + p.labelW!] : [p.labelTx! - p.labelW!, p.labelTx!];
  for (let i = 1; i < twigLabels.length; i++) {
    const prev = twigLabels[i - 1]!;
    const curr = twigLabels[i]!;
    const [pl, pr] = hSpan(prev);
    const [cl, cr] = hSpan(curr);
    if (cl < pr + 8 && cr > pl - 8 && curr.labelY! - prev.labelY! < 30) {
      curr.labelY = prev.labelY! + 30;
    }
  }

  const baseBottom = LADDER.padTop * 2 + (stem.length - 1) * LADDER.gapY + LADDER.bottomPad;
  let maxTwigBottom = 0;
  twigLabels.forEach(p => {
    maxTwigBottom = Math.max(maxTwigBottom, p.labelY! + LABEL.pillHeight / 2 + 24);
  });
  const height = Math.max(baseBottom, maxTwigBottom);

  return {
    width: LADDER.width,
    height,
    positions: [...positions.values()],
    coreOrder: stem.map(node => node.node_id),
    twigs,
  };
}
