// === 学习助手类型定义（LearnMath 精简版） ===

// 知识源引用（答案引用的教材来源，可选保留）
export interface Source {
  textbook_id?: string;
  textbook_name?: string;
  chapter: string;
  snippet: string;
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
}

// 截图裁剪框
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
  learning_preferences?: Record<string, unknown>;
}
