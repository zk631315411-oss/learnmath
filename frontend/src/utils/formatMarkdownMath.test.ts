import { describe, expect, it } from 'vitest';
import { formatMarkdownMath } from './formatMarkdownMath';

describe('formatMarkdownMath', () => {
  it('keeps latex row spacing inside cases expressions', () => {
    const input = [
      '\\[',
      '\\begin{cases}',
      'a_1 = b_1 \\\\[6pt]',
      'a_2 = b_2',
      '\\end{cases}',
      '\\]',
    ].join('\n');

    expect(formatMarkdownMath(input)).toContain('b_1 \\\\[6pt]');
    expect(formatMarkdownMath(input)).not.toContain('$$6pt]');
  });

  it('converts bracket and parenthesis math delimiters for markdown rendering', () => {
    expect(formatMarkdownMath('Let \\(x\\) satisfy \\[x^2=1\\].')).toBe('Let $x$ satisfy $$x^2=1$$.');
  });

  it('unwraps inline code when it only contains a math expression', () => {
    expect(formatMarkdownMath('函数 `$y=\\sin x$` 的图像')).toBe('函数 $y=\\sin x$ 的图像');
    expect(formatMarkdownMath('命令 `npm run build` 保持代码格式')).toBe('命令 `npm run build` 保持代码格式');
  });
});
