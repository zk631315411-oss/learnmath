import { loadJSON, saveJSON } from './storage';
import { STORAGE_KEYS } from './storageKeys';

// 教材页码恢复存储的读写收敛点：PDFViewer 与 App 跨教材跳转共用，
// 避免页码键名 / {textbookId: page} 格式散落多处导致写读不一致。
/** 读取某教材上次停留的页码；无记录时回落到第 1 页 */
export function getSavedPage(textbookId: string): number {
  const data = loadJSON<Record<string, number>>(STORAGE_KEYS.pdfPages, {});
  return data[textbookId] || 1;
}

/** 写入某教材当前页码；教材选择由 useTextbookPreference 独立负责。 */
export function savePage(textbookId: string, page: number): void {
  const data = loadJSON<Record<string, number>>(STORAGE_KEYS.pdfPages, {});
  data[textbookId] = page;
  saveJSON(STORAGE_KEYS.pdfPages, data);
}
