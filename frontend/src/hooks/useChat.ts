/**
 * 聊天与徽标状态管理（LearnMath 精简版）
 *
 * 保留：消息列表、SSE 流式问答、截图、徽标（marker）持久化。
 * 当前使用 Prompt 驱动的苏格拉底式软教学；不持久化结构化教学状态。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  createChatHistory, patchChatHistory,
  appendFollowUp, updateFollowUp,
  collapseExactRepeatedAnswer,
  type FollowUpTurnPayload,
} from '../services/api';
import { streamQA } from '../services/streamQA';
import type { Marker } from '../components/PageMarker';
import type { Message, CropBBox, PendingImage, User } from '../types';
import type { LearningProgressResponse } from '../services/api';

// 待发截图数量上限：超量截图直接拒绝并提示（后端未支持 images[] 前一次只发一张）；导出给 ChatPanel 复用，避免文案与判断条件出现两处字面量
export const MAX_PENDING_IMAGES = 3;

export interface SendMessageOptions {
  /** Page view starts a fresh thread even when another thread is still active in the panel. */
  newThread?: boolean;
  /** CaptureBubble sends its single image directly instead of entering the pending-image queue. */
  capture?: { image: string; cropBBox: CropBBox | null; source?: PendingImage['source'] };
}

function generateId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// 稳定逻辑 turn ID（Batch 1）：优先 crypto.randomUUID（旧平板退化为随机串），
// 贯穿 pending 落库、SSE client_turn_id、消息 key 与 evidence 幂等
function generateTurnId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : generateId();
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
  onProgressDelta?: (delta: LearningProgressResponse | null | undefined, textbookId?: string) => void;
}

type AnswerTask = {
  turnId: string;
  chatId: string;
  isNewThread: boolean;
  userId: string;
  textbookId: string;
  pageNumber: number;
  markerType: Marker['marker_type'];
  assistantMsgId: string;
  controller: AbortController;
  status: 'streaming' | 'completed' | 'interrupted' | 'cancelled';
  answer: string;
};

