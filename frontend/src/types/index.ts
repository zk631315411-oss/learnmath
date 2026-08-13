import type { TextbookId } from '../textbooks';

// === 通用 API 响应类型 ===

// 标准响应包装 —— 所有 API 返回统一格式
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

// 分页响应 —— 列表查询使用
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// === 知识源引用 ===

export interface Source {
  textbook_id: TextbookId;
  textbook_name: string;
  chapter: string;
  snippet: string;
  sequence_id?: string;
  section_node_id?: string;
  kg_used?: boolean;
  kg_concepts?: string[];
  kg_support_concepts?: string[];
  kg_lookahead_concepts?: string[];
  kg_rule_cases_count?: number;
}

export type MathVisualizationKind =
  | 'function_plot'
  | 'parametric_plot'
  | 'polar_plot'
  | 'vector_diagram'
  | 'linear_transform'
  | 'sequence_plot'
  | 'partial_sum_comparison'
  | 'abel_softening_comparison'
  | 'geometry_construction'
  | 'region_visualization'
  | 'histogram_with_fit'
  | 'heatmap_grid';
export type AnimationStatus = 'not_requested' | 'queued' | 'running' | 'completed' | 'failed';

export type ChartColorToken = 'primary' | 'comparison' | 'accent' | 'positive' | 'negative' | 'guide' | 'muted';

export interface ChartLegendItem {
  label: string;
  visible: boolean;
}

export interface ChartLineStyle {
  color: ChartColorToken;
  width: number;
  dash: 'solid' | 'dash' | 'dot' | 'dashdot';
  opacity: number;
}

export interface ChartMarkerStyle {
  color: ChartColorToken;
  size: number;
  symbol: 'circle' | 'square' | 'diamond' | 'cross';
  opacity: number;
}

export interface ChartFillStyle {
  color: ChartColorToken;
  opacity: number;
}

export interface ChartLineLayer {
  type: 'line'; id: string; x: Array<number | null>; y: Array<number | null>;
  shape: 'linear' | 'hv' | 'vh' | 'hvh' | 'vhv'; style: ChartLineStyle; legend: ChartLegendItem;
}

export interface ChartMarkersLayer {
  type: 'markers'; id: string; x: number[]; y: number[]; labels: string[];
  style: ChartMarkerStyle; legend: ChartLegendItem;
}

export interface ChartBarsLayer {
  type: 'bars'; id: string; x: number[]; y: number[]; width: number[]; baseline: number;
  bin_width: number | null;
  style: ChartFillStyle; legend: ChartLegendItem;
}

export interface ChartAreaLayer {
  type: 'area'; id: string; x: number[]; lower: number[]; upper: number[];
  style: ChartFillStyle; legend: ChartLegendItem;
}

export interface ChartVectorLayer {
  type: 'vector'; id: string; from_point: [number, number]; to_point: [number, number];
  style: ChartLineStyle; legend: ChartLegendItem;
}

export interface ChartHeatmapLayer {
  type: 'heatmap'; id: string; x: number[]; y: number[]; z: Array<Array<number | null>>;
  color_scale: 'diverging' | 'sequential' | 'binary'; legend: ChartLegendItem;
}

export type ChartLayer = ChartLineLayer | ChartMarkersLayer | ChartBarsLayer | ChartAreaLayer | ChartVectorLayer | ChartHeatmapLayer;

export type ChartAnnotation =
  | { type: 'text'; x: number; y: number; text: string; color: ChartColorToken }
  | { type: 'arrow'; from_point: [number, number]; to_point: [number, number]; text: string; color: ChartColorToken }
  | { type: 'reference_line'; axis: 'x' | 'y'; value: number; label: string; color: ChartColorToken; dash: 'solid' | 'dash' | 'dot' | 'dashdot' };

export interface ChartIRV2 {
  coordinate_system: {
    type: 'cartesian';
    x_axis: { label: string; scale: 'linear' | 'log'; range?: [number, number] | null };
    y_axis: { label: string; scale: 'linear' | 'log'; range?: [number, number] | null };
    equal_aspect: boolean;
  } | {
    type: 'polar';
    angular_unit: 'radians';
    radial_axis: { label: string; scale: 'linear' | 'log'; range?: [number, number] | null };
  };
  layers: ChartLayer[];
  annotations: ChartAnnotation[];
  legend: { visible: boolean; position: 'bottom' | 'right' | 'hidden' };
  interaction: { hover: boolean; zoom: boolean; export: boolean };
  summary: string;
}

