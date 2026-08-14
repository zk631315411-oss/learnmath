import { useState, useEffect } from 'react';
import { TEXTBOOKS } from '../textbooks';
import type { TextbookId } from '../textbooks';

export const PRESET_PDFS = TEXTBOOKS.map(({ id, name, path }) => ({ name, path, textbookId: id }));

const PDF_PAGE_KEY = 'learnmath_pdf_page';

function getActualPage(textbookId: string): number {
  try {
    const data = JSON.parse(localStorage.getItem(PDF_PAGE_KEY) || '{}');
    return data[textbookId] || 0;
  } catch { return 0; }
}

function savePage(textbookId: string, page: number) {
  try {
    const data = JSON.parse(localStorage.getItem(PDF_PAGE_KEY) || '{}');
    data[textbookId] = page;
    localStorage.setItem(PDF_PAGE_KEY, JSON.stringify(data));
  } catch {}
}

export function useTextbookPreference() {
  const [selectedPdf, setSelectedPdf] = useState<string>('');
  const [textbookId, setTextbookId] = useState<TextbookId | ''>(() => {
    try {
      const saved = localStorage.getItem('current_textbook') as TextbookId | null;
      if (saved && TEXTBOOKS.some(t => t.id === saved)) {
        const preset = PRESET_PDFS.find(p => p.textbookId === saved);
        if (preset) {
          // 延迟设置 URL，先返回 ID
          return saved;
        }
      }
    } catch {}
    return '';
  });

  // 初始化：从 localStorage 恢复，无则默认第一本
  useEffect(() => {
    let restored = textbookId;
    try {
      const saved = localStorage.getItem('current_textbook') as TextbookId | null;
      if (saved && TEXTBOOKS.some(t => t.id === saved)) restored = saved;
    } catch {}
    if (!restored && TEXTBOOKS.length > 0) restored = TEXTBOOKS[0].id;

    if (restored) {
      const preset = PRESET_PDFS.find(p => p.textbookId === restored);
      if (preset) {
        setSelectedPdf(preset.path);
        setTextbookId(restored);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 变化时同步 localStorage
  useEffect(() => {
    if (!textbookId) return;
    const preset = PRESET_PDFS.find(p => p.textbookId === textbookId);
    if (preset) {
      setSelectedPdf(preset.path);
      localStorage.setItem('current_textbook', textbookId);
    }
  }, [textbookId]);

  const saveCurrentPage = (page: number) => {
    if (textbookId) savePage(textbookId, page);
  };

  return { selectedPdf, textbookId, setTextbookId, saveCurrentPage, getActualPage };
}
