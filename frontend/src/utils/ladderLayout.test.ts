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

  it('作为某 Concept 的 HAS_PROPERTY 目标的 Formula（记法公式）不上主干', () => {
    const nodes = [
      node('lim_pos', 0, 'Concept'),      // 当 x→+∞ 时函数的极限
      node('lim_pos_not', 1, 'Formula'),  // 它的记法公式（HAS_PROPERTY 目标）
      node('lim_neg', 2, 'Concept'),      // 当 x→-∞ 时函数的极限
      node('lim_neg_not', 3, 'Formula'),  // 它的记法公式
      node('cauchy', 4, 'Theorem'),       // 独立定理（不受影响）
      node('indep_f', 5, 'Formula'),      // 独立公式（无 HAS_PROPERTY，不受影响）
    ];
    const layout = layoutSineLadder(nodes, [
      { source: 'lim_pos', target: 'lim_pos_not', type: 'HAS_PROPERTY' },
      { source: 'lim_neg', target: 'lim_neg_not', type: 'HAS_PROPERTY' },
      // 反向不算（公式→概念不是记法关系）
      { source: 'indep_f', target: 'cauchy', type: 'HAS_PROPERTY' },
    ]);
    expect(layout.coreOrder).toEqual(['lim_pos', 'lim_neg', 'cauchy', 'indep_f']);
    expect(layout.positions.find(p => p.nodeId === 'lim_pos_not')).toBeUndefined();
    expect(layout.positions.find(p => p.nodeId === 'lim_neg_not')).toBeUndefined();
  });

  it('Formula --GETS--> Concept/Theorem 时视为记法公式不上主干', () => {
    const nodes = [
      { ...node('zuodao', 0, 'Concept'), name: '左导数' },
      { ...node('zuodao_f', 1, 'Formula'), name: '左导数公式' },
      { ...node('daohs', 2, 'Concept'), name: '导函数' },
      { ...node('daohs_f', 3, 'Formula'), name: '导函数公式' },
      { ...node('c0', 4, 'Concept'), name: '独立概念' },
    ];
    const layout = layoutSineLadder(nodes, [
      { source: 'zuodao_f', target: 'zuodao', type: 'GETS' },
      { source: 'daohs_f', target: 'daohs', type: 'GETS' },
    ]);
    expect(layout.coreOrder).toEqual(['zuodao', 'daohs', 'c0']);
    expect(layout.positions.map(p => p.nodeId)).not.toContain('zuodao_f');
    expect(layout.positions.map(p => p.nodeId)).not.toContain('daohs_f');
  });

  it('DERIVES / PART_OF 边不是记法关系，公式仍上主干（推导产物/组成员）', () => {
    const nodes = [
      { ...node('daoshu', 0, 'Concept'), name: '导数' },
      { ...node('geo', 1, 'Concept'), name: '导数的几何意义' },
      { ...node('slope_f', 2, 'Formula'), name: '导数与切线斜率关系式' },
      { ...node('fize', 3, 'Theorem'), name: '四则运算求导法则' },
      { ...node('prod_f', 4, 'Formula'), name: '乘积求导公式' },
    ];
    const layout = layoutSineLadder(nodes, [
      // 关系式推导出「几何意义」这个独立概念——不是任何节点的记法
      { source: 'slope_f', target: 'geo', type: 'DERIVES' },
      // 乘积求导公式是法则的组成员——不是记法
      { source: 'prod_f', target: 'fize', type: 'PART_OF' },
    ]);
    // 两个公式都保留在主干（DERIVES/PART_OF 不剔除）
    expect(layout.coreOrder).toEqual(['daoshu', 'geo', 'slope_f', 'fize', 'prod_f']);
    expect(layout.positions.map(p => p.nodeId)).toContain('slope_f');
    expect(layout.positions.map(p => p.nodeId)).toContain('prod_f');
  });

  it('无 HAS_PROPERTY / GETS 边的公式即使名字像记法也不剔除（不按名字猜）', () => {
    const nodes = [
      { ...node('lagrange', 0, 'Theorem'), name: '拉格朗日中值定理' },
      { ...node('lagrange_f', 1, 'Formula'), name: '拉格朗日中值公式' },
      { ...node('kai', 2, 'Concept'), name: '开区间' },
      { ...node('kai_f', 3, 'Formula'), name: '开区间表示公式' },
    ];
    // KG 未建边的「定理↔公式」「概念↔公式」对，前端不合并（B 类待数据侧补边）
    const layout = layoutSineLadder(nodes, []);
    expect(layout.coreOrder).toEqual(['lagrange', 'lagrange_f', 'kai', 'kai_f']);
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
