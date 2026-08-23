import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { BookOpen, LoaderCircle, Map as MapIcon, X } from 'lucide-react';

import { ErrorBoundary } from './components/ErrorBoundary';
import ChatPanel from './components/ChatPanel';
import EmptyGuideCard from './components/EmptyGuideCard';
import AuthModal from './components/AuthModal';
import AuthControls from './components/AuthControls';
import LearningSidebar from './components/LearningSidebar';

import PDFToolbar from './components/PDFToolbar';
import UtilityDrawer from './components/UtilityDrawer';
import MapHome from './components/MapHome';
import BottomSheet, { type SheetStage } from './components/BottomSheet';
import PageNotesPanel from './components/PageNotesPanel';
import type { PDFViewerControls } from './components/PDFViewer';
import ThemeToggle from './components/ThemeToggle';
import type { Marker } from './components/PageMarker';
import { useAuth } from './hooks/useAuth';
import { useTextbookPreference, PRESET_PDFS } from './hooks/useTextbookPreference';
import { useMarkers } from './hooks/useMarkers';
import { useQuestionList } from './hooks/useQuestionList';
import { usePageSections } from './hooks/usePageSections';
import { useMapHomeData } from './hooks/useMapHomeData';
import { useChat } from './hooks/useChat';
import { usePdfPosition } from './hooks/usePdfPosition';
import { useCaptureFlow, type OverlaySurface } from './hooks/useCaptureFlow';
import { useWorkspaceNav } from './hooks/useWorkspaceNav';
import { useDarkMode } from './hooks/useDarkMode';
import { ensureStorageSchema, loadJSON, saveJSON } from './utils/storage';
import { STORAGE_KEYS } from './utils/storageKeys';
import { saveWorkspace } from './utils/workspace';
import { normalizeSectionKey } from './utils/sectionKey';
import { getSectionPage } from './services/api';
import type { TextbookId } from './textbooks';
import PhotoPreviewSheet from './components/PhotoPreviewSheet';
import CapturePreviewSheet from './components/CapturePreviewSheet';
import { applyProgressDelta } from './hooks/useLearningProgress';

const PDFViewer = lazy(() => import('./components/PDFViewer'));
const ScreenCapture = lazy(() => import('./components/ScreenCapture'));

function DeferredPanel({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" /></div>}>
      {children}
    </Suspense>
  );
}

