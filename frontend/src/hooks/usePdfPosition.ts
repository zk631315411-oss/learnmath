import { useCallback, useState } from 'react';
import { getSavedPage, savePage } from '../utils/pagePosition';

export function normalizePdfPage(page: number): number {
  return Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
}

export function usePdfPosition(textbookId: string) {
  const [pages, setPages] = useState<Record<string, number>>(() => (
    textbookId ? { [textbookId]: getSavedPage(textbookId) } : {}
  ));
  const currentPage = textbookId ? (pages[textbookId] ?? getSavedPage(textbookId)) : 1;

  const setTextbookPage = useCallback((targetTextbookId: string, page: number) => {
    if (!targetTextbookId) return;
    const normalized = normalizePdfPage(page);
    savePage(targetTextbookId, normalized);
    setPages(current => current[targetTextbookId] === normalized
      ? current
      : { ...current, [targetTextbookId]: normalized });
  }, []);

  const setCurrentPage = useCallback((page: number) => {
    setTextbookPage(textbookId, page);
  }, [setTextbookPage, textbookId]);

  return { currentPage, setCurrentPage, setTextbookPage };
}
