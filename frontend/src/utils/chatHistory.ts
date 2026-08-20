/**
 * chat_history 记录归一化
 *
 * 后端把 follow_ups / crop_bbox / tool_activities 以 JSON 字符串落库，前端消费前必须统一转成
 * 对象/数组。徽标列表（useMarkers）与提问记录侧栏（useQuestionList）都要做同样的转换，
 * 故收敛到这一个函数，避免两处各复制一份、后续字段演进时改漏。
 */
import type { CropBBox, ToolActivity } from '../types';
import type { Marker } from '../components/PageMarker';

// 把「JSON 字符串 / 已解析对象 / 缺失」统一成确定值：
// 字符串尝试解析（失败用 fallback）；对象原样返回；null/undefined 用 fallback。
// 这样既能处理后端返回的字符串，也能兼容前端 addMarker 传入的已是对象的数据。
function parseJsonOrPassthrough(value: unknown, fallback: unknown): unknown {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    // 解析失败说明是历史脏数据，按缺失处理，不让单条坏记录拖垮整个列表
    return fallback;
  }
}

// tool_activities 既可能是 JSON 字符串，也可能已是数组；统一成数组，非法值退化为空数组
function normalizeToolActivities(value: unknown): ToolActivity[] {
  const parsed = parseJsonOrPassthrough(value, []);
  return Array.isArray(parsed) ? (parsed as ToolActivity[]) : [];
}

export function normalizeChatHistoryRecord(record: any): Marker {
  const followUpsRaw = parseJsonOrPassthrough(record.follow_ups, []);
  const followUps: any[] = Array.isArray(followUpsRaw) ? followUpsRaw : [];

  return {
    ...record,
    crop_bbox: parseJsonOrPassthrough(record.crop_bbox, null) as CropBBox | null,
    thinking: record.thinking || null,
    tool_activities: normalizeToolActivities(record.tool_activities),
    // 老 follow-up 没有 turn_id：归一化层补 legacy-${index} 供 UI key 使用，
    // 只读兼容，不回写旧数据；新数据的身份在发送时由客户端生成并落库
    follow_ups: followUps.map((fu: any, index: number) => ({
      ...fu,
      turn_id: fu.turn_id || `legacy-${index}`,
      thinking: fu.thinking || null,
      tool_activities: normalizeToolActivities(fu.tool_activities),
    })),
  };
}
