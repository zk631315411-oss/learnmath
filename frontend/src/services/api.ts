import type { TokenResponse, UserProfile, UserProfileUpdate, CropBBox, ToolActivity } from '../types';
// request 别名 apiRequest：fetchWithStage 的 options 参数名 request 会遮蔽该导入，故在模块级改名
import { request as apiRequest, get, post, put, patch, del } from './request';
import { prepareImageUpload } from '../utils/imageProcessing';

// === 用户认证相关 API ===

const anonymousRequests = new Map<string, Promise<TokenResponse>>();

export async function login(username: string, password: string): Promise<TokenResponse> {
  return post<TokenResponse>('/auth/login', { username, password });
}

export async function register(username: string, password: string, deviceId: string): Promise<TokenResponse> {
  return post<TokenResponse>('/auth/register', { username, password, device_id: deviceId });
}

export function anonymousAccess(deviceId: string): Promise<TokenResponse> {
  const pending = anonymousRequests.get(deviceId);
  if (pending) return pending;
  const req = post<TokenResponse>(`/auth/anonymous?device_id=${encodeURIComponent(deviceId)}`);
  const shared = req.finally(() => {
    if (anonymousRequests.get(deviceId) === shared) anonymousRequests.delete(deviceId);
  });
  anonymousRequests.set(deviceId, shared);
  return shared;
}

export async function getCurrentUser(token: string): Promise<UserProfile> {
  return get<UserProfile>('/auth/me', token);
}

export async function updateProfile(token: string, profile: UserProfileUpdate): Promise<UserProfile> {
  return put<UserProfile>('/auth/profile', profile, token);
}

// === 聊天历史 / 徽标 API ===

export async function getChatHistoryByUser(userId: string, page: number, limit: number): Promise<any[]> {
  return get<any[]>(`/chat/history/${encodeURIComponent(userId)}?page=${page}&limit=${limit}`);
}

// 拉取某用户的全量提问记录（跨所有页码）供侧栏分组展示。
// 不带 page 参数：后端 page 缺省即不过滤页码，limit 兜底控制上限。
export async function getAllChatHistory(userId: string, limit = 500): Promise<any[]> {
  return get<any[]>(`/chat/history/${encodeURIComponent(userId)}?limit=${limit}`);
}

export async function deleteChatHistory(chatId: string): Promise<void> {
  await del(`/chat/history/${chatId}`);
}

export async function createChatHistory(data: {
  user_id: string;
  question: string;
  answer: string | null;
  page_number: number;
  marker_y_ratio: number;
  marker_type: string;
  thumbnail?: string;
  crop_bbox?: string;
}): Promise<{ id: string }> {
  return post('/chat/history', data);
}

export async function patchChatHistory(chatId: string, data: Record<string, unknown>): Promise<void> {
  await patch(`/chat/history/${chatId}`, data);
}

// === 徽标迁移 API（匿名 → 登录） ===

export async function migrateMarkers(oldUserId: string, newUserId: string): Promise<void> {
  await post(`/chat/migrate?old_user_id=${encodeURIComponent(oldUserId)}&new_user_id=${encodeURIComponent(newUserId)}`);
}

// === SSE 流式问答 ===

export type FetchWithStageRequest = {
  user_id: string;
  question: string;
  // 教学模式可缺省：历史默认苏格拉底式软教学，组装 payload 时沿用原默认值
  teaching_mode?: string;
  image?: string;
  history?: Array<{ user: string; assistant: string }>;
  token?: string;
  textbook_id?: string;
  page_number?: number;
  chat_id?: string;
  marker_id?: string;
  crop_bbox?: CropBBox | null;
  screenshot_context_id?: string | null;
};

export type FetchWithStageCallbacks = {
  // 阶段提示（如"正在思考…"）：调用方必须提供，用于驱动 UI 的阶段展示
  onStage: (stage: string, text: string) => void;
  // 思考流式文本增量；缺省则不展示思考块内容
  onThinking?: (text: string) => void;
  // 思考态切换（进入/退出思考块）
  onIsThinkingChange?: (v: boolean) => void;
  // 正文流式文本增量
  onContent?: (text: string) => void;
  // 工具活动状态流转（tool_call / tool_result 事件）
  onToolActivity?: (activity: ToolActivity) => void;
};

