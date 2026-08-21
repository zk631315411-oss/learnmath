import { describe, expect, it } from 'vitest';
import { ISLAND, LADDER, islandEdgePath, layoutIslands, layoutSineLadder } from './ladderLayout';
import type { LearningMapNode } from '../services/api';

const node = (id: string, order: number, type = 'Concept'): LearningMapNode => ({
  node_id: id, name: id, section: '1.1', type, order,
  status: 'unexplored', closed_evidence_count: 0, blocked: false, chat: { id: null, available: false },
});

describe('layoutSineLadder', () => {
  it('places core nodes on a vertical sine ladder in textbook order', () => {
    const layout = layoutSineLadder(Array.from({ length: 6 }, (_, index) => node(`n${index}`, index)), []);
    expect(layout.coreOrder).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
    const positions = Object.fromEntries(layout.positions.map(item => [item.nodeId, item]));
    expect(positions.n0.y).toBe(LADDER.padTop);
    expect(positions.n1.y).toBe(LADDER.padTop + LADDER.gapY);
    expect(positions.n5.y).toBe(LADDER.padTop + 5 * LADDER.gapY);
    layout.positions.forEach(position => {
      expect(position.x).toBeGreaterThanOrEqual(LADDER.cx - LADDER.amp - 0.001);
      expect(position.x).toBeLessThanOrEqual(LADDER.cx + LADDER.amp + 0.001);
    });
    expect(layout.height).toBe(LADDER.padTop * 2 + 5 * LADDER.gapY + LADDER.twigDrop);
  });

  it('respects the sine curve instead of a straight column', () => {
    const layout = layoutSineLadder(Array.from({ length: 4 }, (_, index) => node(`n${index}`, index)), []);
    const xs = layout.coreOrder.map(id => layout.positions.find(p => p.nodeId === id)!.x);
    expect(xs[0]).toBe(LADDER.cx);
    expect(new Set(xs.map(x => Math.round(x))).size).toBeGreaterThan(1);
  });

  it('hangs a ProblemClass beside its related core node and marks the twig', () => {
    const layout = layoutSineLadder(
      [node('core', 0), node('other', 1), node('problem', 2, 'ProblemClass')],
      [{ source: 'problem', target: 'core', type: 'USES' }],
    );
    const problem = layout.positions.find(item => item.nodeId === 'problem');
    const host = layout.positions.find(item => item.nodeId === 'core')!;
    expect(problem).toMatchObject({ twigOf: 'core' });
    expect(problem!.y).toBe(host.y + LADDER.twigDrop);
    expect(Math.abs(problem!.x - host.x)).toBe(LADDER.twigBase);
    expect(layout.twigs).toEqual([{ from: 'core', pc: 'problem' }]);
  });

  it('attaches a relatedless ProblemClass to the nearest core node by order', () => {
    const layout = layoutSineLadder(
      [node('a', 0), node('b', 10), node('problem', 9, 'ProblemClass')],
      [],
    );
    expect(layout.positions.find(item => item.nodeId === 'problem')).toMatchObject({ twigOf: 'b' });
  });

  it('omits ProblemClass when showProblems is false', () => {
    const layout = layoutSineLadder(
      [node('core', 0), node('problem', 1, 'ProblemClass')],
      [{ source: 'problem', target: 'core', type: 'USES' }],
      { showProblems: false },
    );
    expect(layout.positions.map(p => p.nodeId)).toEqual(['core']);
    expect(layout.twigs).toEqual([]);
  });

  it('labels right-side nodes anchored right and vice versa', () => {
    const layout = layoutSineLadder(Array.from({ length: 6 }, (_, index) => node(`n${index}`, index)), []);
    layout.positions.forEach(position => {
      expect(position.labelSide).toBe(position.x >= LADDER.cx ? 'right' : 'left');
    });
  });
});

