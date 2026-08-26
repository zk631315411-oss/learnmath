import type { TokenResponse, UserProfile, CropBBox, ManimArtifact, ToolActivity, ChatHistoryRecord, Source } from '../types';
// request 别名 apiRequest：fetchWithStage 的 options 参数名 request 会遮蔽该导入，故在模块级改名
import { request as apiRequest, get, post, patch, del } from './request';
import { prepareImageUpload } from '../utils/imageProcessing';
import type { RecognizedContent } from '../types';

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

export type FeedbackSubmission = {
  rating: number;
  most_used_feature?: string;
  disappointing_feature?: string;
  disappointing_reason?: string;
  problem_description?: string;
  recommend?: string;
  suggestion?: string;
  contact?: string;
  page_url?: string;
};

export function submitFeedback(payload: FeedbackSubmission, token?: string): Promise<{ status: string; id: string }> {
  return post('/feedback', payload, token, { maxRetries: 0, timeout: 10_000 });
}

// === 聊天历史 / 徽标 API ===

export async function getChatHistoryByUser(userId: string, page: number, limit: number, textbookId?: string): Promise<ChatHistoryRecord[]> {
  // 仅当教材 ID 为真值时追加过滤参数：空字符串/undefined 不拼接，
  // 避免把「未选教材」误传成后端「只查 NULL 老数据」的边界语义
  const textbookParam = textbookId ? `&textbook_id=${encodeURIComponent(textbookId)}` : '';
  return get<ChatHistoryRecord[]>(`/chat/history/${encodeURIComponent(userId)}?page=${page}&limit=${limit}${textbookParam}`);
}

// 拉取某用户的全量提问记录（跨所有页码）供侧栏分组展示。
// 不带 page 参数：后端 page 缺省即不过滤页码，limit 兜底控制上限。
export async function getAllChatHistory(userId: string, limit = 500, textbookId?: string): Promise<ChatHistoryRecord[]> {
  const textbookParam = textbookId ? `&textbook_id=${encodeURIComponent(textbookId)}` : '';
  return get<ChatHistoryRecord[]>(`/chat/history/${encodeURIComponent(userId)}?limit=${limit}${textbookParam}`);
}

export async function deleteChatHistory(chatId: string, token: string): Promise<void> {
  // 删除是明确的用户操作，失败后由记录面板提供重试；避免通用请求层的多次自动重试让确认框长时间卡在“删除中”。
  await del(`/chat/history/${chatId}`, token, { maxRetries: 0, timeout: 10_000 });
}

export async function createChatHistory(data: {
  user_id: string;
  question: string;
  answer: string | null;
  page_number: number;
  marker_y_ratio: number;
  marker_type: string;
  // 教材归属：可选，老前端未传时后端存 NULL（全教材可见），保持向后兼容
  textbook_id?: string;
  thumbnail?: string;
  crop_bbox?: string;
  // 稳定逻辑 turn ID（Batch 1）：贯穿 pending 落库、重试幂等与 evidence 去重
  client_turn_id?: string;
}): Promise<{ id: string }> {
  return post('/chat/history', data);
}

export async function patchChatHistory(chatId: string, data: Record<string, unknown>): Promise<void> {
  await patch(`/chat/history/${chatId}`, data);
}

// 学生自定义对话标题；传空字符串清除自定义，回到沿用 question 原文
export async function updateChatTitle(chatId: string, title: string): Promise<void> {
  await patchChatHistory(chatId, { title });
}

// === 追问 turn API（Batch 1：按 chat_id + turn_id 的服务端原子追加/更新） ===

export type GenerationStatus = 'pending' | 'completed' | 'interrupted' | 'cancelled';

export interface FollowUpTurnPayload {
  turn_id: string;
  question: string;
  answer?: string | null;
  thinking?: string | null;
  tool_activities?: ToolActivity[];
  image?: string | null;
  crop_bbox?: CropBBox | null;
  screenshot_context_id?: string | null;
  qa_turn_id?: string | null;
  status?: GenerationStatus;
  error_message?: string | null;
}

/** 发送追问时先落 pending 项；turn_id 幂等，重复追加返回既有项 */
export async function appendFollowUp(chatId: string, turn: FollowUpTurnPayload): Promise<void> {
  await post(`/chat/history/${encodeURIComponent(chatId)}/follow-ups`, turn);
}

/** SSE 收尾（或失败）时按 turn_id 更新单条追问；显式 null 字段表示清空 */
export async function updateFollowUp(chatId: string, turnId: string, fields: Partial<FollowUpTurnPayload>): Promise<void> {
  await patch(`/chat/history/${encodeURIComponent(chatId)}/follow-ups/${encodeURIComponent(turnId)}`, fields);
}

// === 徽标迁移 API（匿名 → 登录） ===

