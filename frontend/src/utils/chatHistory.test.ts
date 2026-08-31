import { describe, expect, it } from 'vitest';

import { normalizeChatHistoryRecord } from './chatHistory';

describe('chat history source restoration', () => {
  it('normalizes root and follow-up sources from persisted JSON', () => {
    const marker = normalizeChatHistoryRecord({
      id: 'chat-1', question: 'q', answer: 'a', page_number: 1, marker_y_ratio: 0,
      marker_type: 'text', sources: JSON.stringify([{ source_code: 'book:root', snippet: 'root' }]),
      follow_ups: JSON.stringify([{
        question: 'why', answer: 'because', turn_id: 'turn-1',
        sources: [{ source_code: 'book:follow', snippet: 'follow' }],
      }]),
    });
    expect(marker.sources).toEqual([{ source_code: 'book:root', snippet: 'root' }]);
    expect(marker.follow_ups[0].sources).toEqual([{ source_code: 'book:follow', snippet: 'follow' }]);
  });

  it('keeps legacy records readable while leaving them non-clickable', () => {
    const marker = normalizeChatHistoryRecord({
      id: 'legacy', question: 'q', answer: 'a', page_number: 1, marker_y_ratio: 0,
      marker_type: 'text', sources: JSON.stringify([{ chapter: '2', page_number: 4 }]), follow_ups: '[]',
    });
    expect(marker.sources).toHaveLength(1);
    expect(marker.sources?.[0].source_code).toBeUndefined();
  });
});
