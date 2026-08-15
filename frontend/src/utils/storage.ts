// 统一 localStorage 的 JSON 读写出口：所有"JSON 型"本地存储都经由这里，
// 避免各文件散落 try/catch + JSON.parse 样板，失败时统一降级为兜底值。

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
