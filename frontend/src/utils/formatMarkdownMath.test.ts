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
});