export async function migrateMarkers(oldToken: string, newToken: string): Promise<void> {
  await post('/chat/migrate', { old_token: oldToken }, newToken);
}

// === Manim 动画制品 API ===

export function getManimArtifact(artifactId: string, token: string): Promise<ManimArtifact> {
  return get(`/manim/artifacts/${encodeURIComponent(artifactId)}`, token, { maxRetries: 0 });
}

export function getManimArtifactsForChat(chatId: string, token: string): Promise<ManimArtifact[]> {
  return get(`/manim/artifacts?chat_id=${encodeURIComponent(chatId)}`, token, { maxRetries: 0 });
}

export function retryManimArtifact(artifactId: string, token: string): Promise<ManimArtifact> {
  return post(`/manim/artifacts/${encodeURIComponent(artifactId)}/retry`, undefined, token, { maxRetries: 0 });
}

// === 学习地图 API ===

export type LearningStatus = 'unexplored' | 'learning' | 'basically_mastered' | 'mastered' | 'needs_review';
export type StatusCounts = Record<LearningStatus, number>;

export interface ChapterMapItem {
  chapter: string;
  node_count: number;
  status_counts: StatusCounts;
  exploration_progress: { explored: number; total: number };
}

export interface LearningMapNode {
  node_id: string;
  name: string;
  type?: string;
  order?: number;
  page?: number | null;
  section: string;
  status: LearningStatus;
  closed_evidence_count: number;
  blocked: boolean;
  chat: { id: string | null; available: boolean };
}

export interface ChapterMapResponse { textbook_id: string; chapters: ChapterMapItem[] }
export interface NodeMapResponse {
  textbook_id: string;
  chapter: string;
  sections: Array<{ section: string; page?: number | null; nodes: LearningMapNode[] }>;
}

export interface LearningProgressNode {
  status: LearningStatus;
  closed_evidence_count: number;
  last_activity_at?: string | null;
  source_chat_id?: string | null;
}

export interface LearningProgressResponse {
  textbook_id: string;
  catalog_version: string;
  revision: number;
  nodes: Record<string, LearningProgressNode>;
}

export function getLearningProgress(textbookId: string, token: string): Promise<LearningProgressResponse> {
  return get(`/learning-progress?textbook_id=${encodeURIComponent(textbookId)}`, token, { maxRetries: 1, timeout: 8_000 });
}

export function getChapterMap(textbookId: string, token: string): Promise<ChapterMapResponse> {
  return get(`/learning-map/chapters?textbook_id=${encodeURIComponent(textbookId)}`, token, { maxRetries: 0 });
}

export function getNodeMap(textbookId: string, chapter: string, token: string): Promise<NodeMapResponse> {
  return get(`/learning-map/nodes?textbook_id=${encodeURIComponent(textbookId)}&chapter=${encodeURIComponent(chapter)}`, token, { maxRetries: 0 });
}

export interface PageSectionsResponse {
  textbook_id: string;
  page_sections: Record<string, string>;
}

export function getPageSections(textbookId: string, token: string): Promise<PageSectionsResponse> {
  return get(`/learning-map/page-sections?textbook_id=${encodeURIComponent(textbookId)}`, token, { maxRetries: 0 });
}

export interface SectionPageResponse {
  page: number | null;
  confidence: number;
  matched_text?: string | null;
}

export function getSectionPage(textbookId: string, section: string, token: string): Promise<SectionPageResponse> {
  return get(`/textbook/section-page?textbook_id=${encodeURIComponent(textbookId)}&section=${encodeURIComponent(section)}`, token, { maxRetries: 0, timeout: 5_000 });
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
  // 稳定逻辑 turn ID（Batch 1）：与落库 pending 记录/追问项同 ID，供重试幂等
  client_turn_id?: string;
  signal?: AbortSignal;
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
  onArtifact?: (artifact: ManimArtifact) => void;
};

type SsePayload = {
  error?: string;
  stage?: string;
  text?: string;
  id?: string | number;
  tool?: string;
  label?: string;
  status?: ToolActivity['status'];
  arguments?: Record<string, unknown>;
  full_text?: string;
  thinking?: string;
  sources?: Source[];
  tool_activities?: ToolActivity[];
  screenshot_context_id?: string | null;
  qa_turn_id?: string | null;
  progress_delta?: LearningProgressResponse | null;
  artifacts?: ManimArtifact[];
};

/**
 * Some model providers can repeat the complete final answer after a long
 * tool/reasoning turn. Only collapse an exact whole-string repetition; normal
 * repeated sentences remain untouched.
 */
