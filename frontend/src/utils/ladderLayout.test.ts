import { describe, expect, it } from 'vitest';
import { LADDER, LABEL, layoutSineLadder, textWidth } from './ladderLayout';
import type { GlyphPosition } from './ladderLayout';
import type { LearningMapNode } from '../services/api';

const node = (id: string, order: number, type = 'Concept'): LearningMapNode => ({
  node_id: id, name: id, section: '1.1', type, order,
  status: 'unexplored', closed_evidence_count: 0, blocked: false, chat: { id: null, available: false },
});

/** 主干折线在 y 处的 x（相邻主干点线性插值），与布局实现同算法。 */
function stemXAt(stemPositions: GlyphPosition[], y: number): number {
  const pts = [...stemPositions].sort((a, b) => a.y - b.y);
  if (pts.length === 0) return LADDER.cx;
  if (y <= pts[0]!.y) return pts[0]!.x;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (y >= a.y && y <= b.y) {
      const t = (y - a.y) / (b.y - a.y || 1);
      return a.x + (b.x - a.x) * t;
    }
  }
  return pts[pts.length - 1]!.x;
}

/** 侧枝 pill 盒（含 8px 内边距）。 */
function pillBox(p: GlyphPosition) {
  const textL = p.labelAnchor === 'start' ? p.labelTx! : p.labelTx! - p.labelW!;
  return { x1: textL - LABEL.pillPad, y1: p.labelY! - LABEL.pillHeight / 2 - 1, x2: textL + p.labelW! + LABEL.pillPad, y2: p.labelY! + LABEL.pillHeight / 2 + 1 };
}

/** 搭一个正弦主干上能出现凹位侧枝的夹具：8 主干 + 若干 Method 侧枝。 */
function ladderFixture(twigCount: number) {
  const cores = Array.from({ length: 8 }, (_, i) => node(`c${i}`, i));
  const twigs = Array.from({ length: twigCount }, (_, i) => node(`t${i}`, 100 + i, 'Method'));
  const edges = twigs.map((t, i) => ({ source: t.node_id, target: `c${i % 8}`, type: 'USES' }));
  return layoutSineLadder([...cores, ...twigs], edges, { leafTypes: new Set(['method']) });
}

