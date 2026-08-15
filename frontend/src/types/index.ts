// === 学习助手类型定义（LearnMath 精简版） ===

// 知识源引用（答案引用的教材来源，可选保留）
export interface Source {
  textbook_id?: string;
  textbook_name?: string;
  chapter: string;
  snippet: string;
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
}

// 截图裁剪框
export interface CropBBox {
  x: number;
  y: number;
  width: number;
  height: number;
  unit?: 'page_ratio';
}

// 待发送截图：每张截图携带自己的裁剪框，支持多图连发
// （当前后端 /solve-stream 一次只收一张，前端发送时只取第一张，其余保留在待发列表）
export interface PendingImage {
  id: string;
  data: string; // base64 图片数据
  cropBBox: CropBBox;
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