export async function fetchWithStage({ request, callbacks }: {
  request: FetchWithStageRequest;
  callbacks: FetchWithStageCallbacks;
}): Promise<{
  answer: string;
  sources: any[];
  thinking: string;
  toolActivities: ToolActivity[];
  screenshot_context_id?: string | null;
}> {
  const payload: Record<string, unknown> = {
    user_id: request.user_id,
    question: request.question,
    // 缺省沿用历史默认教学模式，与旧签名的默认参数行为一致
    teaching_mode: request.teaching_mode ?? 'socratic',
  };
  if (request.history) payload.history = request.history;
  if (request.token) payload.token = request.token;
  if (request.textbook_id) payload.textbook_id = request.textbook_id;
  if (request.page_number) payload.page_number = request.page_number;
  if (request.marker_id) payload.marker_id = request.marker_id;
  if (request.crop_bbox) payload.crop_bbox = request.crop_bbox;
  if (request.screenshot_context_id) payload.screenshot_context_id = request.screenshot_context_id;
  if (request.chat_id) payload.chat_id = request.chat_id;

  const formData = new FormData();
  formData.append('payload', JSON.stringify(payload));
  if (request.image) {
    const image = await prepareImageUpload(request.image);
    const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1] || 'png';
    formData.append('image', image, `screenshot.${extension}`);
  }

  // SSE 流使用 rawResponse 模式，手动解析
  const res = await apiRequest<Response>({
    url: '/qa/solve-stream',
    method: 'POST',
    body: formData,
    token: request.token,
    rawResponse: true,
    headers: { Accept: 'text/event-stream' },
  });

  const reader = res.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let sources: any[] = [];
  let thinking = '';
  let toolActivities: ToolActivity[] = [];
  let screenshotContextIdResult: string | null = null;
  let currentEventType: string | null = null;

  callbacks.onIsThinkingChange?.(false);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) { currentEventType = null; continue; }
        if (trimmed.startsWith('event:')) { currentEventType = trimmed.slice(6).trim(); continue; }
        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          if (!dataStr) continue;
          let data: any;
          try { data = JSON.parse(dataStr); } catch { continue; }
          if (data.error && currentEventType === 'error') throw new Error(data.error);
          if (currentEventType === 'stage' && data.stage && data.text) callbacks.onStage(data.stage, data.text);
          else if ((currentEventType === 'tool_call' || currentEventType === 'tool_result') && data.id) {
            const existing = toolActivities.find(activity => activity.id === data.id);
            const activity: ToolActivity = {
              ...(existing || {}),
              ...data,
              id: String(data.id),
              tool: String(data.tool || existing?.tool || ''),
              label: String(data.label || existing?.label || '调用辅助工具'),
              status: data.status || existing?.status || 'running',
              arguments: data.arguments || existing?.arguments || {},
            };
            toolActivities = existing
              ? toolActivities.map(item => item.id === activity.id ? activity : item)
              : [...toolActivities, activity];
            callbacks.onToolActivity?.(activity);
          }
          else if (currentEventType === 'thinking' && data.text) {
            thinking += data.text;
            callbacks.onIsThinkingChange?.(true);
            callbacks.onThinking?.(data.text);
          }
          else if (currentEventType === 'content' && data.text) {
            callbacks.onIsThinkingChange?.(false);
            fullContent += data.text;
            callbacks.onContent?.(data.text);
          }
          else if (currentEventType === 'done') {
            if (!fullContent && data.full_text) {
              fullContent = data.full_text;
              callbacks.onContent?.(data.full_text);
            }
            if (!thinking && data.thinking) {
              thinking = data.thinking;
              callbacks.onThinking?.(data.thinking);
            }
            if (data.sources) sources = data.sources;
            if (!toolActivities.length && Array.isArray(data.tool_activities)) {
              toolActivities = data.tool_activities;
              toolActivities.forEach(activity => callbacks.onToolActivity?.(activity));
            }
            if (data.screenshot_context_id) screenshotContextIdResult = data.screenshot_context_id;
          }
        }
      }
    }
  } finally {
    callbacks.onIsThinkingChange?.(false);
  }
  return {
    answer: fullContent,
    sources,
    thinking,
    toolActivities,
    screenshot_context_id: screenshotContextIdResult,
  };
}

// === 公式转换 API ===

export type FormulaConversion = {
  latex: string;
  display_mode: 'inline' | 'block';
};

export async function convertFormula(
  description: string,
  preferredDisplay: 'auto' | 'inline' | 'block',
  token?: string,
): Promise<FormulaConversion> {
  return post<FormulaConversion>(
    '/formula/convert',
    { description, preferred_display: preferredDisplay },
    token,
    { timeout: 8_000, maxRetries: 0 },
  );
}
