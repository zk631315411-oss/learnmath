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
  getManimArtifactsForChat,
  type FollowUpTurnPayload,
} from '../services/api';
import { streamQA } from '../services/streamQA';
import { errorMessage } from '../utils/errorMessage';
import { useAnswerTasks, type AnswerTask } from './answerTaskStore';
import { projectThreadMessages } from './threadProjection';
import type { Marker } from '../components/PageMarker';
import type { Message, CropBBox, PendingImage, User } from '../types';
import type { LearningProgressResponse } from '../services/api';

// 待发图片队列上限；每轮顺序消费一张，导出给 ChatPanel 复用。
export const MAX_PENDING_IMAGES = 3;

export interface SendMessageOptions {
  /** Page view starts a fresh thread even when another thread is still active in the panel. */
  newThread?: boolean;
  /** Capture preview sends its single image directly instead of entering the pending-image queue. */
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
  // 待发图片队列：每张图片保留独立裁剪框，每轮顺序消费一张。
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [thinkingStage, setThinkingStage] = useState<string>('');
  const [thinkingStageKey, setThinkingStageKey] = useState<string>('');
  const [isThinking, setIsThinking] = useState(false);
  const [unreadByWorkspace, setUnreadByWorkspace] = useState<Record<string, number>>({});
  const [historyVersion, setHistoryVersion] = useState(0);
  const isMountedRef = useRef(true);
  // 任务注册表独立于聊天视图：导航只改变投影，不会改变请求归属。
  const { store: taskStore, tasks } = useAnswerTasks();
  const viewContextRef = useRef({ textbookId, currentPage, activeThreadId });
  // SSE 长回调的闭包里读不到最新 chatVisible，用 ref 保存最新值供收尾判断，避免闭包竞态
  const chatVisibleRef = useRef(chatVisible);
  const previousUserIdRef = useRef(user.userId || user.deviceId);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      taskStore.dispose();
    };
  }, [taskStore]);

  useEffect(() => {
    chatVisibleRef.current = chatVisible;
  }, [chatVisible]);

  useEffect(() => {
    viewContextRef.current = { textbookId, currentPage, activeThreadId };
    const visible = tasks.some(task =>
      (task.status === 'pending' || task.status === 'streaming')
      && task.userId === (user.userId || user.deviceId)
      && task.textbookId === textbookId
      && task.pageNumber === currentPage
      && (task.chatId
        ? task.chatId === activeThreadId || (task.turnKind === 'root' && activeThreadId === null)
        : task.turnKind === 'root' && activeThreadId === null)
    );
    setIsLoading(visible);
  }, [tasks, textbookId, currentPage, activeThreadId, user.userId, user.deviceId]);

  const userId = user.userId || user.deviceId;

  // 切换用户时清空消息与未读计数（未读属于上一个用户的会话，不能带进新用户）
  useEffect(() => {
    setMessages([]);
    setError(null);
    setThinkingStageKey('');
    const previousUserId = previousUserIdRef.current;
    if (previousUserId !== userId) {
      taskStore.cancelForUser(previousUserId);
      previousUserIdRef.current = userId;
    }
  }, [taskStore, userId]);

  const unreadKey = `${userId}:${textbookId}`;
  const unreadCount = unreadByWorkspace[unreadKey] || 0;

  useEffect(() => {
    setMessages(previous => {
      const next = projectThreadMessages(previous, tasks, {
        userId,
        textbookId,
        pageNumber: currentPage,
        activeThreadId,
      });
      // 浅比较守卫：投影结果无实际变化时复用 prev，阻断 render→setState→render 循环
      if (next.length === previous.length && next.every((message, index) => message === previous[index])) {
        return previous;
      }
      return next;
    });
    // Projection intentionally reacts to task snapshots and visible context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, userId, textbookId, currentPage, activeThreadId]);

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
        sources: activeMarker.sources,
        toolActivities: Array.isArray(activeMarker.tool_activities) ? activeMarker.tool_activities : [],
        artifacts: activeMarker.artifacts,
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
        sources: fu.sources,
        toolActivities: Array.isArray(fu.tool_activities) ? fu.tool_activities : [],
        artifacts: fu.artifacts,
        failed: fuFailed || undefined,
        pending: fuPending || undefined,
      });
      else if (fuFailed || fuPending) msgs.push({ id: `${activeMarker.id}-${turnId}-answer`, role: 'assistant', content: '', failed: fuFailed || undefined, pending: fuPending || undefined });
    });
    setMessages(msgs);
    if (!user.token) return;
    let cancelled = false;
    void getManimArtifactsForChat(activeMarker.id, user.token).then(artifacts => {
      if (cancelled || !artifacts.length) return;
      const byTurn = new Map<string, typeof artifacts>();
      artifacts.forEach(artifact => {
        const key = artifact.client_turn_id || activeMarker.client_turn_id || '';
        byTurn.set(key, [...(byTurn.get(key) || []), artifact]);
      });
      const rootArtifacts = byTurn.get(activeMarker.client_turn_id || '') || [];
      const hydrated = [...msgs];
      const attach = (messageId: string, items: typeof artifacts) => {
        if (!items.length) return;
        const index = hydrated.findIndex(message => message.id === messageId);
        if (index >= 0) hydrated[index] = { ...hydrated[index], artifacts: items };
        else hydrated.push({ id: messageId, role: 'assistant', content: '', artifacts: items });
      };
      attach(`${activeMarker.id}-a`, rootArtifacts);
      (activeMarker.follow_ups || []).forEach((fu, index) => {
        const turnId = fu.turn_id || `legacy-${index}`;
        attach(`${activeMarker.id}-${turnId}-answer`, byTurn.get(turnId) || []);
      });
      if (!cancelled) setMessages(hydrated);
    }).catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMarker?.id, currentPage, user.token]);

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
    setUnreadByWorkspace(previous => ({ ...previous, [unreadKey]: 0 }));
  }, [unreadKey]);

  const isTaskVisible = useCallback((task: AnswerTask) => {
    const context = viewContextRef.current;
    return task.userId === (user.userId || user.deviceId)
      && task.textbookId === context.textbookId
      && task.pageNumber === context.currentPage
      && (task.chatId
        ? task.chatId === context.activeThreadId || (task.turnKind === 'root' && context.activeThreadId === null)
        : task.turnKind === 'root' && context.activeThreadId === null);
  }, [user.userId, user.deviceId]);

  const handleSendMessage = useCallback(async (content: string, options: SendMessageOptions = {}): Promise<Marker | null> => {
    const trimmed = content.trim();
    // 本次提问取待发列表第一张；后端 /solve-stream 未支持 images[] 前一次只发单张
    const explicitCapture = options.capture;
    const image = explicitCapture?.image || pendingImages[0]?.data;
    const pending = pendingImages[0];
    const imageSource: PendingImage['source'] = explicitCapture?.source || pending?.source || 'pdf-capture';
    const firstCropBBox = explicitCapture?.cropBBox || pending?.cropBBox || null;
    const visibleTask = tasks.some(task =>
      (task.status === 'pending' || task.status === 'streaming') && isTaskVisible(task)
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
    const messagePrefix = effectiveThreadId ? `${effectiveThreadId}-${turnId}` : turnId;
    const newUserMsg: Message = { id: `${messagePrefix}-question`, role: 'user', content: question, image };
    if (options.newThread) {
      setActiveThreadId(null);
      setActiveMarker(null);
    }
    setMessages(prev => options.newThread ? [newUserMsg] : [...prev, newUserMsg]);
    // 本轮取走队首图片，其余图片留给后续独立问题。
    if (!explicitCapture) setPendingImages(prev => prev.slice(1));
    setError(null);
    setIsLoading(true);
    setIsThinking(false);
    setThinkingStage('');
    setThinkingStageKey('');

    // 注册必须早于任何持久化 await：切书/切线程发生在创建 history 期间时，任务仍有自己的身份。
    const assistantMsgId = `${messagePrefix}-answer`;
    const controller = new AbortController();
    let chatId = effectiveThreadId || '';
    const task: AnswerTask = {
      clientTurnId: turnId,
      userId: userIdVal,
      chatId,
      turnKind: isNewThread ? 'root' : 'follow_up',
      textbookId,
      pageNumber,
      markerType,
      assistantMsgId,
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
        client_turn_id: turnId,
        crop_bbox: requestCropBBox,
        screenshot_context_id: requestScreenshotContextId,
      },
      status: 'pending',
      answer: '',
      thinking: '',
      toolActivities: [],
      artifacts: [],
      sources: [],
      startedAt: Date.now(),
      controller,
    };
    taskStore.register(task);
    setMessages(prev => [...prev, {
      id: assistantMsgId, role: 'assistant', content: '', thinking: '', toolActivities: [],
    }]);

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
        taskStore.update(turnId, { chatId });
      } catch (e) {
        const detail = errorMessage(e, '');
        const msg = detail ? `创建提问记录失败：${detail}，请重试` : '创建提问记录失败，请重试';
        controller.abort();
        taskStore.finish(turnId, 'interrupted', { errorMessage: msg });
        if (!explicitCapture && pending) {
          setPendingImages(prev => [pending, ...prev]);
        }
        if (isMountedRef.current) {
          if (isTaskVisible(task)) {
            setMessages(prev => prev.map(message => message.id === assistantMsgId ? { ...message, failed: true } : message));
            setIsLoading(false);
            setError(msg);
          }
          setIsThinking(false);
          setThinkingStage('');
          setThinkingStageKey('');
        }
        return null;
      }
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

    taskStore.update(turnId, {
      chatId,
      request: { ...task.request, chat_id: chatId || undefined, marker_id: chatId || undefined },
    });
    taskStore.start(turnId);

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
          if (!taskStore.isActive(turnId) || !isMountedRef.current || !isTaskVisible(task)) return;
          setThinkingStageKey(stage);
          setThinkingStage(text);
        },
        onThinkingChange: value => {
          if (taskStore.isActive(turnId) && isMountedRef.current && isTaskVisible(task)) setIsThinking(value);
        },
        onUpdate: snapshot => {
          if (!taskStore.isActive(turnId)) return;
          partialAnswer = snapshot.answer;
          taskStore.update(turnId, {
            answer: snapshot.answer,
            thinking: snapshot.thinking,
            toolActivities: snapshot.toolActivities,
            artifacts: snapshot.artifacts,
            sources: snapshot.sources,
          });
          // 消息列表归属当前对话：翻页/切视图不算切换对话，流式增量必须落进 messages
          if (!isMountedRef.current) return;
          setMessages(prev => prev.map(message => message.id === assistantMsgId ? {
            ...message,
            content: snapshot.answer,
            thinking: snapshot.thinking,
            toolActivities: snapshot.toolActivities,
            artifacts: snapshot.artifacts,
            sources: snapshot.sources,
          } : message));
        },
      });

      if (!taskStore.isActive(turnId)) throw new DOMException('生成已取消', 'AbortError');

      const fullAnswer = result.answer;
      const fullThinking = result.thinking;
      const fullToolActivities = result.toolActivities;
      taskStore.finish(turnId, 'completed', {
        qaTurnId: result.qa_turn_id || null,
        answer: fullAnswer,
        thinking: fullThinking,
        toolActivities: fullToolActivities,
        artifacts: result.artifacts,
        sources: result.sources,
      });
      onProgressDelta?.(result.progress_delta, task.textbookId);
      if (isMountedRef.current) {
        setMessages(prev => prev.map(m => m.id === assistantMsgId
          ? { ...m, content: fullAnswer, thinking: fullThinking, toolActivities: fullToolActivities, artifacts: result.artifacts, sources: result.sources }
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
              sources: result.sources,
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
          sources: result.sources,
          artifacts: result.artifacts,
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
          sources: result.sources,
          image: image || null,
          crop_bbox: cropBBox || null,
          screenshot_context_id: result.screenshot_context_id || null,
          qa_turn_id: result.qa_turn_id || null,
          status: 'completed' as const,
          error_message: null,
          artifacts: result.artifacts,
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
            sources: result.sources,
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
      if (task.textbookId === viewContextRef.current.textbookId) await refreshMarkers();
      setHistoryVersion(version => version + 1);
      return completedMarker;
    } catch (e) {
      const msg = errorMessage(e, '回答失败，请重试');
      const terminalStatus = controller.signal.aborted ? 'cancelled' : 'interrupted';
      const latestAnswer = taskStore.get(turnId)?.answer || partialAnswer;
      taskStore.finish(turnId, terminalStatus, { answer: latestAnswer, errorMessage: msg });
      if (isMountedRef.current && isTaskVisible(task)) setError(msg);
      // 失败不再把 [错误] 文案写进 answer：落库已流出的部分正文 + 结构化状态
      if (chatId && isNewThread) {
        try {
          await patchChatHistory(chatId, {
            answer: latestAnswer,
            generation_status: terminalStatus,
            generation_error: msg,
          });
        } catch {}
      } else if (chatId) {
        try {
          await updateFollowUp(chatId, turnId, {
            answer: latestAnswer || null,
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
        if (!chatVisibleRef.current || !isTaskVisible(task)) {
          const taskUnreadKey = `${task.userId}:${task.textbookId}`;
          setUnreadByWorkspace(previous => ({ ...previous, [taskUnreadKey]: (previous[taskUnreadKey] || 0) + 1 }));
        }
      }
    }
  }, [
    user, currentPage, textbookId, messages, activeThreadId,
    pendingImages,
    addMarker, updateMarker, getMarkerById, refreshMarkers,
    setActiveThreadId, setActiveMarker,
    onProgressDelta, isTaskVisible, taskStore,
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
    if (turnId) taskStore.cancel(turnId);
    else taskStore.getAll().filter(task => task.userId === userId).forEach(task => taskStore.cancel(task.clientTurnId));
  }, [taskStore, userId]);

  const cancelVisibleGeneration = useCallback(() => {
    const task = tasks.find(item =>
      (item.status === 'pending' || item.status === 'streaming') && isTaskVisible(item)
    );
    if (task) taskStore.cancel(task.clientTurnId);
  }, [isTaskVisible, taskStore, tasks]);

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
