/**
 * 聊天与徽标状态管理（LearnMath 精简版）
 *
 * 保留：消息列表、SSE 流式问答、截图、徽标（marker）持久化。
 * 当前使用 Prompt 驱动的苏格拉底式软教学；不持久化结构化教学状态。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchWithStage, createChatHistory, patchChatHistory,
} from '../services/api';
import type { Marker } from '../components/PageMarker';
import type { Message, CropBBox, ToolActivity, User } from '../types';

function generateId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function upsertToolActivity(items: ToolActivity[], activity: ToolActivity): ToolActivity[] {
  return items.some(item => item.id === activity.id)
    ? items.map(item => item.id === activity.id ? activity : item)
    : [...items, activity];
}

export interface UseChatParams {
  user: User;
  currentPage: number;
  textbookId: string;
  /** 聊天面板当前是否可见（由调用方判定）；用于回答收尾时决定是否累计未读 */
  chatVisible: boolean;
  markersState: {
    markers: Marker[];
    activeMarker: Marker | null;
    activeThreadId: string | null;
    addMarker: (marker: Marker) => void;
    updateMarker: (id: string, updater: (marker: Marker) => Marker) => void;
    getMarkerById: (id: string | null) => Marker | undefined;
    refreshMarkers: () => Promise<void>;
    setActiveThreadId: (threadId: string | null) => void;
    setActiveMarker: (marker: Marker | null) => void;
  };
}

