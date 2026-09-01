import { useCallback, useState } from 'react';
import { getSavedPage, savePage } from '../utils/pagePosition';

export function normalizePdfPage(page: number): number {
  return Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
}

/**
 * Read an explicit page from the current URL before the first PDF render.
 * Workspace navigation still owns subsequent URL changes, but the initial
 * render should not briefly mount the cached page and then jump elsewhere.
 */
export function getInitialPdfPage(
  textbookId: string,
  search = typeof window === 'undefined' ? '' : window.location.search,
): number {
  if (!textbookId) return 1;

  const params = new URLSearchParams(search);
  const requestedTextbook = params.get('textbook');
  const requestedPage = Number(params.get('page'));
  if (
    params.has('page') &&
    (!requestedTextbook || requestedTextbook === textbookId) &&
    Number.isFinite(requestedPage) &&
    requestedPage >= 1
  ) {
    return normalizePdfPage(requestedPage);
  }
  return getSavedPage(textbookId);
}

export function usePdfPosition(textbookId: string) {
  const [pages, setPages] = useState<Record<string, number>>(() => (
    textbookId ? { [textbookId]: getInitialPdfPage(textbookId) } : {}
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
