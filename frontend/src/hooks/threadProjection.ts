import type { Message } from '../types';
import type { AnswerTask } from './answerTaskStore';

export interface ThreadProjectionContext {
  userId: string;
  textbookId: string;
  pageNumber: number;
  activeThreadId: string | null;
}

function belongsToView(task: AnswerTask, context: ThreadProjectionContext) {
  if (task.userId !== context.userId || task.textbookId !== context.textbookId || task.pageNumber !== context.pageNumber) return false;
  if (context.activeThreadId) return task.turnKind === 'follow_up' && task.chatId === context.activeThreadId;
  return task.turnKind === 'root';
}

/** Merge persisted history with the latest task snapshots for the visible thread. */
export function projectThreadMessages(base: Message[], tasks: AnswerTask[], context: ThreadProjectionContext): Message[] {
  const matching = tasks.filter(task => belongsToView(task, context)).sort((left, right) => left.startedAt - right.startedAt);
  const visibleTasks = context.activeThreadId
    ? matching
    : matching.length ? [matching[matching.length - 1]] : [];
  if (!visibleTasks.length) return base;

  const result = [...base];
  visibleTasks.forEach(task => {
    const prefix = task.chatId ? `${task.chatId}-${task.clientTurnId}` : task.clientTurnId;
    const questionId = task.turnKind === 'root' ? `${task.clientTurnId}-question` : `${prefix}-question`;
    const answerId = task.turnKind === 'root' ? task.assistantMsgId : `${prefix}-answer`;
    const question: Message = {
      id: questionId,
      role: 'user',
      content: task.request.question,
      image: task.request.image,
    };
    const answer: Message = {
      id: answerId,
      role: 'assistant',
      content: task.answer,
      thinking: task.thinking || undefined,
      toolActivities: task.toolActivities,
      artifacts: task.artifacts,
      pending: task.status === 'pending' || task.status === 'streaming' || undefined,
      failed: task.status === 'interrupted' || task.status === 'cancelled' || undefined,
    };
    const upsert = (message: Message) => {
      const index = result.findIndex(item => item.id === message.id);
      if (index >= 0) result[index] = { ...result[index], ...message };
      else result.push(message);
    };
    upsert(question);
    upsert(answer);
  });
  return result;
}
