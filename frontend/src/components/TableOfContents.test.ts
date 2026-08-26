import { describe, expect, it } from 'vitest';

import { chapterIsCurrent } from './TableOfContents';
import type { CatalogChapterSummary } from '../catalog/types';

const chapters: CatalogChapterSummary[] = [
  { id: 'chapter-1', name: '第一章', number: 1, order: 0, node_count: 2, first_page: 10 },
  { id: 'chapter-2', name: '第二章', number: 2, order: 1, node_count: 2, first_page: 30 },
  { id: 'chapter-3', name: '第三章', number: 3, order: 2, node_count: 2, first_page: null },
];

describe('chapterIsCurrent', () => {
  it('uses the next chapter start as an exclusive upper bound', () => {
    expect(chapterIsCurrent(chapters, 0, 10)).toBe(true);
    expect(chapterIsCurrent(chapters, 0, 29)).toBe(true);
    expect(chapterIsCurrent(chapters, 0, 30)).toBe(false);
    expect(chapterIsCurrent(chapters, 1, 30)).toBe(true);
  });

  it('does not mark a chapter without a page as current', () => {
    expect(chapterIsCurrent(chapters, 2, 99)).toBe(false);
  });
});
