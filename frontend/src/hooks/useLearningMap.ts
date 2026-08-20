import { useEffect, useState } from 'react';
import type { NodeMapResponse } from '../services/api';
import { useMapHomeData } from './useMapHomeData';

/** Compatibility adapter for older drawer callers; structure is now static. */
export function useLearningMap(token: string | undefined, textbookId: string, _chatIsLoading: boolean) {
  const data = useMapHomeData(token, textbookId, 'anonymous');
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [chapterMap, setChapterMap] = useState<NodeMapResponse | null>(null);

  useEffect(() => {
    setSelectedChapter(null);
    setChapterMap(null);
  }, [textbookId]);

  useEffect(() => {
    setChapterMap(selectedChapter ? data.nodesByChapter[selectedChapter] || null : null);
  }, [data.nodesByChapter, selectedChapter]);

  const openChapter = async (chapter: string) => {
    setSelectedChapter(chapter);
    await data.openChapter(chapter);
  };

  return {
    chapters: data.chapters,
    chapterMap,
    selectedChapter,
    loading: data.loading,
    unavailable: Boolean(data.errors.__page),
    refresh: data.refresh,
    openChapter,
    closeChapter: () => { setSelectedChapter(null); setChapterMap(null); },
  };
}