describe('layoutIslands', () => {
  it('splits connected components and collects singles', () => {
    const layout = layoutIslands(
      [node('a', 0), node('b', 1), node('c', 2), node('d', 3), node('e', 4)],
      [{ source: 'a', target: 'b', type: 'USES' }, { source: 'c', target: 'd', type: 'USES' }],
    );
    expect(layout.islands.map(island => island.memberIds)).toEqual([['a', 'b'], ['c', 'd']]);
    expect(layout.singleIds).toEqual(['e']);
  });

  it('sorts islands by earliest textbook order', () => {
    const layout = layoutIslands(
      [node('late1', 5), node('late2', 6), node('early1', 0), node('early2', 1)],
      [{ source: 'late1', target: 'late2', type: 'USES' }, { source: 'early1', target: 'early2', type: 'USES' }],
    );
    expect(layout.islands[0].memberIds).toEqual(['early1', 'early2']);
    expect(layout.islands[1].memberIds).toEqual(['late1', 'late2']);
  });

  it('lays out islands as a 2D scatter pinned on textbook order', () => {
    const nodes = Array.from({ length: 30 }, (_, index) => node(`n${index}`, index));
    const edges = nodes.slice(1).map((item, index) => ({ source: nodes[index].node_id, target: item.node_id, type: 'PREREQUISITE_OF' }));
    const layout = layoutIslands(nodes, edges);
    expect(layout.islands).toHaveLength(1);
    const island = layout.islands[0];
    // 横轴严格按教材序递增
    const xs = island.positions.map(p => p.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs[1] - xs[0]).toBe(ISLAND.stepX);
    // 纵轴有松弛分布；横向相邻节点保持最小纵向间距（不同列允许同高）
    const ys = island.positions.map(p => p.y);
    expect(new Set(ys).size).toBeGreaterThan(1);
    for (let i = 1; i < island.positions.length; i += 1) {
      expect(Math.abs(island.positions[i].y - island.positions[i - 1].y)).toBeGreaterThanOrEqual(ISLAND.minGapY - 0.001);
    }
  });

  it('pulls densely connected nodes together vertically', () => {
    // 0-1-2-3 成环，4-5 独立成链挂在 n3 上：环内成员在纵向次序上应彼此相邻（不被链插入）
    const nodes = Array.from({ length: 6 }, (_, index) => node(`n${index}`, index));
    const edges = [
      { source: 'n0', target: 'n1', type: 'USES' }, { source: 'n1', target: 'n2', type: 'USES' },
      { source: 'n2', target: 'n3', type: 'USES' }, { source: 'n3', target: 'n0', type: 'USES' },
      { source: 'n0', target: 'n2', type: 'USES' }, { source: 'n4', target: 'n5', type: 'USES' },
      { source: 'n3', target: 'n4', type: 'USES' },
    ];
    const layout = layoutIslands(nodes, edges);
    expect(layout.islands).toHaveLength(1);
    const positions = layout.islands[0].positions;
    // 环内成员纵向应聚集成块：极差有限，且与挂在 n3 上的链相邻
    const ringYs = [0, 1, 2, 3].map(i => positions.find(p => p.nodeId === `n${i}`)!.y);
    expect(Math.max(...ringYs) - Math.min(...ringYs)).toBeLessThanOrEqual(ISLAND.minGapY * 2.5);
  });

  it('ignores edges whose endpoints are filtered out', () => {
    const layout = layoutIslands(
      [node('a', 0), node('b', 1)],
      [{ source: 'a', target: 'ghost', type: 'USES' }],
    );
    expect(layout.islands).toEqual([]);
    expect(layout.singleIds).toEqual(['a', 'b']);
  });
});

describe('islandEdgePath', () => {
  const at = (x: number, y: number, i: number) => ({ nodeId: `${x},${y}`, x, y, i });

  it('bends edges upward as a quadratic arc above both endpoints', () => {
    const d = islandEdgePath(at(52, 80, 0), at(158, 46, 1));
    expect(d).toMatch(/^M 52 80 Q 105 ([-\d.]+) 158 46$/);
    expect(Number(d.match(/^M 52 80 Q 105 ([-\d.]+) 158 46$/)?.[1])).toBeLessThan(46);
  });

  it('raises the bow with sequence span', () => {
    const near = islandEdgePath(at(52, 46, 0), at(158, 46, 1));
    const far = islandEdgePath(at(52, 46, 0), at(600, 46, 8));
    const bowOf = (d: string) => Number(d.match(/Q [-\d.]+ ([-\d.]+)/)?.[1]);
    expect(bowOf(far)).toBeLessThan(bowOf(near));
  });
});