export function collapseExactRepeatedAnswer(value: string): string {
  const text = value.trim();
  if (text.length < 160) return text;
  const comparable = (part: string) => part.replace(/\s+/g, ' ').trim();
  for (let split = Math.ceil(text.length / 2); split < text.length; split += 1) {
    const left = text.slice(0, split);
    const right = text.slice(split);
    if (comparable(left) === comparable(right) && comparable(left).length >= 80) {
      return left.trim();
    }
  }
  return text;
}

export async function fetchWithStage({ request, callbacks }: {
  request: FetchWithStageRequest;
  callbacks: FetchWithStageCallbacks;
}): Promise<{
  answer: string;
  sources: Source[];
  thinking: string;
  toolActivities: ToolActivity[];
  screenshot_context_id?: string | null;
  qa_turn_id?: string | null;
  progress_delta?: LearningProgressResponse | null;
  artifacts: ManimArtifact[];
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
  if (request.client_turn_id) payload.client_turn_id = request.client_turn_id;

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
    signal: request.signal,
  });

  const reader = res.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');
  let aborted = request.signal?.aborted || false;
  const abortReader = () => {
    aborted = true;
    void reader.cancel().catch(() => undefined);
  };
  request.signal?.addEventListener('abort', abortReader, { once: true });

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let sources: Source[] = [];
  let thinking = '';
  let toolActivities: ToolActivity[] = [];
  let screenshotContextIdResult: string | null = null;
  let qaTurnIdResult: string | null = null;
  let progressDelta: LearningProgressResponse | null = null;
  let artifacts: ManimArtifact[] = [];
  let currentEventType: string | null = null;

  callbacks.onIsThinkingChange?.(false);
  try {
    while (true) {
      if (aborted) throw new DOMException('请求已取消', 'AbortError');
      const { done, value } = await reader.read();
      if (aborted) throw new DOMException('请求已取消', 'AbortError');
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
          let data: SsePayload;
          try { data = JSON.parse(dataStr) as SsePayload; } catch { continue; }
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
          else if (currentEventType === 'artifact' && data.id) {
            const artifact = data as ManimArtifact;
            artifacts = artifacts.some(item => item.id === artifact.id)
              ? artifacts.map(item => item.id === artifact.id ? artifact : item)
              : [...artifacts, artifact];
            callbacks.onArtifact?.(artifact);
          }
          else if (currentEventType === 'content' && data.text) {
            callbacks.onIsThinkingChange?.(false);
            fullContent += data.text;
            callbacks.onContent?.(data.text);
          }
          else if (currentEventType === 'done') {
            if (!fullContent && data.full_text) {
              fullContent = collapseExactRepeatedAnswer(data.full_text);
              callbacks.onContent?.(fullContent);
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
            if (data.qa_turn_id) qaTurnIdResult = String(data.qa_turn_id);
            if (data.progress_delta && typeof data.progress_delta === 'object') progressDelta = data.progress_delta as LearningProgressResponse;
            if (Array.isArray(data.artifacts)) {
              artifacts = data.artifacts;
              artifacts.forEach(artifact => callbacks.onArtifact?.(artifact));
            }
          }
        }
      }
    }
  } finally {
    request.signal?.removeEventListener('abort', abortReader);
    callbacks.onIsThinkingChange?.(false);
  }
  return {
    answer: collapseExactRepeatedAnswer(fullContent),
    sources,
    thinking,
    toolActivities,
    screenshot_context_id: screenshotContextIdResult,
    qa_turn_id: qaTurnIdResult,
    progress_delta: progressDelta,
    artifacts,
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
    { timeout: 18_000, maxRetries: 0 },
  );
}

export async function recognizeFormula(imageDataUrl: string, token?: string, signal?: AbortSignal): Promise<FormulaConversion> {
  const comma = imageDataUrl.indexOf(',');
  if (comma < 0) throw new Error('图片数据无效');
  const meta = imageDataUrl.slice(0, comma);
  const raw = imageDataUrl.slice(comma + 1);
  const mime = meta.match(/^data:([^;]+);base64/i)?.[1] || 'image/png';
  const bytes = Uint8Array.from(atob(raw.replace(/\s/g, '')), char => char.charCodeAt(0));
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mime }), `formula.${mime.split('/')[1] || 'png'}`);
  return apiRequest<FormulaConversion>({
    url: '/formula/recognize', method: 'POST', body: form, token,
    timeout: 35_000, maxRetries: 0, signal,
  });
}

export async function recognizeFormulaContent(imageDataUrl: string, token?: string, signal?: AbortSignal): Promise<RecognizedContent> {
  const blob = await prepareImageUpload(imageDataUrl);
  const form = new FormData();
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1] || 'png';
  form.append('image', blob, `photo.${extension}`);
  const response = await apiRequest<RecognizedContent>({ url: '/formula/recognize-content',
    method: 'POST', body: form, token, signal, timeout: 35_000, maxRetries: 0,
  });
  return response;
}
