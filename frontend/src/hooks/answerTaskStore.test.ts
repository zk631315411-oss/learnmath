import { describe, expect, it } from 'vitest';

import { AnswerTaskStore, type AnswerTask } from './answerTaskStore';
import { projectThreadMessages } from './threadProjection';

function task(overrides: Partial<AnswerTask> = {}): AnswerTask {
  const clientTurnId = overrides.clientTurnId || 'turn-1';
  return {
    clientTurnId,
    userId: 'user-a',
    chatId: 'chat-a',
    turnKind: 'follow_up',
    textbookId: 'book-a',
    pageNumber: 12,
    markerType: 'text',
    assistantMsgId: `${clientTurnId}-answer`,
    request: { user_id: 'user-a', question: '为什么？', textbook_id: 'book-a', page_number: 12 },
    status: 'pending',
    answer: '',
    thinking: '',
    toolActivities: [],
    artifacts: [],
    sources: [],
    startedAt: 1,
    controller: new AbortController(),
    ...overrides,
  };
}

describe('AnswerTaskStore', () => {
  it('allows pending -> streaming -> completed and rejects late chunks', () => {
    const store = new AnswerTaskStore();
    store.register(task());
    store.start('turn-1');
    store.update('turn-1', { answer: '部分' });
    store.finish('turn-1', 'completed', { answer: '完整', qaTurnId: 'qa-1' });
    store.update('turn-1', { answer: '迟到内容' });
    expect(store.get('turn-1')).toMatchObject({ status: 'completed', answer: '完整', qaTurnId: 'qa-1' });
  });

  it('cancels immediately so a late stream callback cannot overwrite terminal state', () => {
    const store = new AnswerTaskStore();
    const running = task({ status: 'streaming' });
    store.register(running);
    store.cancel('turn-1');
    expect(running.controller.signal.aborted).toBe(true);
    store.finish('turn-1', 'completed', { answer: '不应落入' });
    expect(store.get('turn-1')).toMatchObject({ status: 'cancelled', answer: '' });
  });

  it('serializes one thread while allowing another thread to run', () => {
    const store = new AnswerTaskStore();
    store.register(task({ status: 'streaming' }));
    store.register(task({ clientTurnId: 'turn-2', chatId: 'chat-b', status: 'streaming' }));
    expect(store.runningForThread('user-a', 'chat-a')?.clientTurnId).toBe('turn-1');
    expect(store.runningForThread('user-a', 'chat-b')?.clientTurnId).toBe('turn-2');
  });
});

describe('projectThreadMessages', () => {
  it('only projects tasks owned by the visible user, book, page and thread', () => {
    const visible = task({ status: 'streaming', answer: '正在生成' });
    const otherBook = task({ clientTurnId: 'turn-b', textbookId: 'book-b', status: 'streaming', answer: '串线' });
    const messages = projectThreadMessages([], [visible, otherBook], {
      userId: 'user-a', textbookId: 'book-a', pageNumber: 12, activeThreadId: 'chat-a',
    });
    expect(messages.map(message => message.content)).toEqual(['为什么？', '正在生成']);
    expect(messages[1]).toMatchObject({ pending: true, failed: undefined });
  });

  it('restores the newest root task when returning to its page without an active thread', () => {
    const older = task({ clientTurnId: 'old', chatId: 'old-chat', turnKind: 'root', startedAt: 1, status: 'completed', answer: '旧回答' });
    const newest = task({ clientTurnId: 'new', chatId: 'new-chat', turnKind: 'root', startedAt: 2, status: 'completed', answer: '后台回答' });
    const messages = projectThreadMessages([], [older, newest], {
      userId: 'user-a', textbookId: 'book-a', pageNumber: 12, activeThreadId: null,
    });
    expect(messages.map(message => message.content)).toEqual(['为什么？', '后台回答']);
  });
});
