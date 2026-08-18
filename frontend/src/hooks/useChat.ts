/**
 * 聊天与徽标状态管理（LearnMath 精简版）
 *
 * 保留：消息列表、SSE 流式问答、截图、徽标（marker）持久化。
 * 当前使用 Prompt 驱动的苏格拉底式软教学；不持久化结构化教学状态。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  createChatHistory, patchChatHistory,
  collapseExactRepeatedAnswer,
} from '../services/api';
import { streamQA } from '../services/streamQA';
import type { Marker } from '../components/PageMarker';
import type { Message, CropBBox, PendingImage, User } from '../types';

// 待发截图数量上限：超量截图直接拒绝并提示（后端未支持 images[] 前一次只发一张）；导出给 ChatPanel 复用，避免文案与判断条件出现两处字面量
export const MAX_PENDING_IMAGES = 3;

export interface SendMessageOptions {
  /** Page view starts a fresh thread even when another thread is still active in the panel. */
  newThread?: boolean;
  /** CaptureBubble sends its single image directly instead of entering the pending-image queue. */
  capture?: { image: string; cropBBox: CropBBox };
}

function generateId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
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
  // 待发送截图列表：每张截图带独立裁剪框，支持多图连发（当前一次只发第一张）
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [thinkingStage, setThinkingStage] = useState<string>('');
  const [thinkingStageKey, setThinkingStageKey] = useState<string>('');
  const [isThinking, setIsThinking] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
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
    setThinkingStageKey('');
  }, [userId]);

  // 当 activeMarker 变化，若它属于当前页，则把其问答加载进聊天面板。
  // 依赖里必须带上 currentPage：跨教材点击时先选中 marker、再等 PDFViewer 加载完新教材才回写页码，
  // 若只依赖 activeMarker?.id，effect 会在 currentPage 仍是旧书页码时命中「非当前页」守卫提前返回，
  // 之后页码追平也不会重跑，对话会永远不加载；带上 currentPage 让页码追平时重跑一次。
  useEffect(() => {
    if (!activeMarker) return;
    if (activeMarker.page_number !== currentPage) return;
    const msgs: Message[] = [
      { id: `${activeMarker.id}-q`, role: 'user', content: activeMarker.question, image: activeMarker.thumbnail || undefined },
    ];
    if (activeMarker.answer) {
      msgs.push({
        id: `${activeMarker.id}-a`, role: 'assistant', content: collapseExactRepeatedAnswer(activeMarker.answer),
        thinking: activeMarker.thinking || undefined,
        toolActivities: Array.isArray(activeMarker.tool_activities) ? activeMarker.tool_activities : [],
      });
    }
    for (const fu of activeMarker.follow_ups || []) {
      msgs.push({ id: `${activeMarker.id}-fuq-${fu.question.slice(0, 8)}`, role: 'user', content: fu.question, image: fu.image || undefined });
      if (fu.answer) msgs.push({
        id: `${activeMarker.id}-fua-${fu.answer.slice(0, 8)}`,
        role: 'assistant', content: collapseExactRepeatedAnswer(fu.answer), thinking: fu.thinking || undefined,
        toolActivities: Array.isArray(fu.tool_activities) ? fu.tool_activities : [],
      });
    }
    setMessages(msgs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMarker?.id, currentPage]);

  // 清空整个待发列表（待发送区的「清空」按钮）
  const clearPendingImages = useCallback(() => {
    setPendingImages([]);
  }, []);

  // 按 id 移除单张待发截图（待发送区缩略图的单张删除）
  const removePendingImage = useCallback((id: string) => {
    setPendingImages(prev => prev.filter(item => item.id !== id));
  }, []);

  // 面板展开/用户主动查看时清零未读角标
  const markRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const handleSendMessage = useCallback(async (content: string, options: SendMessageOptions = {}): Promise<Marker | null> => {
    const trimmed = content.trim();
    // 本次提问取待发列表第一张；后端 /solve-stream 未支持 images[] 前一次只发单张
    const explicitCapture = options.capture;
    const image = explicitCapture?.image || pendingImages[0]?.data;
    const firstCropBBox = explicitCapture?.cropBBox || pendingImages[0]?.cropBBox || null;
    if ((!trimmed && !image) || isLoading) return null;

    const userIdVal = user.userId || user.deviceId;
    const pageNumber = currentPage;
    const markerType: Marker['marker_type'] = image ? 'screenshot' : 'text';
    // 截图提问用真实选区：marker_y_ratio 取选区中心 Y，cropBBox 优先真实选区，缺失时兜底走旧的中间 80%
    const markerYRatio = image
      ? firstCropBBox
        ? (firstCropBBox.y + firstCropBBox.height / 2) * 100
        : 50
      : 0;
    const cropBBox = image
      ? firstCropBBox ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.8, unit: 'page_ratio' as const }
      : undefined;
    const effectiveThreadId = options.newThread ? null : activeThreadId;
    const isNewThread = !effectiveThreadId;
    const threadMarker = effectiveThreadId ? getMarkerById(effectiveThreadId) : undefined;
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
    for (let index = options.newThread ? messages.length : 0; index < messages.length; index += 1) {
      if (messages[index].role !== 'user') continue;
      const reply = messages[index + 1];
      historyPairs.push({
        user: messages[index].content,
        assistant: reply?.role === 'assistant' ? reply.content : '',
      });
    }

    const question = trimmed || (image ? '请解答这张图片中的题目' : '');
    const newUserMsg: Message = { id: generateId(), role: 'user', content: question, image };
    if (options.newThread) {
      setActiveThreadId(null);
      setActiveMarker(null);
    }
    setMessages(prev => options.newThread ? [newUserMsg] : [...prev, newUserMsg]);
    // 本次提问已取走第一张：立即移除，其余截图保留在待发列表（多图连发）
    if (!explicitCapture) setPendingImages(prev => prev.slice(1));
    setError(null);
    setIsLoading(true);
    setIsThinking(false);
    setThinkingStage('');
    setThinkingStageKey('');

    let chatId = effectiveThreadId || '';
    if (isNewThread) {
      try {
        const res = await createChatHistory({
          user_id: userIdVal,
          question,
          answer: null,
          page_number: pageNumber,
          marker_y_ratio: markerYRatio,
          marker_type: markerType,
          // 记录所属教材：hook 已持有 textbookId；空教材时传 undefined（不落字段），后端存 NULL 即全教材可见的老数据语义
          textbook_id: textbookId || undefined,
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

    setThinkingStage('正在思考…');
    setThinkingStageKey('');

    try {
      const result = await streamQA({
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
        }, {
        onStage: (stage, text) => {
          if (!isMountedRef.current) return;
          setThinkingStageKey(stage);
          setThinkingStage(text);
        },
        onThinkingChange: value => { if (isMountedRef.current) setIsThinking(value); },
        onUpdate: snapshot => {
          if (!isMountedRef.current) return;
          setMessages(prev => prev.map(message => message.id === assistantMsgId ? {
            ...message,
            content: snapshot.answer,
            thinking: snapshot.thinking,
            toolActivities: snapshot.toolActivities,
          } : message));
        },
      });

      const fullAnswer = result.answer;
      const fullThinking = result.thinking;
      const fullToolActivities = result.toolActivities;
      setMessages(prev => prev.map(m => m.id === assistantMsgId
        ? { ...m, content: fullAnswer, thinking: fullThinking, toolActivities: fullToolActivities }
        : m));

      let completedMarker: Marker | null = null;
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
          // 跨教材跳转判断依赖该字段：切书点击时据此识别记录所属教材；空教材记 null（与后端 NULL 老数据语义一致）
          textbook_id: textbookId || null,
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
        completedMarker = marker;
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
        completedMarker = updatedMarker;
      }
      await refreshMarkers();
      setHistoryVersion(version => version + 1);
      return completedMarker;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : '回答失败，请重试');
      if (isMountedRef.current) setError(msg);
      if (chatId && isNewThread) {
        try { await patchChatHistory(chatId, { answer: `[错误] ${msg}` }); } catch {}
      }
      setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: `抱歉，回答时出现了问题：${msg}` } : m));
      return null;
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setIsThinking(false);
        setThinkingStage('');
        setThinkingStageKey('');
        // done 与 error 两种结束都会走到这里：收尾时若聊天面板不可见，累计一条未读提醒用户
        if (!chatVisibleRef.current) setUnreadCount(prev => prev + 1);
      }
    }
  }, [
    user, currentPage, textbookId, isLoading, messages, activeThreadId,
    pendingImages,
    addMarker, updateMarker, getMarkerById, refreshMarkers,
    setActiveThreadId, setActiveMarker,
  ]);

  const handleCapture = useCallback((imageData: string, cropBBox: CropBBox) => {
    // 超量时拒绝新截图并提示，避免静默丢图
    if (pendingImages.length >= MAX_PENDING_IMAGES) {
      setError(`一次最多待发 ${MAX_PENDING_IMAGES} 张截图`);
      return;
    }
    setPendingImages(prev => [...prev, { id: generateId(), data: imageData, cropBBox }]);
  }, [pendingImages]);

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
    pendingImages,
    thinkingStage,
    thinkingStageKey,
    isThinking,
    handleSendMessage,
    handleCapture,
    removePendingImage,
    clearPendingImages,
    clearMessages,
    setError,
    unreadCount,
    markRead,
    historyVersion,
  };
}
