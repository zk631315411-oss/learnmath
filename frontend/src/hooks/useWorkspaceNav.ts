import { useCallback, useEffect, useRef, useState } from 'react';

import { loadWorkspace, saveWorkspace, type WorkspaceView } from '../utils/workspace';

export type WorkspaceLocation = {
  view: WorkspaceView;
  chapter: string | null;
  textbookId: string | null;
  page: number | null;
  threadId: string | null;
  explicit: boolean;
};

export function parseWorkspaceLocation(search: string): WorkspaceLocation {
  const params = new URLSearchParams(search);
  const pageValue = Number(params.get('page'));
  return {
    view: params.get('view') === 'reader' ? 'reader' : 'map',
    chapter: params.get('chapter') || null,
    textbookId: params.get('textbook') || null,
    page: Number.isFinite(pageValue) && pageValue >= 1 ? Math.floor(pageValue) : null,
    threadId: params.get('thread') || null,
    explicit: ['view', 'chapter', 'textbook', 'page', 'thread'].some(key => params.has(key)),
  };
}

export function buildWorkspaceUrl(location: Omit<WorkspaceLocation, 'explicit'>, pathname = '/'): string {
  const params = new URLSearchParams({ view: location.view });
  if (location.textbookId) params.set('textbook', location.textbookId);
  if (location.page) params.set('page', String(Math.max(1, Math.floor(location.page))));
  if (location.view === 'map' && location.chapter) params.set('chapter', location.chapter);
  if (location.view === 'reader' && location.threadId) params.set('thread', location.threadId);
  return `${pathname}?${params.toString()}`;
}

type NavigateOptions = {
  textbookId?: string;
  page?: number;
  threadId?: string | null;
  replace?: boolean;
};

type Params = {
  textbookId: string;
  currentPage: number;
  activeThreadId: string | null;
  authReady: boolean;
  mapReady: boolean;
  userKey: string;
  onTextbookRequest: (textbookId: string) => void;
  onPageRequest: (textbookId: string, page: number) => void;
};

export function useWorkspaceNav({
  textbookId,
  currentPage,
  activeThreadId,
  authReady,
  mapReady,
  userKey,
  onTextbookRequest,
  onPageRequest,
}: Params) {
  const initial = useRef(parseWorkspaceLocation(window.location.search));
  const [view, setView] = useState<WorkspaceView>(initial.current.view);
  const [selectedMapChapter, setSelectedMapChapter] = useState<string | null>(initial.current.chapter);
  const [startupReady, setStartupReady] = useState(false);
  const [threadRestore, setThreadRestore] = useState<{ id: string | null; nonce: number } | null>(null);
  const startupKeyRef = useRef('');
  const callbacksRef = useRef({ onTextbookRequest, onPageRequest });
  callbacksRef.current = { onTextbookRequest, onPageRequest };

  const applyLocation = useCallback((location: WorkspaceLocation, restoreThread: boolean) => {
    const targetTextbook = location.textbookId || textbookId;
    if (location.textbookId && location.textbookId !== textbookId) {
      callbacksRef.current.onTextbookRequest(location.textbookId);
    }
    if (location.page && targetTextbook) callbacksRef.current.onPageRequest(targetTextbook, location.page);
    setView(location.view);
    setSelectedMapChapter(location.view === 'map' ? location.chapter : null);
    if (restoreThread) setThreadRestore(current => ({ id: location.threadId, nonce: (current?.nonce || 0) + 1 }));
  }, [textbookId]);

  useEffect(() => {
    const onPopState = () => applyLocation(parseWorkspaceLocation(window.location.search), true);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [applyLocation]);

  useEffect(() => {
    if (!textbookId || !authReady || !mapReady) return;
    const key = `${userKey}:${textbookId}`;
    if (startupKeyRef.current === key) return;
    const location = parseWorkspaceLocation(window.location.search);
    const urlTargetsCurrentBook = !location.textbookId || location.textbookId === textbookId;
    if (location.explicit && urlTargetsCurrentBook) {
      applyLocation(location, true);
    } else {
      const workspace = loadWorkspace(textbookId);
      const restored: WorkspaceLocation = {
        view: workspace?.view === 'reader' ? 'reader' : 'map',
        chapter: null,
        textbookId,
        page: workspace?.page || currentPage,
        threadId: null,
        explicit: false,
      };
      applyLocation(restored, false);
    }
    startupKeyRef.current = key;
    setStartupReady(true);
  }, [applyLocation, authReady, currentPage, mapReady, textbookId, userKey]);

  const navigate = useCallback((nextView: WorkspaceView, chapter: string | null = null, options: NavigateOptions = {}) => {
    const next = {
      view: nextView,
      chapter: nextView === 'map' ? chapter : null,
      textbookId: options.textbookId ?? textbookId,
      page: options.page ?? currentPage,
      threadId: nextView === 'reader' ? (options.threadId === undefined ? activeThreadId : options.threadId) : null,
    };
    const url = buildWorkspaceUrl(next, window.location.pathname);
    window.history[options.replace ? 'replaceState' : 'pushState']({ learnmath: true, ...next }, '', url);
    setView(nextView);
    setSelectedMapChapter(next.chapter);
  }, [activeThreadId, currentPage, textbookId]);

  useEffect(() => {
    if (!startupReady || !textbookId) return;
    saveWorkspace(textbookId, { view, page: currentPage });
    const current = parseWorkspaceLocation(window.location.search);
    const next = {
      view,
      chapter: view === 'map' ? selectedMapChapter : null,
      textbookId,
      page: currentPage,
      threadId: view === 'reader' ? activeThreadId : null,
    };
    const url = buildWorkspaceUrl(next, window.location.pathname);
    if (url !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState({ learnmath: true, ...next }, '', url);
    } else if (!window.history.state?.learnmath || current.explicit === false) {
      window.history.replaceState({ learnmath: true, ...next }, '', url);
    }
  }, [activeThreadId, currentPage, selectedMapChapter, startupReady, textbookId, view]);

  const consumeThreadRestore = useCallback(() => setThreadRestore(null), []);
  const clearInvalidThread = useCallback(() => {
    navigate(view, selectedMapChapter, { threadId: null, replace: true });
  }, [navigate, selectedMapChapter, view]);

  return {
    view,
    selectedMapChapter,
    startupReady,
    threadRestore,
    navigate,
    consumeThreadRestore,
    clearInvalidThread,
  };
}
