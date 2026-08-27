import { useState, useCallback, useEffect, useRef } from 'react';

import { loadString, saveString, removeString } from '../utils/storage';
import { activeThreadStorageKey as getActiveThreadStorageKey } from '../utils/storageKeys';
import { normalizeChatHistoryRecord } from '../utils/chatHistory';
import { getChatHistoryByUser, deleteChatHistory } from '../services/api';
import type { Marker } from '../components/PageMarker';
import type { User } from '../types';

export function useMarkers(user: User, currentPage: number, textbookId: string) {
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [activeMarker, setActiveMarker] = useState<Marker | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const requestSequence = useRef(0);
  // A successful delete must win over any in-flight refresh that started
  // before the DELETE completed.  Keeping the tombstones request-local
  // prevents a stale response from briefly resurrecting the deleted marker.
  const deletedMarkerIdsRef = useRef<Set<string>>(new Set());

  const userId = user.userId || user.deviceId;
  const activeThreadStorageKey = userId ? getActiveThreadStorageKey(userId) : null;
  const identityRef = useRef({ userId, textbookId });

  const selectActiveThreadId = useCallback((threadId: string | null) => {
    setActiveThreadId(threadId);
    if (!activeThreadStorageKey) return;
    // 该键历史遗留为裸字符串 threadId（未经 JSON 包装），读写必须保持原格式，
    // 否则旧数据会因 JSON.parse 失败而一次性丢失；threadId 为 null 时显式删键
    if (threadId) saveString(activeThreadStorageKey, threadId);
    else removeString(activeThreadStorageKey);
  }, [activeThreadStorageKey]);

  const refreshMarkers = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (!userId) {
      setMarkers([]);
      return;
    }
    try {
      // 透传教材 ID 过滤：徽标只在所属教材的页面上出现（NULL 老数据仍全教材可见，由后端统一处理）
      const data = await getChatHistoryByUser(userId, currentPage, 50, textbookId);
      if (requestId !== requestSequence.current) return;
      if (Array.isArray(data)) {
        // 归一化收敛到共享函数：徽标列表与提问记录侧栏共用同一份解析逻辑，避免复制两份
        const normalized = data
          .map(normalizeChatHistoryRecord)
          .filter(marker => !deletedMarkerIdsRef.current.has(marker.id));
        setMarkers(normalized);
        const persistedId = activeThreadStorageKey
          ? loadString(activeThreadStorageKey, null)
          : null;
        const persistedMarker = normalized.find((marker: Marker) => marker.id === persistedId);
        if (persistedMarker) {
          setActiveThreadId(persistedMarker.id);
          setActiveMarker(persistedMarker);
        }
      }
    } catch {}
  }, [userId, currentPage, textbookId, activeThreadStorageKey]);

  // 切换用户或教材时先失效旧请求并清掉不属于当前空间的徽标，避免旧响应
  // 在新教材页面短暂覆盖当前数据。跨教材点击已有记录时 activeMarker 已经
  // 指向新教材，因此保留它，等待新空间的请求完成。
  useEffect(() => {
    const previous = identityRef.current;
    const userChanged = previous.userId !== userId;
    const textbookChanged = previous.textbookId !== textbookId;
    if (!userChanged && !textbookChanged) return;
    identityRef.current = { userId, textbookId };
    requestSequence.current += 1;
    deletedMarkerIdsRef.current.clear();
    setMarkers([]);
    if (userChanged || (activeMarker?.textbook_id && activeMarker.textbook_id !== textbookId)) {
      setActiveMarker(null);
      selectActiveThreadId(null);
    }
  }, [activeMarker, selectActiveThreadId, textbookId, userId]);

  // 翻页/登录时刷新标记
  useEffect(() => { void refreshMarkers(); }, [refreshMarkers]);

  const handleDeleteMarker = useCallback(async (markerId: string) => {
    if (!user.token) throw new Error('authentication_required');
    // Invalidate refreshes that started before this delete.  Do not use this
    // sequence as a guard for the successful delete itself: another refresh
    // may legitimately start while the server request is in flight.
    ++requestSequence.current;
    // Keep the row until the server confirms deletion.  Callers can now show
    // a retry/error state instead of silently presenting a false success.
    await deleteChatHistory(markerId, user.token);
    deletedMarkerIdsRef.current.add(markerId);
    setMarkers(prev => prev.filter(m => m.id !== markerId));
    setActiveMarker(prev => prev?.id === markerId ? null : prev);
    if (activeThreadId === markerId) selectActiveThreadId(null);
  }, [activeThreadId, selectActiveThreadId, user.token]);

  const addMarker = useCallback((marker: Marker) => {
    setMarkers(prev => {
      const index = prev.findIndex(item => item.id === marker.id);
      if (index < 0) return [...prev, marker];
      const next = prev.slice();
      next[index] = { ...next[index], ...marker };
      return next;
    });
  }, []);

  const updateMarker = useCallback((id: string, updater: (m: Marker) => Marker) => {
    setMarkers(prev => prev.map(m => m.id === id ? updater(m) : m));
  }, []);

  const getMarkerById = useCallback((id: string | null): Marker | undefined => {
    if (!id) return undefined;
    return markers.find(m => m.id === id);
  }, [markers]);

  return {
    markers,
    activeMarker,
    activeThreadId,
    refreshMarkers,
    handleDeleteMarker,
    addMarker,
    updateMarker,
    getMarkerById,
    setActiveThreadId: selectActiveThreadId,
    setActiveMarker,
  };
}
