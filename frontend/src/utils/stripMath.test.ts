import { describe, expect, it } from 'vitest';
import { stripMath } from '../components/kg/shared';

describe('stripMath', () => {
  it('removes $ wrappers and keeps plain text', () => {
    expect(stripMath('2.2 $n$  阶行列式的定义')).toBe('2.2 n 阶行列式的定义');
    expect(stripMath('2.6 行列式按 $k$ 行(列)展开')).toBe('2.6 行列式按 k 行(列)展开');
  });

  it('unwraps single-argument format commands', () => {
    expect(stripMath('2.1 $\\pmb{n}$  元排列')).toBe('2.1 n 元排列');
    expect(stripMath('$\\mathbf{A}$ 矩阵')).toBe('A 矩阵');
  });

  it('converts frac to a/b', () => {
    expect(stripMath('$\\frac{\\infty}{\\infty}$型不定式')).toBe('∞/∞型不定式');
  });

  it('replaces known symbol commands', () => {
    expect(stripMath('$u(x) \\in F[x]$')).toBe('u(x) ∈ F[x]');
    expect(stripMath('求\\lambda-矩阵的相抵标准形问题')).toBe('求λ-矩阵的相抵标准形问题');
  });

  it('decodes leaked unicode escapes', () => {
    expect(stripMath('\\u2124上不可约多项式定义')).toBe('ℤ上不可约多项式定义');
  });

  it('handles superscripts and drops subscript markers', () => {
    expect(stripMath('$x^2$')).toBe('x²');
    expect(stripMath('$K[x_{1},x_{2}]$')).toBe('K[x1,x2]');
  });
});
