import { describe, expect, it } from 'vitest';

import type { Source } from '../types';
import {
  citedSourceCodes,
  renderCitationMarkers,
  sourceCodeFromHref,
  sourceHref,
  sourceLabel,
  uniqueClickableSources,
} from './sourceCitations';

const source: Source = {
  textbook_id: 'gaodai_shang', textbook_name: '高等代数上册', node_id: 'n1',
  node_name: '逆序数', chapter: '第2章 行列式', section: '2.1 n 元排列',
  source_code: 'gaodai_shang:C02:S01:U01:L986-L1059', snippet: '逆序数定义。',
};

describe('source citations', () => {
  it('renders short pill labels only for matching complete sources', () => {
    const answer = renderCitationMarkers(
      '有效 [[cite:gaodai_shang:C02:S01:U01:L986-L1059]] 无效 [[cite:fake:C99]]',
      [source],
    );
    expect(answer).toContain('[§2.1](');
    expect(answer).not.toContain('fake');
    expect(answer).not.toContain('[[cite:');
  });

  it('collects inline cited source codes for footer de-duplication', () => {
    expect(citedSourceCodes('有 [[cite:a:1]] 和 [[cite:b:2]] 及 [[cite:a:1]]')).toEqual(new Set(['a:1', 'b:2']));
    expect(citedSourceCodes('没有引用')).toEqual(new Set());
  });

  it('hides citation markers while the assistant is streaming', () => {
    expect(renderCitationMarkers('答案 [[cite:book:C01]]', [source], true)).toBe('答案 ');
  });

  it('does not make legacy incomplete records clickable', () => {
    expect(uniqueClickableSources([{ chapter: '2' }, source, source])).toEqual([source]);
  });

  it('round-trips source hrefs and labels', () => {
    const href = sourceHref(source.source_code!);
    expect(sourceCodeFromHref(href)).toBe(source.source_code);
    expect(sourceLabel(source)).toBe('教材 §2.1');
  });
});
