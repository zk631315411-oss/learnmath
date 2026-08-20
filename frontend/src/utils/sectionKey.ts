/** Extract the numeric section prefix from KG text such as "3.1 n 维向量空间". */
export function normalizeSectionKey(value: string | null | undefined): string | null {
  const match = String(value || '').trim().match(/(?:^|[^\d])(\d+(?:\.\d+)*)/);
  return match?.[1] || null;
}