export function useChat({ user, currentPage, textbookId, chatVisible, markersState, onProgressDelta }: UseChatParams) {
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
  // SPA 存活期间保留所有流式任务；任务归属固定，不随当前页面/教材变化。
  const tasksRef = useRef(new Map<string, AnswerTask>());
  const viewContextRef = useRef({ textbookId, currentPage, activeThreadId });
  // SSE 长回调的闭包里读不到最新 chatVisible，用 ref 保存最新值供收尾判断，避免闭包竞态
  const chatVisibleRef = useRef(chatVisible);
  const previousUserIdRef = useRef(user.userId || user.deviceId);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      tasksRef.current.forEach(task => task.controller.abort());
      tasksRef.current.clear();
    };
  }, []);

  useEffect(() => {
    chatVisibleRef.current = chatVisible;
  }, [chatVisible]);

  useEffect(() => {
    viewContextRef.current = { textbookId, currentPage, activeThreadId };
    const visible = Array.from(tasksRef.current.values()).some(task =>
      task.status === 'streaming'
      && task.userId === (user.userId || user.deviceId)
      && task.textbookId === textbookId
      && task.pageNumber === currentPage
      && (task.chatId
        ? task.chatId === activeThreadId || (task.isNewThread && activeThreadId === null)
        : task.isNewThread && activeThreadId === null)
    );
    setIsLoading(visible);
  }, [textbookId, currentPage, activeThreadId, user.userId, user.deviceId]);

  const userId = user.userId || user.deviceId;

  // 切换用户时清空消息与未读计数（未读属于上一个用户的会话，不能带进新用户）
  useEffect(() => {
    setMessages([]);
    setError(null);
    setUnreadCount(0);
    setThinkingStageKey('');
    const previousUserId = previousUserIdRef.current;
    if (previousUserId !== userId) {
      tasksRef.current.forEach(task => {
        if (task.userId === previousUserId && task.status === 'streaming') task.controller.abort();
      });
      previousUserIdRef.current = userId;
    }
  }, [userId]);

  // 当 activeMarker 变化，若它属于当前页，则把其问答加载进聊天面板。
  // 依赖里必须带上 currentPage：跨教材点击时先选中 marker、再等 PDFViewer 加载完新教材才回写页码，
  // 若只依赖 activeMarker?.id，effect 会在 currentPage 仍是旧书页码时命中「非当前页」守卫提前返回，
  // 之后页码追平也不会重跑，对话会永远不加载；带上 currentPage 让页码追平时重跑一次。
  useEffect(() => {
    if (!activeMarker) return;
    if (activeMarker.page_number !== currentPage) return;
    // 根记录生成状态：老数据无该字段，等价 completed
    const rootFailed = activeMarker.generation_status === 'interrupted' || activeMarker.generation_status === 'cancelled';
    const rootPending = activeMarker.generation_status === 'pending';
    const msgs: Message[] = [
      { id: `${activeMarker.id}-q`, role: 'user', content: activeMarker.question, image: activeMarker.thumbnail || undefined },
    ];
    if (activeMarker.answer) {
      msgs.push({
        id: `${activeMarker.id}-a`, role: 'assistant', content: collapseExactRepeatedAnswer(activeMarker.answer),
        thinking: activeMarker.thinking || undefined,
        toolActivities: Array.isArray(activeMarker.tool_activities) ? activeMarker.tool_activities : [],
        failed: rootFailed || undefined,
        pending: rootPending || undefined,
      });
    } else if (rootFailed || rootPending) {
      // 中断/取消且无正文：展示占位，错误描述不渲染成 assistant 正文
      msgs.push({ id: `${activeMarker.id}-a`, role: 'assistant', content: '', failed: rootFailed || undefined, pending: rootPending || undefined });
    }
    (activeMarker.follow_ups || []).forEach((fu, index) => {
      // 消息 key 用稳定 turn_id；老数据归一化层已补 legacy-${index}
      const turnId = fu.turn_id || `legacy-${index}`;
      const fuFailed = fu.status === 'interrupted' || fu.status === 'cancelled';
      const fuPending = fu.status === 'pending';
      msgs.push({ id: `${activeMarker.id}-${turnId}-question`, role: 'user', content: fu.question, image: fu.image || undefined });
      if (fu.answer) msgs.push({
        id: `${activeMarker.id}-${turnId}-answer`,
        role: 'assistant', content: collapseExactRepeatedAnswer(fu.answer), thinking: fu.thinking || undefined,
        toolActivities: Array.isArray(fu.tool_activities) ? fu.tool_activities : [],
        failed: fuFailed || undefined,
        pending: fuPending || undefined,
      });
      else if (fuFailed || fuPending) msgs.push({ id: `${activeMarker.id}-${turnId}-answer`, role: 'assistant', content: '', failed: fuFailed || undefined, pending: fuPending || undefined });
    });
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

  const isTaskVisible = useCallback((task: AnswerTask) => {
    const context = viewContextRef.current;
    return task.userId === (user.userId || user.deviceId)
      && task.textbookId === context.textbookId
      && task.pageNumber === context.currentPage
      && (task.chatId
        ? task.chatId === context.activeThreadId || (task.isNewThread && context.activeThreadId === null)
        : task.isNewThread && context.activeThreadId === null);
  }, [user.userId, user.deviceId]);

  const handleSendMessage = useCallback(async (content: string, options: SendMessageOptions = {}): Promise<Marker | null> => {
    const trimmed = content.trim();
    // 本次提问取待发列表第一张；后端 /solve-stream 未支持 images[] 前一次只发单张
    const explicitCapture = options.capture;
    const image = explicitCapture?.image || pendingImages[0]?.data;
    const pending = pendingImages[0];
    const imageSource: PendingImage['source'] = explicitCapture?.source || pending?.source || 'pdf-capture';
    const firstCropBBox = explicitCapture?.cropBBox || pending?.cropBBox || null;
    const visibleTask = Array.from(tasksRef.current.values()).some(task =>
      task.status === 'streaming' && isTaskVisible(task)
    );
    if ((!trimmed && !image) || visibleTask) return null;

    const userIdVal = user.userId || user.deviceId;
    const pageNumber = currentPage;
    const markerType: Marker['marker_type'] = image && imageSource === 'pdf-capture' ? 'screenshot' : 'text';
    // 截图提问用真实选区：marker_y_ratio 取选区中心 Y，cropBBox 优先真实选区，缺失时兜底走旧的中间 80%
    const markerYRatio = image && imageSource === 'pdf-capture'
      ? firstCropBBox
        ? (firstCropBBox.y + firstCropBBox.height / 2) * 100
        : 50
      : 0;
    const cropBBox = image && imageSource === 'pdf-capture'
      ? firstCropBBox ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.8, unit: 'page_ratio' as const }
      : undefined;
    const effectiveThreadId = options.newThread ? null : activeThreadId;
    const isNewThread = !effectiveThreadId;
    // 本轮稳定逻辑 turn ID：根问题进 client_turn_id 列，追问进 follow_ups.turn_id
    const turnId = generateTurnId();
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
          client_turn_id: turnId,
          thumbnail: image || undefined,
          crop_bbox: cropBBox ? JSON.stringify(cropBBox) : undefined,
        });
        chatId = res.id;
      } catch { /* 落库失败不阻断问答 */ }
    }

    // 追问先落 pending 项（服务端按 turn_id 幂等追加）；落库失败不阻断问答
    if (!isNewThread && chatId) {
      try {
        await appendFollowUp(chatId, {
          turn_id: turnId,
          question,
          image: image || null,
          crop_bbox: cropBBox || null,
          status: 'pending',
        });
      } catch { /* 落库失败不阻断问答 */ }
    }

    const assistantMsgId = generateId();
    const controller = new AbortController();
    const task: AnswerTask = {
      turnId,
      chatId,
      isNewThread,
      userId: userIdVal,
      textbookId,
      pageNumber,
      markerType,
      assistantMsgId,
      controller,
      status: 'streaming',
      answer: '',
    };
    tasksRef.current.set(turnId, task);
    setMessages(prev => [...prev, {
      id: assistantMsgId, role: 'assistant', content: '', thinking: '', toolActivities: [],
    }]);

    setThinkingStage('正在思考…');
    setThinkingStageKey('');

    // 已流出的部分正文：流中途失败时随 interrupted 状态落库，不再整段覆盖
    let partialAnswer = '';
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
           client_turn_id: turnId,
           signal: controller.signal,
          crop_bbox: requestCropBBox,
          screenshot_context_id: requestScreenshotContextId,
        }, {
        onStage: (stage, text) => {
          if (!isMountedRef.current || !isTaskVisible(task)) return;
          setThinkingStageKey(stage);
          setThinkingStage(text);
        },
        onThinkingChange: value => {
          if (isMountedRef.current && isTaskVisible(task)) setIsThinking(value);
        },
        onUpdate: snapshot => {
          partialAnswer = snapshot.answer;
          task.answer = snapshot.answer;
          if (!isMountedRef.current || !isTaskVisible(task)) return;
          setMessages(prev => prev.map(message => message.id === assistantMsgId ? {
            ...message,
            content: snapshot.answer,
            thinking: snapshot.thinking,
            toolActivities: snapshot.toolActivities,
          } : message));
        },
      });

      const fullAnswer = result.answer;
      task.answer = fullAnswer;
      task.status = 'completed';
      const fullThinking = result.thinking;
      const fullToolActivities = result.toolActivities;
      onProgressDelta?.(result.progress_delta, task.textbookId);
      if (isTaskVisible(task)) {
        setMessages(prev => prev.map(m => m.id === assistantMsgId
          ? { ...m, content: fullAnswer, thinking: fullThinking, toolActivities: fullToolActivities }
          : m));
      }

      let completedMarker: Marker | null = null;
      if (isNewThread) {
        if (chatId) {
          try {
            await patchChatHistory(chatId, {
              answer: fullAnswer,
              thinking: fullThinking,
              tool_activities: JSON.stringify(fullToolActivities),
              screenshot_context_id: result.screenshot_context_id || undefined,
              generation_status: 'completed',
              generation_error: null,
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
          generation_status: 'completed',
          client_turn_id: turnId,
        };
        if (isTaskVisible(task)) {
          addMarker(marker);
          setActiveThreadId(marker.id);
          setActiveMarker(marker);
        }
        completedMarker = marker;
      } else if (chatId && threadMarker) {
        const followUp = {
          turn_id: turnId,
          question,
          answer: fullAnswer || null,
          thinking: fullThinking || null,
          tool_activities: fullToolActivities,
          image: image || null,
          crop_bbox: cropBBox || null,
          screenshot_context_id: result.screenshot_context_id || null,
          qa_turn_id: result.qa_turn_id || null,
          status: 'completed' as const,
          error_message: null,
        };
        const updatedFollowUps = [...(threadMarker.follow_ups || []), followUp];
        const updatedMarker: Marker = {
          ...threadMarker,
          follow_ups: updatedFollowUps,
          thumbnail: image || threadMarker.thumbnail || null,
          crop_bbox: cropBBox || threadMarker.crop_bbox || null,
          screenshot_context_id: result.screenshot_context_id || threadMarker.screenshot_context_id || null,
        };
        if (isTaskVisible(task)) {
          updateMarker(chatId, () => updatedMarker);
          setActiveMarker(updatedMarker);
        }
        // 追问收尾走 turn 级更新（不再整体覆盖 follow_ups JSON）；根记录只补根级字段
        try {
          const completion: Partial<FollowUpTurnPayload> = {
            answer: fullAnswer,
            thinking: fullThinking || null,
            tool_activities: fullToolActivities,
            qa_turn_id: result.qa_turn_id || null,
            status: 'completed',
            error_message: null,
          };
          if (result.screenshot_context_id) completion.screenshot_context_id = result.screenshot_context_id;
          await updateFollowUp(chatId, turnId, completion);
        } catch {}
        try {
          await patchChatHistory(chatId, {
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
      const terminalStatus = controller.signal.aborted ? 'cancelled' : 'interrupted';
      task.status = terminalStatus;
      if (isMountedRef.current && isTaskVisible(task)) setError(msg);
      // 失败不再把 [错误] 文案写进 answer：落库已流出的部分正文 + 结构化状态
      if (chatId && isNewThread) {
        try {
          await patchChatHistory(chatId, {
            answer: partialAnswer,
            generation_status: terminalStatus,
            generation_error: msg,
          });
        } catch {}
      } else if (chatId) {
        try {
          await updateFollowUp(chatId, turnId, {
            answer: partialAnswer || null,
            status: terminalStatus,
            error_message: msg,
          });
        } catch {}
      }
      // UI 保留部分正文只标记中断；错误详情由输入框上方错误条展示
      if (isTaskVisible(task)) setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, failed: true } : m));
      return null;
    } finally {
      if (isMountedRef.current) {
        if (isTaskVisible(task)) setIsLoading(false);
        setIsThinking(false);
        setThinkingStage('');
        setThinkingStageKey('');
        // done 与 error 两种结束都会走到这里：收尾时若聊天面板不可见，累计一条未读提醒用户
        if (!chatVisibleRef.current || !isTaskVisible(task)) setUnreadCount(prev => prev + 1);
      }
      tasksRef.current.delete(turnId);
    }
  }, [
    user, currentPage, textbookId, messages, activeThreadId,
    pendingImages,
    addMarker, updateMarker, getMarkerById, refreshMarkers,
    setActiveThreadId, setActiveMarker,
    onProgressDelta, isTaskVisible,
  ]);

  const handleCapture = useCallback((imageData: string, cropBBox: CropBBox | null, source: PendingImage['source'] = 'pdf-capture') => {
    // 超量时拒绝新截图并提示，避免静默丢图
    if (pendingImages.length >= MAX_PENDING_IMAGES) {
      setError(`一次最多待发 ${MAX_PENDING_IMAGES} 张截图`);
      return;
    }
    setPendingImages(prev => [...prev, { id: generateId(), data: imageData, cropBBox, source }]);
  }, [pendingImages]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setActiveThreadId(null);
    setActiveMarker(null);
  }, [setActiveThreadId, setActiveMarker]);

  const cancelGeneration = useCallback((turnId?: string) => {
    if (turnId) tasksRef.current.get(turnId)?.controller.abort();
    else tasksRef.current.forEach(task => task.controller.abort());
  }, []);

  const cancelVisibleGeneration = useCallback(() => {
    const task = Array.from(tasksRef.current.values()).find(item =>
      item.status === 'streaming' && isTaskVisible(item)
    );
    task?.controller.abort();
  }, [isTaskVisible]);

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
    cancelGeneration,
    cancelVisibleGeneration,
  };
}
