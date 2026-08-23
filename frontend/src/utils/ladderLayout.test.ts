import { describe, expect, it } from 'vitest';
import { LADDER, layoutSineLadder } from './ladderLayout';
import type { LearningMapNode } from '../services/api';

const node = (id: string, order: number, type = 'Concept'): LearningMapNode => ({
  node_id: id, name: id, section: '1.1', type, order,
  status: 'unexplored', closed_evidence_count: 0, blocked: false, chat: { id: null, available: false },
});

describe('layoutSineLadder（纯概念梯子）', () => {
  it('主干只含 Concept/Theorem/Formula，按 order 排列', () => {
    const nodes = [
      node('b', 2, 'Theorem'),
      node('a', 1, 'Concept'),
      node('c', 3, 'Formula'),
      node('m', 4, 'Method'),
      node('p', 5, 'ProblemClass'),
    ];
    const layout = layoutSineLadder(nodes, []);
    expect(layout.coreOrder).toEqual(['a', 'b', 'c']);
    expect(layout.positions.map(p => p.nodeId)).toEqual(['a', 'b', 'c']);
  });

  it('主干节点按教材序正弦蜿蜒，x 都在 [cx-amp, cx+amp]，y 按 gapY 递增', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => node(`c${i}`, i));
    const layout = layoutSineLadder(nodes, []);
    layout.positions.forEach((p, i) => {
      expect(p.y).toBe(LADDER.padTop + i * LADDER.gapY);
      expect(p.x).toBeCloseTo(LADDER.cx + LADDER.amp * Math.sin(i * 0.92), 6);
      expect(p.x).toBeGreaterThanOrEqual(LADDER.cx - LADDER.amp - 1e-6);
      expect(p.x).toBeLessThanOrEqual(LADDER.cx + LADDER.amp + 1e-6);
    });
  });

  it('主干标签固定凸侧（labelSide = x>=cx ? right : left），随正弦左右交替', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => node(`c${i}`, i));
    const layout = layoutSineLadder(nodes, []);
    layout.positions.forEach(p => {
      expect(p.labelSide).toBe(p.x >= LADDER.cx ? 'right' : 'left');
    });
    // 蜿蜒必然两侧都出现（不会全在一侧）
    const sides = new Set(layout.positions.map(p => p.labelSide));
    expect(sides.size).toBe(2);
  });

  it('方法/题型节点传入也不进 positions / coreOrder', () => {
    const nodes = [
      node('c0', 0),
      node('m0', 1, 'Method'),
      node('c1', 2),
      node('p0', 3, 'ProblemClass'),
      node('c2', 4),
    ];
    const layout = layoutSineLadder(nodes, [
      { source: 'm0', target: 'c0', type: 'USES' },
      { source: 'p0', target: 'c1', type: 'APPLIES_TO' },
    ]);
    expect(layout.coreOrder).toEqual(['c0', 'c1', 'c2']);
    expect(layout.positions.find(p => p.nodeId === 'm0')).toBeUndefined();
    expect(layout.positions.find(p => p.nodeId === 'p0')).toBeUndefined();
  });

  it('height 按主干节点数算：padTop*2 + (n-1)*gapY + bottomPad', () => {
    const layout = layoutSineLadder(Array.from({ length: 5 }, (_, i) => node(`c${i}`, i)), []);
    expect(layout.height).toBe(LADDER.padTop * 2 + 4 * LADDER.gapY + LADDER.bottomPad);

    const single = layoutSineLadder([node('only', 0)], []);
    expect(single.height).toBe(LADDER.padTop * 2 + LADDER.bottomPad);

    const empty = layoutSineLadder([node('m', 0, 'Method')], []);
    expect(empty.positions).toEqual([]);
    expect(empty.coreOrder).toEqual([]);
    expect(empty.height).toBe(LADDER.padTop * 2 + LADDER.bottomPad);
  });
});
