import { loadJSON, saveJSON, loadString, saveString } from './storage';

// 教材页码恢复存储的读写收敛点：PDFViewer 与 App 跨教材跳转共用，
// 避免页码键名 / {textbookId: page} 格式 / current_textbook 联动散落多处导致写读不一致。
const LS_KEY = 'pdf_viewer_page_v2';
const CURRENT_TEXTBOOK_KEY = 'current_textbook';

/** 读取某教材上次停留的页码；无记录时回落到第 1 页 */
export function getSavedPage(textbookId: string): number {
  const data = loadJSON<Record<string, number>>(LS_KEY, {});
  return data[textbookId] || 1;
}

/** 写入某教材当前页码，并同步更新 current_textbook（App 恢复与 useTextbookPreference 都读它） */
export function savePage(textbookId: string, page: number): void {
  const data = loadJSON<Record<string, number>>(LS_KEY, {});
  data[textbookId] = page;
  saveJSON(LS_KEY, data);
  saveString(CURRENT_TEXTBOOK_KEY, textbookId);
}

/** 读取当前教材 ID（PDFViewer 初次渲染时 textbookId 尚为空，用它兜底恢复页码） */
export function getCurrentTextbook(): string {
  return loadString(CURRENT_TEXTBOOK_KEY, '') || '';
}