describe('layoutSineLadder（侧枝贴宿主凹位方案）', () => {
  it('主干节点按教材序正弦蜿蜒，x 都在 [cx-amp, cx+amp]', () => {
    const layout = ladderFixture(4);
    expect(layout.coreOrder).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
    const stem = layout.positions.filter(p => layout.coreOrder.includes(p.nodeId));
    stem.forEach((p, i) => {
      expect(p.y).toBe(LADDER.padTop + i * LADDER.gapY);
      expect(p.x).toBeCloseTo(LADDER.cx + LADDER.amp * Math.sin(i * 0.92), 6);
      expect(p.x).toBeGreaterThanOrEqual(LADDER.cx - LADDER.amp - 1e-6);
      expect(p.x).toBeLessThanOrEqual(LADDER.cx + LADDER.amp + 1e-6);
    });
  });

  it('主干标签固定凸侧（labelSide = x>=cx ? right : left）', () => {
    const layout = ladderFixture(0);
    layout.positions.forEach(p => {
      expect(p.labelSide).toBe(p.x >= LADDER.cx ? 'right' : 'left');
    });
  });

  it('侧枝 glyph 贴宿主凹侧：gx-host.x 的方向 = -sign(host.x-cx)，距离 twigOff', () => {
    const layout = ladderFixture(6);
    const posById = new Map(layout.positions.map(p => [p.nodeId, p]));
    layout.positions.filter(p => p.twigOf).forEach(t => {
      const host = posById.get(t.twigOf!)!;
      const expectedDir = host.x >= LADDER.cx ? -1 : 1;
      expect(Math.sign(t.x - host.x)).toBe(expectedDir);
      expect(Math.abs(t.x - host.x)).toBeCloseTo(LADDER.twigOff, 6);
    });
  });

  it('同宿主多个侧枝竖向依次排开（gy = host.y + twigDrop + k*twigLabelGap）', () => {
    const cores = Array.from({ length: 8 }, (_, i) => node(`c${i}`, i));
    const twigs = [node('a', 100, 'Method'), node('b', 101, 'Method'), node('c', 102, 'Method')];
    const single = layoutSineLadder(
      [...cores, ...twigs],
      twigs.map(t => ({ source: t.node_id, target: 'c3', type: 'USES' })),
      { leafTypes: new Set(['method']) },
    );
    const posById = new Map(single.positions.map(p => [p.nodeId, p]));
    const host = posById.get('c3')!;
    ['a', 'b', 'c'].forEach((id, k) => {
      const t = posById.get(id)!;
      expect(t.y).toBe(host.y + LADDER.twigDrop + k * LADDER.twigLabelGap);
      expect(Math.abs(t.x - host.x)).toBeCloseTo(LADDER.twigOff, 6);
    });
  });

  it('侧枝过滤：showProblems=false 时不布局侧枝；leafTypes 优先于 showProblems', () => {
    const none = layoutSineLadder(
      [node('core', 0), node('p', 1, 'ProblemClass')],
      [{ source: 'p', target: 'core', type: 'USES' }],
      { showProblems: false },
    );
    expect(none.positions.map(p => p.nodeId)).toEqual(['core']);
    expect(none.twigs).toEqual([]);

    const filtered = layoutSineLadder(
      [node('core', 0), node('m', 1, 'Method'), node('o', 2, 'Outcome')],
      [{ source: 'm', target: 'core', type: 'USES' }, { source: 'o', target: 'core', type: 'USES' }],
      { showProblems: false, leafTypes: new Set(['method']) },
    );
    expect(filtered.positions.map(p => p.nodeId).sort()).toEqual(['core', 'm']);
  });

  it('无关系侧枝挂讲授序最近的核心节点', () => {
    const layout = layoutSineLadder(
      [node('a', 0), node('b', 10), node('p', 9, 'ProblemClass')],
      [],
    );
    expect(layout.positions.find(p => p.nodeId === 'p')).toMatchObject({ twigOf: 'b' });
  });

  it('未翻转侧枝 pill 盒不跨过其 y 处主干（|盒与 sx±14 不相交|）', () => {
    const layout = ladderFixture(8);
    const stem = layout.positions.filter(p => layout.coreOrder.includes(p.nodeId));
    layout.positions.filter(p => p.twigOf && !p.lead).forEach(t => {
      const sx = stemXAt(stem, t.y);
      const box = pillBox(t);
      const cross = Math.min(box.x1, box.x2) <= sx + 14 && Math.max(box.x1, box.x2) >= sx - 14;
      expect(cross).toBe(false);
    });
  });

  it('翻转的侧枝：标签在凸侧、带引线、引线从 glyph 到 pill 边缘', () => {
    // 找/构造会压线的场景：主干斜率大处（i 较小，sin 变化快），长标签侧枝更易压线
    const cores = Array.from({ length: 8 }, (_, i) => node(`c${i}`, i));
    const longTwig = { ...node('long', 100, 'Method'), name: '矩阵消元法解线性方程组问题' };
    // c1 处主干斜率最大（sin(0.92) 附近），挂长标签侧枝促发翻转
    const layout = layoutSineLadder(
      [...cores, longTwig],
      [{ source: 'long', target: 'c1', type: 'USES' }],
      { leafTypes: new Set(['method']) },
    );
    const posById = new Map(layout.positions.map(p => [p.nodeId, p]));
    const host = posById.get('c1')!;
    const t = posById.get('long')!;
    const stem = layout.positions.filter(p => layout.coreOrder.includes(p.nodeId));
    // 复算“未翻转默认位置”是否压线，决定该夹具是否促发了翻转
    const hostConcave = host.x >= LADDER.cx ? -1 : 1;
    const defaultTx = hostConcave < 0 ? t.x - LABEL.gap : t.x + LABEL.gap;
    const w = textWidth(longTwig.name);
    const defaultL = (hostConcave < 0 ? defaultTx - w : defaultTx) - LABEL.pillPad;
    const defaultR = (hostConcave < 0 ? defaultTx : defaultTx + w) + LABEL.pillPad;
    const sx = stemXAt(stem, t.y);
    const wouldCross = defaultL <= sx + 14 && defaultR >= sx - 14;
    if (wouldCross || t.lead) {
      // 已翻转：标签在凸侧
      const mainDir = host.x >= LADDER.cx ? 1 : -1;
      expect(Math.sign(t.labelTx! - host.x)).toBe(mainDir);
      expect(t.lead).toBeTruthy();
      expect(t.lead!.x1).toBe(t.x);
      expect(t.lead!.y1).toBe(t.y);
      expect(t.lead!.y2).toBe(t.y);
      expect(t.lead!.x2).toBe(t.labelAnchor === 'start' ? t.labelTx! - LABEL.pillPad : t.labelTx! + LABEL.pillPad);
    } else {
      // 未压线也算通过（夹具未促发翻转时不断言翻转行为）
      expect(t.lead).toBeUndefined();
    }
  });

  it('任意两侧枝 pill 盒互不重叠', () => {
    const cores = Array.from({ length: 8 }, (_, i) => node(`c${i}`, i));
    const names = ['矩阵消元法解线性方程组问题', '线性方程组有解判定与通解结构', '齐次线性方程组基础解系与解空间'];
    const twigs = names.map((name, i) => ({ ...node(`t${i}`, 100 + i, 'Method'), name }));
    // 全挂同一宿主，最大化重叠概率
    const layout = layoutSineLadder(
      [...cores, ...twigs],
      twigs.map(t => ({ source: t.node_id, target: 'c3', type: 'USES' })),
      { leafTypes: new Set(['method']) },
    );
    const twigPositions = layout.positions.filter(p => p.twigOf);
    const boxes = twigPositions.map(pillBox);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap = a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
        expect(overlap).toBe(false);
      }
    }
  });

  it('pill 与 glyph 含角标外缘间距 ≥ 12（未翻转时，按标签所在侧取 glyph 外缘）', () => {
    const layout = ladderFixture(8);
    const posById = new Map(layout.positions.map(p => [p.nodeId, p]));
    layout.positions.filter(p => p.twigOf && !p.lead).forEach(t => {
      const box = pillBox(t);
      const host = posById.get(t.twigOf!)!;
      const concave = host.x >= LADDER.cx ? -1 : 1;
      // GAP=25 ⇒ pill 边缘距 glyph 中心 17；净间距相对该侧 glyph 外缘 ≥12。
      // glyph 本体最大半径 7.5（method 六边形），角标在右上外缘 gx+13、不影响左侧。
      if (concave < 0) {
        // 标签在左：pill 右缘距 glyph 左外缘（gx-7.5）≥ 4.5；距 glyph 中心 = 17
        expect((t.x - 7.5) - box.x2).toBeGreaterThanOrEqual(4.5 - 1e-6);
        expect(t.x - box.x2).toBeCloseTo(17, 6);
      } else {
        // 标签在右：pill 左缘距角标外缘（gx+13）≥ 4
        expect(box.x1 - (t.x + 13)).toBeGreaterThanOrEqual(4 - 1e-6);
        expect(box.x1 - t.x).toBeCloseTo(17, 6);
      }
    });
  });

  it('textWidth：CJK 14/字、ASCII 7.5/字', () => {
    expect(textWidth('矩阵')).toBe(28);
    expect(textWidth('ab')).toBe(15);
    expect(textWidth('n元')).toBe(7.5 + 14);
  });

  it('布局高度容纳主干与下推后的侧枝标签', () => {
    const layout = ladderFixture(8);
    const minH = LADDER.padTop * 2 + 7 * LADDER.gapY + LADDER.bottomPad;
    expect(layout.height).toBeGreaterThanOrEqual(minH);
    layout.positions.filter(p => p.twigOf).forEach(t => {
      expect(t.labelY! + LABEL.pillHeight / 2).toBeLessThanOrEqual(layout.height + 1e-6);
    });
  });
});
