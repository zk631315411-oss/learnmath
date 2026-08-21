import { useState, useCallback, useEffect } from 'react';

import { loadString, saveString, removeString } from '../utils/storage';
import { activeThreadStorageKey as getActiveThreadStorageKey } from '../utils/storageKeys';
import { normalizeChatHistoryRecord } from '../utils/chatHistory';
import { getChatHistoryByUser, deleteChatHistory } from '../services/api';
import type { Marker } from '../components/PageMarker';
import type { User } from '../types';

export function useMarkers(user: User, currentPage: number, textbookId: string) {
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [activeMarker, setActiveMarker] = useState<Marker | null>(null);
  const [showMarkerPopover, setShowMarkerPopover] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const userId = user.userId || user.deviceId;
  const activeThreadStorageKey = userId ? getActiveThreadStorageKey(userId) : null;

  const selectActiveThreadId = useCallback((threadId: string | null) => {
    setActiveThreadId(threadId);
    if (!activeThreadStorageKey) return;
    // 该键历史遗留为裸字符串 threadId（未经 JSON 包装），读写必须保持原格式，
    // 否则旧数据会因 JSON.parse 失败而一次性丢失；threadId 为 null 时显式删键
    if (threadId) saveString(activeThreadStorageKey, threadId);
    else removeString(activeThreadStorageKey);
  }, [activeThreadStorageKey]);

  const refreshMarkers = useCallback(async () => {
    if (!user.userId && !user.deviceId) return;
    const uid = user.userId || user.deviceId;
    try {
      // 透传教材 ID 过滤：徽标只在所属教材的页面上出现（NULL 老数据仍全教材可见，由后端统一处理）
      const data = await getChatHistoryByUser(uid, currentPage, 50, textbookId);
      if (Array.isArray(data)) {
        // 归一化收敛到共享函数：徽标列表与提问记录侧栏共用同一份解析逻辑，避免复制两份
        const normalized = data.map(normalizeChatHistoryRecord);
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
  }, [user.userId, user.deviceId, currentPage, textbookId, activeThreadStorageKey]);

  // 翻页/登录时刷新标记
  useEffect(() => { refreshMarkers(); }, [currentPage, user.userId, refreshMarkers]);

  const handleMarkerClick = useCallback((marker: Marker) => {
    selectActiveThreadId(marker.id);
    setActiveMarker(marker);
    // 桌面端 ChatPanel 展示对话，移动端弹 Popover
    if (window.innerWidth < 1024) {
      setShowMarkerPopover(true);
    }
  }, [selectActiveThreadId]);

  const handleDeleteMarker = useCallback(async (markerId: string) => {
    try {
      if (!user.token) return;
      await deleteChatHistory(markerId, user.token);
      setMarkers(prev => prev.filter(m => m.id !== markerId));
      setActiveMarker(prev => prev?.id === markerId ? null : prev);
      if (activeThreadId === markerId) selectActiveThreadId(null);
    } catch {}
  }, [activeThreadId, selectActiveThreadId, user.token]);

  const addMarker = useCallback((marker: Marker) => {
    setMarkers(prev => [...prev, marker]);
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
    showMarkerPopover,
    activeThreadId,
    refreshMarkers,
    handleMarkerClick,
    handleDeleteMarker,
    addMarker,
    updateMarker,
    getMarkerById,
    setActiveThreadId: selectActiveThreadId,
    setActiveMarker,
    setShowMarkerPopover,
  };
}