export function useChat({ user, currentPage, textbookId, chatVisible, markersState }: UseChatParams) {
  const {
    activeMarker,
    activeThreadId,
    addMarker,
    updateMarker,
    getMarkerById,
    refreshMarkers,
    setActiveThreadId,
    setActiveMarker,
  } = markersState;

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingCropBBox, setPendingCropBBox] = useState<CropBBox | null>(null);
  const [thinkingStage, setThinkingStage] = useState<string>('');
  const [isThinking, setIsThinking] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const isMountedRef = useRef(true);
  // SSE 长回调的闭包里读不到最新 chatVisible，用 ref 保存最新值供收尾判断，避免闭包竞态
  const chatVisibleRef = useRef(chatVisible);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    chatVisibleRef.current = chatVisible;
  }, [chatVisible]);

  const userId = user.userId || user.deviceId;

  // 切换用户时清空消息与未读计数（未读属于上一个用户的会话，不能带进新用户）
  useEffect(() => {
    setMessages([]);
    setError(null);
    setUnreadCount(0);
  }, [userId]);

  // 当 activeMarker 变化，若它属于当前页，则把其问答加载进聊天面板
  useEffect(() => {
    if (!activeMarker) return;
    if (activeMarker.page_number !== currentPage) return;
    const msgs: Message[] = [
      { id: `${activeMarker.id}-q`, role: 'user', content: activeMarker.question, image: activeMarker.thumbnail || undefined },
    ];
    if (activeMarker.answer) {
      msgs.push({
        id: `${activeMarker.id}-a`, role: 'assistant', content: activeMarker.answer,
        thinking: activeMarker.thinking || undefined,
        toolActivities: Array.isArray(activeMarker.tool_activities) ? activeMarker.tool_activities : [],
      });
    }
    for (const fu of activeMarker.follow_ups || []) {
      msgs.push({ id: `${activeMarker.id}-fuq-${fu.question.slice(0, 8)}`, role: 'user', content: fu.question, image: fu.image || undefined });
      if (fu.answer) msgs.push({
        id: `${activeMarker.id}-fua-${fu.answer.slice(0, 8)}`,
        role: 'assistant', content: fu.answer, thinking: fu.thinking || undefined,
        toolActivities: Array.isArray(fu.tool_activities) ? fu.tool_activities : [],
      });
    }
    setMessages(msgs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMarker?.id]);

  const clearPendingImage = useCallback(() => {
    setPendingImage(null);
    setPendingCropBBox(null);
  }, []);

  // 面板展开/用户主动查看时清零未读角标
  const markRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const handleSendMessage = useCallback(async (content: string, image?: string) => {
    const trimmed = content.trim();
    if ((!trimmed && !image) || isLoading) return;

    const userIdVal = user.userId || user.deviceId;
    const pageNumber = currentPage;
    const markerType: Marker['marker_type'] = image ? 'screenshot' : 'text';
    // 截图提问用真实选区：marker_y_ratio 取选区中心 Y，cropBBox 优先真实选区，缺失时兜底走旧的中间 80%
    const markerYRatio = image
      ? pendingCropBBox
        ? (pendingCropBBox.y + pendingCropBBox.height / 2) * 100
        : 50
      : 0;
    const cropBBox = image
      ? pendingCropBBox ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.8, unit: 'page_ratio' as const }
      : undefined;
    const isNewThread = !activeThreadId;
    const threadMarker = activeThreadId ? getMarkerById(activeThreadId) : undefined;
    const inheritedImage = !image && threadMarker?.marker_type === 'screenshot'
      ? threadMarker.thumbnail || undefined
      : undefined;
    const requestImage = image || inheritedImage;
    const inheritedCropBBox = threadMarker?.crop_bbox && typeof threadMarker.crop_bbox !== 'string'
      ? threadMarker.crop_bbox
      : null;
    const requestCropBBox = cropBBox || inheritedCropBBox;
    const requestScreenshotContextId = threadMarker?.screenshot_context_id || null;

    const historyPairs: Array<{ user: string; assistant: string }> = [];
    for (let index = 0; index < messages.length; index += 1) {
      if (messages[index].role !== 'user') continue;
      const reply = messages[index + 1];
      historyPairs.push({
        user: messages[index].content,
        assistant: reply?.role === 'assistant' ? reply.content : '',
      });
    }

    const question = trimmed || (image ? '请解答这张图片中的题目' : '');
    const newUserMsg: Message = { id: generateId(), role: 'user', content: question, image };
    setMessages(prev => [...prev, newUserMsg]);
    setPendingImage(null);
    setError(null);
    setIsLoading(true);
    setIsThinking(false);
    setThinkingStage('');

    let chatId = activeThreadId || '';
    if (isNewThread) {
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
    }

    const assistantMsgId = generateId();
    setMessages(prev => [...prev, {
      id: assistantMsgId, role: 'assistant', content: '', thinking: '', toolActivities: [],
    }]);

    // 用一个可变引用累积流式文本，避免闭包竞态
    const streamAcc: { text: string; thinking: string; toolActivities: ToolActivity[] } = {
      text: '', thinking: '', toolActivities: [],
    };
    setThinkingStage('正在思考…');

    try {
      const result = await fetchWithStage({
        request: {
          user_id: userIdVal,
          question,
          teaching_mode: 'socratic',
          image: requestImage,
          history: historyPairs.length ? historyPairs : undefined,
          token: user.token || undefined,
          textbook_id: textbookId || undefined,
          page_number: pageNumber,
          chat_id: chatId || undefined,
          marker_id: chatId || undefined,
          crop_bbox: requestCropBBox,
          screenshot_context_id: requestScreenshotContextId,
        },
        callbacks: {
          onStage: (stage, text) => { if (isMountedRef.current) setThinkingStage(text); },
          onThinking: (text) => {
            streamAcc.thinking += text;
            if (isMountedRef.current) {
              setMessages(prev => prev.map(m => m.id === assistantMsgId
                ? { ...m, thinking: streamAcc.thinking }
                : m));
            }
          },
          onIsThinkingChange: (value) => { if (isMountedRef.current) setIsThinking(value); },
          onContent: (text) => {
            streamAcc.text += text;
            if (isMountedRef.current) {
              setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: streamAcc.text } : m));
            }
          },
          onToolActivity: (activity) => {
            streamAcc.toolActivities = upsertToolActivity(streamAcc.toolActivities, activity);
            if (isMountedRef.current) {
              setMessages(prev => prev.map(m => m.id === assistantMsgId
                ? { ...m, toolActivities: streamAcc.toolActivities }
                : m));
            }
          },
        },
      });

      const fullAnswer = streamAcc.text || result.answer;
      const fullThinking = streamAcc.thinking || result.thinking;
      const fullToolActivities = streamAcc.toolActivities.length
        ? streamAcc.toolActivities
        : result.toolActivities;
      setMessages(prev => prev.map(m => m.id === assistantMsgId
        ? { ...m, content: fullAnswer, thinking: fullThinking, toolActivities: fullToolActivities }
        : m));

      if (isNewThread) {
        if (chatId) {
          try {
            await patchChatHistory(chatId, {
              answer: fullAnswer,
              thinking: fullThinking,
              tool_activities: JSON.stringify(fullToolActivities),
              screenshot_context_id: result.screenshot_context_id || undefined,
            });
          } catch {}
        }

        const marker: Marker = {
          id: chatId || generateId(),
          page_number: pageNumber,
          marker_y_ratio: markerYRatio,
          marker_type: markerType,
          question,
          answer: fullAnswer || null,
          thinking: fullThinking || null,
          tool_activities: fullToolActivities,
          thumbnail: image || null,
          crop_bbox: cropBBox || null,
          screenshot_context_id: result.screenshot_context_id || null,
          follow_ups: [],
        };
        addMarker(marker);
        setActiveThreadId(marker.id);
        setActiveMarker(marker);
      } else if (chatId && threadMarker) {
        const followUp = {
          question,
          answer: fullAnswer || null,
          thinking: fullThinking || null,
          tool_activities: fullToolActivities,
          image: image || null,
          crop_bbox: cropBBox || null,
          screenshot_context_id: result.screenshot_context_id || null,
        };
        const updatedFollowUps = [...(threadMarker.follow_ups || []), followUp];
        const updatedMarker: Marker = {
          ...threadMarker,
          follow_ups: updatedFollowUps,
          thumbnail: image || threadMarker.thumbnail || null,
          crop_bbox: cropBBox || threadMarker.crop_bbox || null,
          screenshot_context_id: result.screenshot_context_id || threadMarker.screenshot_context_id || null,
        };
        updateMarker(chatId, () => updatedMarker);
        setActiveMarker(updatedMarker);
        try {
          await patchChatHistory(chatId, {
            follow_ups: JSON.stringify(updatedFollowUps),
            screenshot_context_id: updatedMarker.screenshot_context_id || undefined,
            thumbnail: updatedMarker.thumbnail || undefined,
            crop_bbox: updatedMarker.crop_bbox
              ? JSON.stringify(updatedMarker.crop_bbox)
              : undefined,
          });
        } catch {}
      }
      refreshMarkers();
      setPendingCropBBox(null);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : '回答失败，请重试');
      if (isMountedRef.current) setError(msg);
      if (chatId && isNewThread) {
        try { await patchChatHistory(chatId, { answer: `[错误] ${msg}` }); } catch {}
      }
      setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: `抱歉，回答时出现了问题：${msg}` } : m));
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setIsThinking(false);
        setThinkingStage('');
        // done 与 error 两种结束都会走到这里：收尾时若聊天面板不可见，累计一条未读提醒用户
        if (!chatVisibleRef.current) setUnreadCount(prev => prev + 1);
      }
    }
  }, [
    user, currentPage, textbookId, isLoading, messages, activeThreadId,
    pendingCropBBox,
    addMarker, updateMarker, getMarkerById, refreshMarkers,
    setActiveThreadId, setActiveMarker,
  ]);

  const handleCapture = useCallback((imageData: string, cropBBox: CropBBox) => {
    setPendingImage(imageData);
    setPendingCropBBox(cropBBox);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setActiveThreadId(null);
    setActiveMarker(null);
  }, [setActiveThreadId, setActiveMarker]);

  return {
    messages,
    isLoading,
    error,
    pendingImage,
    pendingCropBBox,
    thinkingStage,
    isThinking,
    handleSendMessage,
    handleCapture,
    clearPendingImage,
    clearMessages,
    setError,
    unreadCount,
    markRead,
  };
}
