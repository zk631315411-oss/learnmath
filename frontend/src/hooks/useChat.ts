/**
 * 聊天与徽标状态管理（LearnMath 精简版）
 *
 * 保留：消息列表、SSE 流式问答、截图、徽标（marker）持久化。
 * 去掉：树状对话、可视化、练习、苏格拉底模式切换（阶段 2/3 再加）。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchWithStage, createChatHistory, patchChatHistory,
} from '../services/api';
import type { Marker } from '../components/PageMarker';
import type { Message, CropBBox, User } from '../types';

function generateId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export interface UseChatParams {
  user: User;
  currentPage: number;
  textbookId: string;
  markersState: {
    markers: Marker[];
    activeMarker: Marker | null;
    addMarker: (marker: Marker) => void;
    refreshMarkers: () => Promise<void>;
    setActiveMarker: (marker: Marker | null) => void;
  };
}

export function useChat({ user, currentPage, textbookId, markersState }: UseChatParams) {
  const { activeMarker, addMarker, refreshMarkers, setActiveMarker } = markersState;

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [thinkingStage, setThinkingStage] = useState<string>('');
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const userId = user.userId || user.deviceId;

  // 切换用户时清空消息
  useEffect(() => {
    setMessages([]);
    setError(null);
  }, [userId]);

  // 当 activeMarker 变化，若它属于当前页，则把其问答加载进聊天面板
  useEffect(() => {
    if (!activeMarker) return;
    if (activeMarker.page_number !== currentPage) return;
    const msgs: Message[] = [
      { id: `${activeMarker.id}-q`, role: 'user', content: activeMarker.question, image: activeMarker.thumbnail || undefined },
    ];
    if (activeMarker.answer) {
      msgs.push({ id: `${activeMarker.id}-a`, role: 'assistant', content: activeMarker.answer });
    }
    for (const fu of activeMarker.follow_ups || []) {
      msgs.push({ id: `${activeMarker.id}-fuq-${fu.question.slice(0, 8)}`, role: 'user', content: fu.question, image: fu.image || undefined });
      if (fu.answer) msgs.push({ id: `${activeMarker.id}-fua-${fu.answer.slice(0, 8)}`, role: 'assistant', content: fu.answer });
    }
    setMessages(msgs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMarker?.id]);

  const clearPendingImage = useCallback(() => {
    setPendingImage(null);
  }, []);

  const handleSendMessage = useCallback(async (content: string, image?: string) => {
    const trimmed = content.trim();
    if ((!trimmed && !image) || isLoading) return;

    const userIdVal = user.userId || user.deviceId;
    const pageNumber = currentPage;
    const markerType: Marker['marker_type'] = image ? 'screenshot' : 'text';
    const markerYRatio = image ? 50 : 0;
    const cropBBox = image ? { x: 0.1, y: 0.1, width: 0.8, height: 0.8, unit: 'page_ratio' as const } : undefined;

    const question = image ? '请解答这张图片中的题目' : trimmed;
    const newUserMsg: Message = { id: generateId(), role: 'user', content: question, image };
    setMessages(prev => [...prev, newUserMsg]);
    setPendingImage(null);
    setError(null);
    setIsLoading(true);
    setThinkingStage('');

    let chatId = '';
    try {
      const res = await createChatHistory({
        user_id: userIdVal,
        question,
        answer: null,
        page_number: pageNumber,
        marker_y_ratio: markerYRatio,
        marker_type: markerType,
        thumbnail: image || undefined,
        crop_bbox: cropBBox ? JSON.stringify(cropBBox) : undefined,
      });
      chatId = res.id;
    } catch { /* 落库失败不阻断问答 */ }

    const assistantMsgId = generateId();
    setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '' }]);

    // 用一个可变引用累积流式文本，避免闭包竞态
    const streamAcc = { text: '' };
    setThinkingStage('正在思考…');

    try {
      await fetchWithStage(
        userIdVal,
        question,
        (stage, text) => { if (isMountedRef.current) setThinkingStage(text); },
        image,
        'direct',
        undefined,
        textbookId || undefined,
        undefined,
        undefined,
        (text) => {
          streamAcc.text += text;
          if (isMountedRef.current) {
            setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: streamAcc.text } : m));
          }
        },
        user.token || undefined,
        pageNumber,
        chatId || undefined,
        chatId || undefined,
        cropBBox || null,
      );

      const fullAnswer = streamAcc.text;
      setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: fullAnswer } : m));

      if (chatId) {
        try { await patchChatHistory(chatId, { answer: fullAnswer, follow_ups: JSON.stringify([]) }); } catch {}
      }

      const marker: Marker = {
        id: chatId || generateId(),
        page_number: pageNumber,
        marker_y_ratio: markerYRatio,
        marker_type: markerType,
        question,
        answer: fullAnswer || null,
        thinking: null,
        thumbnail: image || null,
        crop_bbox: cropBBox || null,
        follow_ups: [],
      };
      addMarker(marker);
      setActiveMarker(marker);
      refreshMarkers();
    } catch (e) {
      const msg = (e instanceof Error ? e.message : '回答失败，请重试');
      if (isMountedRef.current) setError(msg);
      if (chatId) {
        try { await patchChatHistory(chatId, { answer: `[错误] ${msg}` }); } catch {}
      }
      setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: `抱歉，回答时出现了问题：${msg}` } : m));
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setThinkingStage('');
      }
    }
  }, [user, currentPage, textbookId, isLoading, addMarker, refreshMarkers, setActiveMarker]);

  const handleCapture = useCallback((imageData: string) => {
    setPendingImage(imageData);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    pendingImage,
    thinkingStage,
    handleSendMessage,
    handleCapture,
    clearPendingImage,
    clearMessages,
    setError,
  };
}
