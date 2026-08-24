import { useCallback, useRef, useSyncExternalStore } from 'react';

import type { FetchWithStageRequest } from '../services/api';
import type { ManimArtifact, ToolActivity } from '../types';
import type { Marker } from '../components/PageMarker';

export type AnswerTaskStatus = 'pending' | 'streaming' | 'completed' | 'interrupted' | 'cancelled';
export type AnswerTaskKind = 'root' | 'follow_up';

export interface AnswerTask {
  clientTurnId: string;
  qaTurnId?: string | null;
  userId: string;
  chatId: string;
  turnKind: AnswerTaskKind;
  textbookId: string;
  pageNumber: number;
  markerType: Marker['marker_type'];
  assistantMsgId: string;
  request: Readonly<Omit<FetchWithStageRequest, 'signal'>>;
  status: AnswerTaskStatus;
  answer: string;
  thinking: string;
  toolActivities: ToolActivity[];
  artifacts: ManimArtifact[];
  errorMessage?: string;
  startedAt: number;
  controller: AbortController;
}

const terminal = new Set<AnswerTaskStatus>(['completed', 'interrupted', 'cancelled']);

export class AnswerTaskStore {
  private tasks = new Map<string, AnswerTask>();
  private listeners = new Set<() => void>();
  private version = 0;
  // getAll 结果缓存：tasks 未变更时复用同一数组引用，保证下游 useEffect 依赖稳定
  private cachedAll: AnswerTask[] | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  getAll = () => {
    if (!this.cachedAll) this.cachedAll = Array.from(this.tasks.values());
    return this.cachedAll;
  };

  get = (clientTurnId: string) => this.tasks.get(clientTurnId);

  register = (task: AnswerTask) => {
    const existing = this.tasks.get(task.clientTurnId);
    if (existing) return existing;
    this.tasks.set(task.clientTurnId, task);
    this.publish();
    return task;
  };

  update(clientTurnId: string, fields: Partial<AnswerTask>) {
    const current = this.tasks.get(clientTurnId);
    if (!current || terminal.has(current.status)) return current;
    const next = { ...current, ...fields };
    this.tasks.set(clientTurnId, next);
    this.publish();
    return next;
  }

  start(clientTurnId: string) {
    const current = this.tasks.get(clientTurnId);
    if (!current || current.status !== 'pending') return current;
    return this.update(clientTurnId, { status: 'streaming' });
  }

  finish(clientTurnId: string, status: Extract<AnswerTaskStatus, 'completed' | 'interrupted' | 'cancelled'>, fields: Partial<AnswerTask> = {}) {
    const current = this.tasks.get(clientTurnId);
    if (!current || terminal.has(current.status)) return current;
    const next = { ...current, ...fields, status };
    this.tasks.set(clientTurnId, next);
    this.publish();
    return next;
  }

  isActive(clientTurnId: string) {
    const status = this.tasks.get(clientTurnId)?.status;
    return status === 'pending' || status === 'streaming';
  }

  runningForThread(userId: string, chatId: string) {
    return this.getAll().find(task => task.userId === userId && task.chatId === chatId && this.isActive(task.clientTurnId));
  }

  cancel(clientTurnId: string) {
    const task = this.tasks.get(clientTurnId);
    if (task && this.isActive(clientTurnId)) {
      this.finish(clientTurnId, 'cancelled');
      task.controller.abort();
    }
  }

  cancelForUser(userId: string) {
    this.getAll().filter(task => task.userId === userId && this.isActive(task.clientTurnId)).forEach(task => task.controller.abort());
  }

  dispose() {
    this.getAll().filter(task => this.isActive(task.clientTurnId)).forEach(task => task.controller.abort());
    this.tasks.clear();
    this.publish();
  }

  private publish() {
    this.version += 1;
    this.cachedAll = null;
    this.listeners.forEach(listener => listener());
  }
}

export function useAnswerTasks() {
  const storeRef = useRef<AnswerTaskStore | null>(null);
  if (!storeRef.current) storeRef.current = new AnswerTaskStore();
  const store = storeRef.current;
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);

  const cancel = useCallback((clientTurnId?: string) => {
    if (clientTurnId) store.cancel(clientTurnId);
  }, [store]);

  return { store, tasks: store.getAll(), cancel };
}
