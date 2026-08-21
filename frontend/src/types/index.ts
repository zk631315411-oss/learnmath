// === 学习助手类型定义（LearnMath 精简版） ===

// 知识源引用（答案引用的教材来源，可选保留）
export interface Source {
  textbook_id?: string;
  textbook_name?: string;
  chapter?: string;
  snippet?: string;
  page_number?: number;
  score?: number;
}

export interface ChatHistoryRecord {
  id: string;
  user_id?: string;
  page_number: number;
  marker_y_ratio: number;
  marker_type: 'screenshot' | 'text';
  created_at?: string | null;
  thumbnail?: string | null;
  crop_bbox?: unknown;
  screenshot_context_id?: string | null;
  textbook_id?: string | null;
  generation_status?: 'pending' | 'completed' | 'interrupted' | 'cancelled' | null;
  generation_error?: string | null;
  client_turn_id?: string | null;
  question: string;
  answer: string | null;
  thinking?: string | null;
  tool_activities?: unknown;
  follow_ups?: unknown;
}

export type ToolActivityStatus = 'running' | 'success' | 'error' | 'skipped' | 'cancelled';

export type KGRetrievalFocus =
  | 'prerequisites'
  | 'successors'
  | 'supporting'
  | 'applications'
  | 'rules'
  | 'structure'
  | 'overview';

export interface KGFocusStat {
  returned_count: number;
  truncated: boolean;
}

export interface KGNodeReference {
  node_id?: string;
  name?: string;
  type?: string;
  match_type?: string;
  relationship_type?: string;
  direction?: 'incoming' | 'outgoing';
  source_code?: string;
}

export interface KGToolResult {
  status?: 'resolved' | 'ambiguous' | 'not_found';
  kg_basis_available?: boolean;
  found?: boolean;
  message?: string;
  node?: KGNodeReference;
  support_nodes?: KGNodeReference[];
  lookahead_nodes?: KGNodeReference[];
  selected_node?: KGNodeReference;
  candidates?: KGNodeReference[];
  requested_focus?: KGRetrievalFocus[];
  retrieved_focus?: KGRetrievalFocus[];
  empty_focus?: KGRetrievalFocus[];
  focus_stats?: Partial<Record<KGRetrievalFocus, KGFocusStat>>;
  relationships?: {
    explicit_prerequisites?: KGNodeReference[];
    explicit_successors?: KGNodeReference[];
    supporting_knowledge?: KGNodeReference[];
    applications_and_extensions?: KGNodeReference[];
    structural_context?: KGNodeReference[];
  };
  rule_case_count?: number;
}

export interface ToolActivity {
  id: string;
  tool: string;
  label: string;
  status: ToolActivityStatus;
  arguments: Record<string, unknown>;
  round?: number;
  result?: KGToolResult;
  duration_ms?: number;
  error_code?: string | null;
  error_message?: string | null;
}

export type ManimArtifactStatus =
  | 'queued'
  | 'running'
  | 'repair_pending'
  | 'repairing'
  | 'completed'
  | 'failed';

export interface ManimArtifact {
  id: string;
  chat_id?: string | null;
  client_turn_id?: string | null;
  title: string;
  rationale: string;
  status: ManimArtifactStatus;
  attempt: number;
  repair_count: number;
  error_code?: string | null;
  error_message?: string | null;
  video_url?: string | null;
  poster_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// === 聊天消息 ===

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string; // base64 图片数据
  sources?: Source[];
  knowledge_points?: string[];
  thinking?: string; // AI 思考过程
  toolActivities?: ToolActivity[];
  artifacts?: ManimArtifact[];
  failed?: boolean; // 生成中断/取消：content 为已流出的部分正文（可能为空）
  pending?: boolean; // 历史中仍处于生成中的记录；不等同于失败
}

// 截图裁剪框
export interface CropBBox {
  x: number;
  y: number;
  width: number;
  height: number;
  unit?: 'page_ratio';
}

// 待发图片队列：每张图片是一轮独立问题，发送时顺序消费一张。
export interface PendingImage {
  id: string;
  data: string; // base64 图片数据
  cropBBox: CropBBox | null;
  source: 'pdf-capture' | 'photo';
}

export type RecognizedBlock =
  | { type: 'text'; text: string; bbox?: [number, number, number, number] | null }
  | { type: 'formula'; latex: string; display_mode: 'inline' | 'block'; bbox?: [number, number, number, number] | null };

export interface RecognizedContent {
  blocks: RecognizedBlock[];
  warnings: string[];
}

// === 用户认证 ===

export interface User {
  userId: string;
  username: string;
  token: string | null;
  deviceId: string;
  isAnonymous: boolean;
  profile: UserProfile | null;
}

export interface UserProfile {
  id: string;
  username: string;
  is_anonymous?: boolean;
  grade: string;
  weak_points: string[];
  strong_points: string[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user_id: string;
  username: string;
  is_anonymous?: boolean;
}

export interface UserProfileUpdate {
  grade?: string;
  weak_points?: string[];
  strong_points?: string[];
  learning_preferences?: Record<string, unknown>;
}