export interface AnimationJob {
  id: string;
  visualization_id: string;
  status: Exclude<AnimationStatus, 'not_requested'>;
  error?: string;
  video_url?: string | null;
  poster_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MathVisualizationArtifact {
  id: string;
  version: 2;
  kind: MathVisualizationKind;
  title: string;
  spec: ChartIRV2;
  animation_available: boolean;
  animation_status: AnimationStatus;
  legacy_source_version?: 1;
  animation_job_id?: string;
  animation?: AnimationJob;
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
  treeNodeId?: string;
  treeMessageId?: string;
  treeMessageStatus?: 'streaming' | 'completed' | 'interrupted' | 'failed';
  visualizations?: MathVisualizationArtifact[];
  degraded?: boolean;
  practiceDraft?: PracticeDraft;
  qaTurnId?: string;
  practiceOffered?: boolean;
}

export interface PracticeDraft {
  id: string;
  turn_id?: string;
  node_id?: string;
  textbook_id?: TextbookId;
  sequence_id?: string;
  concept_ids?: string[];
  concept_names?: string[];
  trigger_kind?: string;
  intervention_goal?: string;
  evidence_quote?: string;
  selection_reason?: string;
  status: 'queued' | 'running' | 'ready' | 'partial' | 'failed' | 'stale' | 'cancelled';
  auto_prepared?: boolean;
  version?: number;
  error?: string | null;
  items?: PracticeItem[];
}

export interface PracticeItem {
  id: string;
  question: string;
  question_type: 'calculation' | 'concept' | 'proof';
  diagnostic_goal: 'definition' | 'application' | 'proof' | 'counterexample' | 'transfer';
  difficulty: string;
  item_kind?: 'exercise_item' | 'worked_example' | string;
  textbook_id?: TextbookId;
  source_locator?: string;
  sequence_id?: string;
  concept_ids?: string[];
  concept_names?: string[];
  primary_concept_id?: string;
  primary_concept_name?: string;
  prerequisite_concept_ids?: string[];
  prerequisite_concept_names?: string[];
  kg_mapping_status?: string;
  source_page?: number;
  source_problem_no?: string;
  source_subitem_no?: string | null;
  stem_source?: string;
  solution_source?: string;
  solution_review_status?: string;
  hints?: string[];
  source?: string;
  trust_status?: string;
  branch_role?: string;
  reason?: string;
}

// === 截图裁剪框 ===

export interface CropBBox {
  x: number;
  y: number;
  width: number;
  height: number;
  unit?: 'page_ratio';
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
  learning_preferences?: Record<string, any>;
}

// === API 请求类型（补充） ===

// 登录请求
export interface LoginRequest {
  username: string;
  password: string;
}

// 注册请求
export interface RegisterRequest {
  username: string;
  password: string;
  device_id: string;
}

// 教材偏好更新请求
export interface TextbookPreferenceRequest {
  textbook_id: TextbookId;
  page_number: number;
}

// 反馈提交请求
export interface FeedbackRequest {
  content: string;
}

// 聊天历史创建请求
export interface ChatHistoryCreateRequest {
  user_id: string;
  question: string;
  answer: string | null;
  page_number: number;
  marker_y_ratio: number;
  marker_type: string;
  thumbnail?: string;
  crop_bbox?: string;
}

// 练习生成请求
export interface ExerciseGenerateRequest {
  user_id: string;
  token?: string;
  textbook_id?: TextbookId;
  page_number: number;
}

// 答案提交请求
export interface ExerciseSubmitRequest {
  student_answer: string;
}

// QA 流式问答请求
export interface QASolveStreamRequest {
  user_id: string;
  question: string;
  teaching_mode: string;
  socratic_submode?: string;
  chat_id?: string;
  history?: Array<{ user: string; assistant: string }>;
  token?: string;
  textbook_id?: TextbookId;
  page_number?: number;
  marker_id?: string;
  crop_bbox?: CropBBox;
  screenshot_context_id?: string;
}
