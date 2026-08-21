// 统一 localStorage 的读写出口：JSON 型数据走 loadJSON/saveJSON，
// 普通字符串（如历史遗留的裸字符串 threadId）走 loadString/saveString/removeString，
// 避免各文件散落 try/catch + JSON.parse 样板，失败时统一降级为兜底值。
import { STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from './storageKeys';

export function ensureStorageSchema(): void {
  saveString(STORAGE_KEYS.schemaVersion, STORAGE_SCHEMA_VERSION);
}

/** 读取并解析 JSON；键缺失或解析失败（如旧版本残留的脏数据）时返回 fallback */
export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // 解析失败视为无数据，返回兜底值：本地存储读取不应阻断业务主流程
    return fallback;
  }
}

/** 序列化后写入；传 null 表示删除该键（等价 removeItem），删除也统一走此入口 */
export function saveJSON(key: string, value: unknown): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // 写入失败（隐私模式/容量超限等）静默忽略：本地存储写入不应阻断业务主流程
  }
}

// === 普通字符串读写（非 JSON 数据）===
// 历史遗留的 active_chat_thread 键存的是裸字符串 threadId（未经 JSON 包装），
// 若用 loadJSON 读取会因 JSON.parse 失败而一次性丢失，故补字符串型读写入口。

/** 读取普通字符串；键缺失或读取失败时返回 fallback */
export function loadString(key: string, fallback: string | null): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw;
  } catch {
    // 读取失败视为无数据，返回兜底值：本地存储读取不应阻断业务主流程
    return fallback;
  }
}

/** 写入普通字符串；不做 JSON 序列化，保持与历史遗留值相同的存储格式 */
export function saveString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 写入失败（隐私模式/容量超限等）静默忽略：本地存储写入不应阻断业务主流程
  }
}

/** 删除指定键；语义直白，供"清空某键"场景显式调用 */
export function removeString(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 删除失败静默忽略：本地存储操作不应阻断业务主流程
  }
}