export default function App() {
  const {
    user, authReady, showAuthModal, setShowAuthModal,
    authMode, setAuthMode, authUsername, setAuthUsername,
    authPassword, setAuthPassword, authError, handleAuthSubmit, handleLogout,
    migrationStatus, migrationVersion, retryMigration,
  } = useAuth();

  // 全局暗色模式：App 顶层唯一持有主题状态，暗色 class 在首帧绘制前由 hook 挂到 documentElement
  const { isDark, toggle: toggleTheme } = useDarkMode();

  const { selectedPdf, textbookId, setTextbookId } = useTextbookPreference();

  const { currentPage, setCurrentPage, setTextbookPage } = usePdfPosition(textbookId);
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  const [overlaySurface, setOverlaySurface] = useState<OverlaySurface>('none');
  const sheetStage: SheetStage = overlaySurface === 'sheet-half' ? 'half' : overlaySurface === 'sheet-full' ? 'full' : 'collapsed';
  const drawerOpen = overlaySurface === 'drawer';

  const [pdfControls, setPdfControls] = useState<PDFViewerControls | null>(null);
  const [desktopChatCollapsed, setDesktopChatCollapsed] = useState(() => loadJSON(STORAGE_KEYS.desktopChatCollapsed, false));
  const [threadRequestKey, setThreadRequestKey] = useState(0);
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);
  const setPdfContainerNode = useCallback((node: HTMLDivElement | null) => {
    pdfContainerRef.current = node;
  }, []);

  // 桌面端右栏可见时不累计未读；移动端 BottomSheet 半屏展开才算正在查看旁批。
  const chatVisible = isDesktop ? !desktopChatCollapsed : sheetStage === 'half';
  const markers = useMarkers(user, currentPage, textbookId);
  const mapCacheScope = user.isAnonymous ? (user.deviceId || 'anonymous') : (user.userId || user.deviceId || 'anonymous');
  const chat = useChat({ user, currentPage, textbookId, chatVisible, markersState: markers,
    onProgressDelta: (delta, sourceTextbookId) => applyProgressDelta(mapCacheScope, sourceTextbookId || textbookId, delta),
  });
  const revealDesktopChat = useCallback(() => {
    setDesktopChatCollapsed(false);
    saveJSON(STORAGE_KEYS.desktopChatCollapsed, false);
  }, []);
  const capture = useCaptureFlow({
    currentPage,
    isDesktop,
    setOverlaySurface,
    queueImage: chat.handleCapture,
    revealDesktopChat,
  });
  // SSE 问答属于独立后台任务，流式期间允许阅读导航；选区内容提取期间锁定局部导航。
  const interactionLocked = capture.busy;
  // 提问记录侧栏：以消息条数变化作为刷新信号（新提问落库后长度必然 +1）
  const questionList = useQuestionList(user, chat.historyVersion, textbookId);
  const pageSections = usePageSections(textbookId, user.token || undefined);
  const mapHome = useMapHomeData(user.token || undefined, textbookId, mapCacheScope, authReady);
  const navigation = useWorkspaceNav({
    textbookId,
    currentPage,
    activeThreadId: markers.activeThreadId,
    authReady,
    mapReady: !user.token || mapHome.ready,
    userKey: user.userId || user.deviceId,
    onTextbookRequest: value => {
      if (PRESET_PDFS.some(item => item.textbookId === value)) setTextbookId(value as TextbookId);
    },
    onPageRequest: setTextbookPage,
  });
  const { view, selectedMapChapter, startupReady } = navigation;
  const navigatePage = navigation.navigate;

  useEffect(() => ensureStorageSchema(), []);

  useEffect(() => {
    if (migrationVersion > 0) void mapHome.refresh();
  }, [mapHome.refresh, migrationVersion]);

  // 切书时重置当前对话线程：旧书线程不能带到新书。
  // 用 ref 记录上一次 textbookId 以跳过首次挂载（首帧 prev===textbookId 直接返回）。
  const prevTextbookIdRef = useRef(textbookId);
  useEffect(() => {
    const prev = prevTextbookIdRef.current;
    prevTextbookIdRef.current = textbookId;
    if (prev === textbookId) return;
    // 关键竞态：跨教材点击刚选中的目标线程，其 textbook_id 就是新书，不能被重置清掉，
    // 否则「切书+落页+加载对话」会被本 effect 的 clearMessages 打断。
    if (markers.activeMarker?.textbook_id === textbookId) return;
    chat.clearMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textbookId]);

  const handleMarkerClick = (marker: Marker) => {
    markers.handleMarkerClick(marker);
    markers.setActiveMarker(marker);
  };

  // 点击提问记录条目：跳页 + 加载该串对话。直接设 active 态而非走 handleMarkerClick，
  // 是为了避免移动端误弹 MarkerPopover；移动端改为展开 BottomSheet 展示对话。
  const handleQuestionSelect = (marker: Marker) => {
    capture.clearDraft();
    setOverlaySurface('none');
    const targetTextbookId = marker.textbook_id || textbookId;
    if (marker.textbook_id && marker.textbook_id !== textbookId) {
      setTextbookPage(marker.textbook_id, marker.page_number);
      saveWorkspace(marker.textbook_id, { view: 'reader', page: marker.page_number });
      setTextbookId(marker.textbook_id as TextbookId);
    } else {
      setCurrentPage(marker.page_number);
    }
    navigatePage('reader', null, { textbookId: targetTextbookId, page: marker.page_number, threadId: marker.id });
    markers.setActiveThreadId(marker.id);
    markers.setActiveMarker(marker);
    setThreadRequestKey(value => value + 1);
    if (isDesktop) {
      revealDesktopChat();
    } else {
      setOverlaySurface('sheet-half');
    }
  };

  useEffect(() => {
    const request = navigation.threadRestore;
    if (!request || questionList.loading || !questionList.ready) return;
    if (!request.id) {
      markers.setActiveThreadId(null);
      markers.setActiveMarker(null);
      chat.clearMessages();
      navigation.consumeThreadRestore();
      return;
    }
    const marker = questionList.items.find(item => item.id === request.id);
    if (marker) {
      markers.setActiveThreadId(marker.id);
      markers.setActiveMarker(marker);
      setThreadRequestKey(value => value + 1);
      if (isDesktop) revealDesktopChat();
      else setOverlaySurface('sheet-half');
    } else {
      markers.setActiveThreadId(null);
      markers.setActiveMarker(null);
      chat.clearMessages();
      navigation.clearInvalidThread();
    }
    navigation.consumeThreadRestore();
    // The request nonce is the event identity; the remaining values are read from the current workspace snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation.threadRestore?.nonce, questionList.loading, questionList.ready]);

  const markReaderStarted = (page = currentPage) => {
    navigatePage('reader', null, { page });
    saveWorkspace(textbookId, { view: 'reader', page });
  };

  const openChapter = async (chapter: string, preferredNode?: import('./services/api').LearningMapNode) => {
    const loadedCatalog = await mapHome.openChapter(chapter);
    let page: number | null = null;
    const marker = preferredNode?.chat.id ? questionList.items.find(item => item.id === preferredNode.chat.id) : undefined;
    if (user.token) {
      const response = mapHome.nodesByChapter[chapter];
      const sections = [preferredNode?.section, response?.sections[0]?.section]
        .map(section => normalizeSectionKey(section))
        .filter((section): section is string => Boolean(section));
      for (const section of sections) {
        const staticPage = loadedCatalog?.chapters
          .flatMap(item => item.sections)
          .find(item => normalizeSectionKey(item.name) === section)?.page
          ?? mapHome.sectionPages[section];
        if (staticPage != null) { page = staticPage; break; }
        try {
          const result = await getSectionPage(textbookId, section, user.token);
          if (result.page != null) { page = result.page; break; }
        } catch { /* try the next section or fallback below */ }
      }
    }
    // Map reading actions should land on the knowledge point's textbook
    // section. The source-question page can be unrelated (the learner may ask
    // about an earlier concept while reading a later chapter), so use it only
    // when the canonical section cannot be resolved. The adjacent chat button
    // remains the explicit way to return to the source conversation.
    if (page == null && marker) page = marker.page_number;
    if (page == null) {
      const staticChapterPage = loadedCatalog?.chapters.find(item => item.name === chapter)?.first_page
        ?? mapHome.chapterPages[chapter];
      if (staticChapterPage != null) page = staticChapterPage;
    }
    if (page == null) {
      const index = Math.max(0, mapHome.chapters.findIndex(item => item.chapter === chapter));
      const totalPages = pdfControls?.numPages || 1;
      page = Math.max(1, Math.round(totalPages * (index / Math.max(1, mapHome.chapters.length))));
    }
    // Persist the chapter landing page before switching into the reader. The
    // PDF viewer performs its one-time restore on mount, so writing the page
    // here prevents that restore from reverting a freshly resolved section.
    setCurrentPage(page);
    markReaderStarted(page);
  };

  const handleMapChatSelect = (chatId: string) => {
    const marker = questionList.items.find(item => item.id === chatId);
    if (marker) handleQuestionSelect(marker);
  };

  const retryMap = () => {
    if (selectedMapChapter) void mapHome.openChapter(selectedMapChapter);
    else { mapHome.retryCatalog(); void mapHome.refresh(); }
  };

  const openMapChapter = async (chapter: string) => {
    await mapHome.openChapter(chapter);
    navigatePage('map', chapter);
  };

  const learningSidebar = (onClose?: () => void) => <LearningSidebar
    onClose={onClose}
    questions={questionList.items} questionsLoading={questionList.loading} onSelectQuestion={handleQuestionSelect}
    pageSections={pageSections}
    onRenamed={questionList.refresh}
  />;

  const openDrawer = () => {
    if (interactionLocked) return;
    capture.cancel();
    capture.clearDraft();
    setOverlaySurface(isDesktop ? 'drawer' : 'sheet-full');
  };

  const startCapture = () => {
    if (interactionLocked) return;
    capture.start();
  };

  const toggleDesktopChat = () => {
    setDesktopChatCollapsed(previous => {
      const next = !previous;
      saveJSON(STORAGE_KEYS.desktopChatCollapsed, next);
      return next;
    });
  };

  const sendNewPageQuestion = (content: string) => {
    setThreadRequestKey(value => value + 1);
    void chat.handleSendMessage(content, { newThread: true });
  };

  const pageNotesPanel = <PageNotesPanel
    key={textbookId}
    page={{
      currentPage,
      items: questionList.items,
      activeMarker: markers.activeMarker,
      loading: questionList.loading,
      error: questionList.error,
      onRetry: () => { void questionList.refresh(); },
      onOpenThread: handleQuestionSelect,
      threadRequestKey,
    }}
    conversation={{
      messages: chat.messages,
      isLoading: chat.isLoading,
      token: user.token,
      pendingImages: chat.pendingImages,
      error: chat.error,
      thinkingStage: chat.thinkingStage,
      thinkingStageKey: chat.thinkingStageKey,
      isThinking: chat.isThinking,
      onSendNew: sendNewPageQuestion,
      onSendFollowUp: chat.handleSendMessage,
      onClearMessages: chat.clearMessages,
      onRemovePendingImage: chat.removePendingImage,
      onClearPendingImages: chat.clearPendingImages,
      onCancelGeneration: chat.cancelVisibleGeneration,
    }}
    composer={{
      onOpenPhoto: capture.openPhoto,
      externalContent: capture.externalContent,
      onExternalContentConsumed: capture.consumeExternalContent,
    }}
  />;

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handlePageChange = useCallback((page: number) => {
    if (interactionLocked) return;
    capture.clearDraft();
    setCurrentPage(page);
  }, [interactionLocked, overlaySurface, setCurrentPage]);

  const selectClass = "text-sm rounded-lg border border-[var(--lm-border)] bg-[var(--lm-surface)] px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-colors dark:text-slate-200";

  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col bg-[var(--lm-bg)] dark:bg-slate-950">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-[var(--lm-bg)] px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:px-6">
          <div className="flex items-center">
            <span className="text-lg font-bold text-slate-800 dark:text-slate-100">学数有道</span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {view === 'reader' && <select aria-label="选择教材" className={`${selectClass} w-24 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto`} value={textbookId} disabled={interactionLocked}
              onChange={(e) => { if (interactionLocked) return; const v = e.target.value; setTextbookId(v as never); }}>
              <option value="">选择教材...</option>{PRESET_PDFS.map((pdf) => <option key={pdf.path} value={pdf.textbookId}>{pdf.name}</option>)}
            </select>}

            {textbookId && <button type="button" disabled={interactionLocked} onClick={() => { if (!interactionLocked) navigatePage(view === 'map' ? 'reader' : 'map'); }} className="toolbar-button" title={view === 'map' ? '开始阅读' : '返回学习地图'}>
              {view === 'map' ? <BookOpen className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
              <span className="hidden sm:inline">{view === 'map' ? '阅读' : '地图'}</span>
            </button>}

            <ThemeToggle isDark={isDark} onToggle={toggleTheme} />

            {migrationStatus !== 'idle' && <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400" role="status">
              <span>{migrationStatus === 'syncing' ? '进度同步中' : '进度同步失败'}</span>
              {migrationStatus === 'failed' && <button type="button" onClick={retryMigration} className="font-medium text-indigo-600 hover:underline dark:text-indigo-300">重试</button>}
            </div>}

            <AuthControls user={user}
              onLoginClick={() => { setAuthMode('login'); setShowAuthModal(true); }}
              onRegisterClick={() => { setAuthMode('register'); setShowAuthModal(true); }}
              onLogout={handleLogout} />
          </div>
        </header>

        <main className={view === 'map' ? 'min-h-0 flex-1 overflow-hidden' : 'flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 lg:flex-row'}>
          {view === 'map' ? (
            <MapHome
              textbookName={PRESET_PDFS.find(item => item.textbookId === textbookId)?.name || '选择教材'}
              chapters={mapHome.chapters}
              nodesByChapter={mapHome.nodesByChapter}
              edgesByChapter={mapHome.edgesByChapter}
              errors={mapHome.errors}
              loading={mapHome.loading || !startupReady}
              onContinue={openChapter}
              onOpenChapter={openMapChapter}
              selectedChapter={selectedMapChapter}
              selectedChapterMap={selectedMapChapter ? mapHome.nodesByChapter[selectedMapChapter] || null : null}
              selectedChapterError={selectedMapChapter ? mapHome.errors[selectedMapChapter] : undefined}
              onBackToChapters={() => navigatePage('map')}
              onStartChapter={() => { if (selectedMapChapter) void openChapter(selectedMapChapter); }}
              onContinueNode={node => { if (selectedMapChapter) void openChapter(selectedMapChapter, node); }}
              onOpenChat={handleMapChatSelect}
              onRetry={retryMap}
              onStartReading={() => markReaderStarted()}
              textbookId={textbookId}
              textbooks={PRESET_PDFS.map(pdf => ({ textbookId: pdf.textbookId, name: pdf.name }))}
              onTextbookChange={value => setTextbookId(value as TextbookId)}
            />
          ) : isDesktop ? (
            <>
              <div className="lm-panel flex min-w-0 flex-1 flex-col overflow-hidden">
                {selectedPdf && textbookId ? (
                  <>
                    <PDFToolbar controls={pdfControls} onOpenDrawer={openDrawer} onCapture={startCapture} captureDisabled={!selectedPdf}
                      navigationDisabled={interactionLocked}
                      chatCollapsed={desktopChatCollapsed} onToggleChat={toggleDesktopChat} />
                    <div className="min-h-0 flex-1">
                      <DeferredPanel><PDFViewer pdfUrl={selectedPdf} textbookId={textbookId} page={currentPage} onPageRequest={handlePageChange}
                        markers={markers.markers} pdfContainerRef={setPdfContainerNode} onMarkerClick={handleMarkerClick}
                        hideToolbar onControlsChange={setPdfControls} pageOverlay={null} /></DeferredPanel>
                    </div>
                  </>
                ) : (
                  <EmptyGuideCard />
                )}
              </div>
              {!desktopChatCollapsed && <div className="lm-panel w-[360px] shrink-0 overflow-hidden min-[1440px]:w-[400px]">
                {pageNotesPanel}
              </div>}
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="lm-panel flex min-h-0 flex-1 flex-col overflow-hidden">
                {selectedPdf && textbookId ? (
                  <div className="min-h-0 flex-1">
                      <DeferredPanel><PDFViewer pdfUrl={selectedPdf} textbookId={textbookId} page={currentPage} onPageRequest={handlePageChange} mobile
                        markers={markers.markers} pdfContainerRef={setPdfContainerNode} onMarkerClick={handleMarkerClick}
                        hideToolbar onControlsChange={setPdfControls} pageOverlay={null} /></DeferredPanel>
                  </div>
                ) : (
                  <EmptyGuideCard />
                )}
              </div>
              {selectedPdf && <BottomSheet
                stage={sheetStage}
                onStageChange={stage => { if (!interactionLocked) setOverlaySurface(stage === 'half' ? 'sheet-half' : stage === 'full' ? 'sheet-full' : 'none'); }}
                unread={chat.unreadCount > 0}
                pendingCount={chat.pendingImages.length}
                onOpenChat={() => { if (interactionLocked) return; chat.markRead(); setOverlaySurface('sheet-half'); }}
                onOpenUtility={() => { if (!interactionLocked) setOverlaySurface('sheet-full'); }}
                onCapture={startCapture}
                controls={pdfControls}
                interactionLocked={interactionLocked}
              >
                {sheetStage === 'half' ? pageNotesPanel : learningSidebar(() => setOverlaySurface('none'))}
              </BottomSheet>}
            </div>
          )}
        </main>

        <UtilityDrawer open={isDesktop && drawerOpen} onClose={() => setOverlaySurface('none')}>
          {learningSidebar(() => setOverlaySurface('none'))}
        </UtilityDrawer>

        {capture.isCapturing && (
          <DeferredPanel><ScreenCapture isActive currentPage={currentPage} onCapture={capture.completeSelection} onCancel={capture.cancel} /></DeferredPanel>
        )}

        {overlaySurface === 'capture-preview' && capture.captureDraft && <CapturePreviewSheet
          capture={capture.captureDraft}
          token={user.token}
          onQuestion={capture.queueCapture}
          onInsert={capture.insertContent}
          onReselect={capture.reselect}
          onClose={capture.closePreview}
          onBusyChange={capture.setBusy}
        />}
        {overlaySurface === 'photo' && capture.photoFile && <PhotoPreviewSheet initialFile={capture.photoFile} token={user.token} onPhotoQuestion={capture.queuePhoto} onInsert={capture.insertContent} onClose={capture.closePhoto} />}

        {showAuthModal && (
          <AuthModal mode={authMode} username={authUsername} password={authPassword} error={authError}
            onUsernameChange={setAuthUsername} onPasswordChange={setAuthPassword}
            onSubmit={handleAuthSubmit}
            onModeSwitch={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
            onClose={() => setShowAuthModal(false)} />
        )}
      </div>
    </ErrorBoundary>
  );
}
