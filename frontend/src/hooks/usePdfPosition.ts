import { useCallback, useEffect, useState } from 'react';
import { getSavedPage, savePage } from '../utils/pagePosition';

export function usePdfPosition(textbookId: string) {
  const [currentPage, setCurrentPageState] = useState(1);
  useEffect(() => {
    if (textbookId) setCurrentPageState(getSavedPage(textbookId));
  }, [textbookId]);
  const setCurrentPage = useCallback((page: number) => {
    const normalized = Math.max(1, Math.floor(page));
    setCurrentPageState(normalized);
    if (textbookId) savePage(textbookId, normalized);
  }, [textbookId]);
  const saveTextbookPage = useCallback((targetTextbookId: string, page: number) => {
    if (targetTextbookId) savePage(targetTextbookId, Math.max(1, Math.floor(page)));
  }, []);
  return { currentPage, setCurrentPage, saveTextbookPage };
}
