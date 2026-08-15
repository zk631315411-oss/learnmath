import { lazy, Suspense, useState, useEffect, useRef } from 'react';

import { File, History, Image } from 'lucide-react';

import { ErrorBoundary } from './components/ErrorBoundary';
import ChatPanel from './components/ChatPanel';
import AuthModal from './components/AuthModal';
import AiBall from './components/AiBall';
import AuthControls from './components/AuthControls';
import QuestionListPanel from './components/QuestionListPanel';
import type { Marker } from './components/PageMarker';
import { useAuth } from './hooks/useAuth';
import { useTextbookPreference, PRESET_PDFS } from './hooks/useTextbookPreference';
import { useMarkers } from './hooks/useMarkers';
import { useQuestionList } from './hooks/useQuestionList';
import { useChat } from './hooks/useChat';
import type { CropBBox } from './types';

const PDFViewer = lazy(() => import('./components/PDFViewer'));
const ScreenCapture = lazy(() => import('./components/ScreenCapture'));

function DeferredPanel({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" /></div>}>
      {children}
    </Suspense>
  );
}

export default function App() {
  const {
    user, showAuthModal, setShowAuthModal,
    authMode, setAuthMode, authUsername, setAuthUsername,
    authPassword, setAuthPassword, authError, handleAuthSubmit, handleLogout,
  } = useAuth();

  const { selectedPdf, textbookId, setTextbookId } = useTextbookPreference();

  const [isCapturing, setIsCapturing] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  // AiBall 面板展开态：移动端聊天面板是否可见的唯一来源
  const [aiBallExpanded, setAiBallExpanded] = useState(false);
  // 移动端「提问记录」抽屉开关；桌面端侧栏常驻，不依赖该状态
  const [questionDrawerOpen, setQuestionDrawerOpen] = useState(false);
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  // 桌面端右栏聊天常驻可见，永不累计未读；移动端只有 AiBall 展开才算可见
  const chatVisible = isDesktop ? true : aiBallExpanded;
  const markers = useMarkers(user, currentPage);
  const chat = useChat({ user, currentPage, textbookId, chatVisible, markersState: markers });
  // 提问记录侧栏：以消息条数变化作为刷新信号（新提问落库后长度必然 +1）
  const questionList = useQuestionList(user, chat.messages.length);

  const handleMarkerClick = (marker: Marker) => {
    markers.handleMarkerClick(marker);
    markers.setActiveMarker(marker);
  };

  // 点击提问记录条目：跳页 + 加载该串对话。直接设 active 态而非走 handleMarkerClick，
  // 是为了避免移动端误弹 MarkerPopover；移动端另需展开 AiBall 面板展示对话。
  const handleQuestionSelect = (marker: Marker) => {
    setQuestionDrawerOpen(false);
    setCurrentPage(marker.page_number);
    markers.setActiveThreadId(marker.id);
    markers.setActiveMarker(marker);
    if (!isDesktop) setAiBallExpanded(true);
  };

  // 透传真实选区 cropBBox 给 useChat（pageRatioX/Y 暂无用例，保留占位）
  const handleCapture = (imageData: string, _pageRatioX: number, _pageRatioY: number, cropBBox: CropBBox) => {
    setIsCapturing(false);
    chat.handleCapture(imageData, cropBBox);
  };

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const selectClass = "text-sm rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors";

  return (
    <ErrorBoundary>
      <div className="h-screen flex flex-col bg-slate-50">
        {/* Header */}
        <header className="px-6 py-3 bg-white border-b border-slate-200 flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white text-sm font-bold">
              LM
            </div>
            <span className="text-lg font-bold text-slate-800">学数有道</span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {!isDesktop && (
              <button type="button" onClick={() => setQuestionDrawerOpen(true)}
                aria-label="提问记录" title="提问记录"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-slate-100">
                <History className="h-5 w-5" />
              </button>
            )}

            <select className={`${selectClass} w-24 sm:w-auto`} value={textbookId}
              onChange={(e) => { const v = e.target.value; setTextbookId(v as never); }}>
              <option value="">选择教材...</option>
              {PRESET_PDFS.map((pdf) => (
                <option key={pdf.path} value={pdf.textbookId}>{pdf.name}</option>
              ))}
            </select>

            <button onClick={() => setIsCapturing(true)} disabled={!selectedPdf}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ">
              <Image className="w-4 h-4" />
              <span className="hidden sm:inline">框选提问</span>
            </button>

            <AuthControls user={user}
              onLoginClick={() => { setAuthMode('login'); setShowAuthModal(true); }}
              onRegisterClick={() => { setAuthMode('register'); setShowAuthModal(true); }}
              onLogout={handleLogout} />
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden p-3 gap-3">
          {isDesktop ? (
            <>
              <div className="w-[260px] shrink-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <QuestionListPanel items={questionList.items} loading={questionList.loading} onSelect={handleQuestionSelect} />
              </div>
              <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {selectedPdf && textbookId ? (
                  <DeferredPanel><PDFViewer pdfUrl={selectedPdf} textbookId={textbookId} onPageChange={handlePageChange}
                    markers={markers.markers} pdfContainerRef={pdfContainerRef} onMarkerClick={handleMarkerClick} viewerPage={currentPage} /></DeferredPanel>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <div className="w-20 h-20 rounded-3xl bg-indigo-50 flex items-center justify-center mb-4">
                      <File className="w-10 h-10 text-blue-400" strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-medium">请选择教材开始学习</p>
                    <p className="text-xs mt-1 opacity-70">选择后可使用"框选提问"截图答疑</p>
                  </div>
                )}
              </div>
              <div className="w-[400px] bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden shrink-0">
                <ChatPanel
                  messages={chat.messages}
                  onSendMessage={chat.handleSendMessage}
                  onClearMessages={chat.clearMessages}
                  isLoading={chat.isLoading}
                  token={user.token}
                  pendingImage={chat.pendingImage} onClearPendingImage={chat.clearPendingImage}
                  thinkingStage={chat.thinkingStage}
                  isThinking={chat.isThinking}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {selectedPdf && textbookId ? (
                  <DeferredPanel><PDFViewer pdfUrl={selectedPdf} textbookId={textbookId} onPageChange={handlePageChange} mobile
                    markers={markers.markers} pdfContainerRef={pdfContainerRef} onMarkerClick={handleMarkerClick} viewerPage={currentPage} /></DeferredPanel>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <p className="text-sm font-medium">请选择教材</p>
                  </div>
                )}
              </div>
              {selectedPdf && (
                <AiBall
                  messages={chat.messages} onSendMessage={chat.handleSendMessage}
                  onClearMessages={chat.clearMessages}
                  isLoading={chat.isLoading}
                  token={user.token}
                  pendingImage={chat.pendingImage} onClearPendingImage={chat.clearPendingImage}
                  thinkingStage={chat.thinkingStage}
                  isThinking={chat.isThinking}
                  hasUnread={chat.unreadCount > 0} onRead={chat.markRead}
                  onVisibleChange={setAiBallExpanded}
                />
              )}
            </div>
          )}
        </div>

        {!isDesktop && questionDrawerOpen && (
          <div className="fixed inset-0 z-[100]">
            {/* 遮罩：点击关闭抽屉 */}
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setQuestionDrawerOpen(false)} />
            {/* 左滑面板：复用桌面侧栏同一组件，宽度由本容器控制 */}
            <div className="absolute bottom-0 left-0 top-0 flex w-[280px] max-w-[85vw] flex-col bg-white shadow-xl">
              <QuestionListPanel items={questionList.items} loading={questionList.loading} onSelect={handleQuestionSelect} onClose={() => setQuestionDrawerOpen(false)} />
            </div>
          </div>
        )}

        {isCapturing && (
          <DeferredPanel><ScreenCapture isActive currentPage={currentPage} onCapture={handleCapture} onCancel={() => setIsCapturing(false)} /></DeferredPanel>
        )}

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
