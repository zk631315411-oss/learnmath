/** 异常转用户可读消息：Error 取 message，其余（字符串/未知值）用兜底文案 */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
