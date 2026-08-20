import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCatalogEntry, loadCatalogIndex, loadTextbookCatalog } from '../catalog/loadCatalog';
import { chapterMapFromCatalog, chapterMapFromIndex, chapterSummary } from '../catalog/catalogData';
import type { CatalogEntry, CatalogIndex, TextbookCatalog } from '../catalog/types';
import type { ChapterMapItem, NodeMapResponse } from '../services/api';
import { useLearningProgress } from './useLearningProgress';
import { normalizeSectionKey } from '../utils/sectionKey';

export function clearMapHomeCache(): void {
  // Static assets are browser-cached. Progress is owned by useLearningProgress.
}

export function useMapHomeData(token: string | undefined, textbookId: string, cacheScope = 'anonymous') {
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [index, setIndex] = useState<CatalogIndex | null>(null);
  const [catalog, setCatalog] = useState<TextbookCatalog | null>(null);
  const [selectedErrors, setSelectedErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const progress = useLearningProgress(token, textbookId, entry?.catalog_version || '', cacheScope);

  useEffect(() => {
    let active = true;
    setEntry(null); setIndex(null); setCatalog(null); setSelectedErrors({}); setReady(false); setLoading(Boolean(textbookId));
    if (!textbookId) { setLoading(false); return () => { active = false; }; }
    void getCatalogEntry(textbookId).then(next => {
      if (!active) return;
      if (!next) throw new Error('未知教材');
      // The manifest contains enough information for an immediate chapter
      // shell. Index details are progressive enhancement and never block map
      // startup.
      setEntry(next); setReady(true); setLoading(false);
      void loadCatalogIndex(textbookId).then(nextIndex => {
        if (active) setIndex(nextIndex);
      }).catch(() => {
        if (active) setSelectedErrors(previous => ({ ...previous, __index: '节点目录加载失败' }));
      });
    }).catch(() => {
      if (!active) return;
      setSelectedErrors({ __page: '学习目录加载失败' }); setReady(true); setLoading(false);
    });
    return () => { active = false; };
  }, [catalogRetry, textbookId]);

  const chapters = useMemo<ChapterMapItem[]>(() => {
    if (!entry) return [];
    const allNodes = index?.node_index || [];
    return entry.chapters.map(chapter => chapterSummary(chapter, allNodes.filter(node => node.chapter === chapter.name), progress.nodes));
  }, [entry, index, progress.nodes]);

  const nodesByChapter = useMemo<Record<string, NodeMapResponse>>(() => {
    if (!entry || !index) return {};
    const result: Record<string, NodeMapResponse> = {};
    entry.chapters.forEach(chapter => {
      const full = catalog?.chapters.find(item => item.name === chapter.name);
      result[chapter.name] = full
        ? chapterMapFromCatalog(full, progress.nodes)
        : chapterMapFromIndex(entry.textbook_id, chapter, index.node_index, progress.nodes);
    });
    return result;
  }, [catalog, entry, index, progress.nodes]);

  const openChapter = useCallback(async (chapter: string): Promise<TextbookCatalog | null> => {
    if (catalog?.chapters.some(item => item.name === chapter)) return catalog;
    setSelectedErrors(previous => { const next = { ...previous }; delete next[chapter]; return next; });
    try {
      const full = await loadTextbookCatalog(textbookId);
      setCatalog(full);
      return full;
    } catch {
      setSelectedErrors(previous => ({ ...previous, [chapter]: '章节详情加载失败' }));
      return null;
    }
  }, [catalog, textbookId]);

  const refresh = useCallback(() => { void progress.refresh(); }, [progress.refresh]);
  const retryCatalog = useCallback(() => setCatalogRetry(value => value + 1), []);
  const chapterPages = useMemo(() => Object.fromEntries((entry?.chapters || []).map(chapter => [chapter.name, chapter.first_page])), [entry]);
  const sectionPages = useMemo(() => {
    if (!catalog) return {} as Record<string, number | null>;
    return Object.fromEntries(catalog.chapters.flatMap(chapter => chapter.sections.flatMap(section => {
      const pairs: Array<readonly [string, number | null]> = [[section.name, section.page]];
      const normalized = normalizeSectionKey(section.name);
      if (normalized) pairs.push([normalized, section.page]);
      return pairs;
    })));
  }, [catalog]);
  const errors: Record<string, string> = { ...selectedErrors };
  if (progress.error) errors.__progress = progress.error;
  return {
    chapters,
    nodesByChapter,
    errors,
    loading: loading || progress.loading,
    ready,
    refresh,
    retryCatalog,
    openChapter,
    chapterPages,
    sectionPages,
    catalogVersion: entry?.catalog_version || '',
  };
}
