import { useState, useEffect, useCallback } from 'react';

import { getAllChatHistory } from '../services/api';
import { normalizeChatHistoryRecord } from '../utils/chatHistory';
import type { Marker } from '../components/PageMarker';
import type { User } from '../types';

/**
 * 拉取某用户的全量提问记录（跨所有页码），供「提问记录侧栏」使用。
 *
 * 刷新时机（为什么用 chatMessageCount 作为信号）：
 * useChat 每发一问都会先把新 thread 落库（createChatHistory），随后追加助手占位消息，
 * 使 messages.length 必然 +1；因此该值变化时新记录一定已写库，刷新即可拿到最新提问。
 * 相比在 useChat 里再暴露一个专用回调，这里复用现成的长度信号更简单、与聊天逻辑解耦。
 */
export function useQuestionList(user: User, chatMessageCount: number) {
  const [items, setItems] = useState<Marker[]>([]);
  const [loading, setLoading] = useState(false);
  const userId = user.userId || user.deviceId;

  const refresh = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const data = await getAllChatHistory(userId, 500);
      setItems(Array.isArray(data) ? data.map(normalizeChatHistoryRecord) : []);
    } catch {
      // 拉取失败保留旧列表：侧栏不是主链路，失败不应打断阅读，下一次触发时会再试
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // user 变化或聊天消息条数变化时刷新；refresh 随 userId 变化，保证新用户数据不串号
  useEffect(() => {
    refresh();
  }, [userId, chatMessageCount, refresh]);

  return { items, loading, refresh };
}
