import type { TokenResponse, UserProfile, UserProfileUpdate, CropBBox, ToolActivity } from '../types';
import { request, get, post, put, patch, del } from './request';
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

export async function fetchWithStage(
  userId: string,
  question: string,
  onStage: (stage: string, text: string) => void,
  imageData?: string,
  teachingMode: string = 'socratic',
  onThinking?: (text: string) => void,
  textbookId?: string,
  history?: Array<{ user: string; assistant: string }>,
  onIsThinkingChange?: (v: boolean) => void,
  onContent?: (text: string) => void,
  token?: string,
  pageNumber?: number,
  chatId?: string,
  markerId?: string,
  cropBBox?: { x: number; y: number; width: number; height: number; unit?: 'page_ratio' } | null,
  screenshotContextId?: string | null,
  onToolActivity?: (activity: ToolActivity) => void,
): Promise<{
  answer: string;
  sources: any[];
  thinking: string;
  toolActivities: ToolActivity[];
  screenshot_context_id?: string | null;
}> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    question,
    teaching_mode: teachingMode,
  };
  if (history) payload.history = history;
  if (token) payload.token = token;
  if (textbookId) payload.textbook_id = textbookId;
  if (pageNumber) payload.page_number = pageNumber;
  if (markerId) payload.marker_id = markerId;
  if (cropBBox) payload.crop_bbox = cropBBox;
  if (screenshotContextId) payload.screenshot_context_id = screenshotContextId;
  if (chatId) payload.chat_id = chatId;

  const formData = new FormData();
  formData.append('payload', JSON.stringify(payload));
  if (imageData) {
    const image = await prepareImageUpload(imageData);
    const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1] || 'png';
    formData.append('image', image, `screenshot.${extension}`);
  }

  // SSE 流使用 rawResponse 模式，手动解析
  const res = await request<Response>({
    url: '/qa/solve-stream',
    method: 'POST',
    body: formData,
    token,
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

  onIsThinkingChange?.(false);
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
          if (currentEventType === 'stage' && data.stage && data.text) onStage(data.stage, data.text);
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
            onToolActivity?.(activity);
          }
          else if (currentEventType === 'thinking' && data.text) {
            thinking += data.text;
            onIsThinkingChange?.(true);
            onThinking?.(data.text);
          }
          else if (currentEventType === 'content' && data.text) {
            onIsThinkingChange?.(false);
            fullContent += data.text;
            onContent?.(data.text);
          }
          else if (currentEventType === 'done') {
            if (!fullContent && data.full_text) {
              fullContent = data.full_text;
              onContent?.(data.full_text);
            }
            if (!thinking && data.thinking) {
              thinking = data.thinking;
              onThinking?.(data.thinking);
            }
            if (data.sources) sources = data.sources;
            if (!toolActivities.length && Array.isArray(data.tool_activities)) {
              toolActivities = data.tool_activities;
              toolActivities.forEach(activity => onToolActivity?.(activity));
            }
            if (data.screenshot_context_id) screenshotContextIdResult = data.screenshot_context_id;
          }
        }
      }
    }
  } finally {
    onIsThinkingChange?.(false);
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
