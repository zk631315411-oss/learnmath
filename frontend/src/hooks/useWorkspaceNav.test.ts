import { describe, expect, it } from 'vitest';

import { buildWorkspaceUrl, parseWorkspaceLocation } from './useWorkspaceNav';

describe('workspace URL contract', () => {
  it('round-trips reader state including textbook, page and thread', () => {
    const url = buildWorkspaceUrl({
      view: 'reader', chapter: null, textbookId: 'gaodai_shang', page: 27, threadId: 'chat-1',
    }, '/learn');
    expect(url).toBe('/learn?view=reader&textbook=gaodai_shang&page=27&thread=chat-1');
    expect(parseWorkspaceLocation(url.slice(url.indexOf('?')))).toMatchObject({
      view: 'reader', chapter: null, textbookId: 'gaodai_shang', page: 27, threadId: 'chat-1', explicit: true,
    });
  });

  it('keeps chapter only for map state and rejects invalid pages', () => {
    const url = buildWorkspaceUrl({
      view: 'map', chapter: '第1章 线性方程组', textbookId: 'gaodai_shang', page: 2, threadId: 'ignored',
    });
    expect(parseWorkspaceLocation(url.slice(url.indexOf('?')))).toMatchObject({
      view: 'map', chapter: '第1章 线性方程组', threadId: null,
    });
    expect(parseWorkspaceLocation('?view=reader&page=0')).toMatchObject({ page: null, view: 'reader' });
  });
});
