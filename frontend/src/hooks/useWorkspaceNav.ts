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
  const [chapterExpandNonce, setChapterExpandNonce] = useState(0);
  const [startupReady, setStartupReady] = useState(false);
  const [threadRestore, setThreadRestore] = useState<{ id: string | null; nonce: number } | null>(null);
  const startupKeyRef = useRef('');
  const suppressReplaceUntilRef = useRef(0);
  const callbacksRef = useRef({ onTextbookRequest, onPageRequest });
  callbacksRef.current = { onTextbookRequest, onPageRequest };

  const applyLocation = useCallback((location: WorkspaceLocation, restoreThread: boolean) => {
    const targetTextbook = location.textbookId || textbookId;
    if (location.textbookId && location.textbookId !== textbookId) {
      callbacksRef.current.onTextbookRequest(location.textbookId);
    }
    if (location.page && targetTextbook) callbacksRef.current.onPageRequest(targetTextbook, location.page);
    setView(location.view);
    // 仅在有 chapter 参数时改章节选中，避免「去学这个」不 push 章节导致回退后章节状态被清空。
    if (location.chapter || location.view !== 'map') setSelectedMapChapter(location.chapter);
    // popstate 恢复地图视图时发一次展开信号：MapHome 章节展开是本地 state，回退需重新展开。
    if (restoreThread && location.view === 'map') setChapterExpandNonce(nonce => nonce + 1);
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
    // 「回地图」的 push 不静默紧随其后的 replace：回退恢复章节后 MapHome 会重新取数，
    // 需要 replace 把 URL 与恢复出的章节/页码对齐，梯子才能随回退重新展开。
    const skipReplace = !options.replace && nextView === 'reader' && url !== `${window.location.pathname}${window.location.search}`;
    window.history[options.replace ? 'replaceState' : 'pushState']({ learnmath: true, ...next }, '', url);
    if (skipReplace) suppressReplaceUntilRef.current = Date.now() + 300;
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
      // 刚 pushState 完紧跟的同步（如切视图引发的 page 变化）跳过本轮 replace，
      // 否则会改写刚推入的历史条目，把浏览器回退的落点搅乱。
      if (Date.now() < suppressReplaceUntilRef.current) return;
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
    chapterExpandNonce,
    startupReady,
    threadRestore,
    navigate,
    consumeThreadRestore,
    clearInvalidThread,
  };
}
