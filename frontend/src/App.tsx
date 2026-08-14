import { lazy, Suspense, useState, useEffect, useRef } from 'react';

import { ErrorBoundary } from './components/ErrorBoundary';
import ChatPanel from './components/ChatPanel';
import AuthModal from './components/AuthModal';
import AiBall from './components/AiBall';
import MobileChatPanel from './components/MobileChatPanel';
import type { Marker } from './components/PageMarker';
import { useAuth } from './hooks/useAuth';
import { useTextbookPreference, PRESET_PDFS } from './hooks/useTextbookPreference';
import { useMarkers } from './hooks/useMarkers';
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

  const { selectedPdf, textbookId, setTextbookId, saveCurrentPage } = useTextbookPreference();

  const [isCapturing, setIsCapturing] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  const markers = useMarkers(user, currentPage);
  const chat = useChat({ user, currentPage, textbookId, markersState: markers });

  const handleMarkerClick = (marker: Marker) => {
    markers.handleMarkerClick(marker);
    markers.setActiveMarker(marker);
  };

  const handleCapture = (imageData: string, _pageRatioX: number, _pageRatioY: number, _cropBBox: CropBBox) => {
    setIsCapturing(false);
    chat.handleCapture(imageData);
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
            <select className={`${selectClass} w-24 sm:w-auto`} value={textbookId}
              onChange={(e) => { const v = e.target.value; setTextbookId(v as never); }}>
              <option value="">选择教材...</option>
              {PRESET_PDFS.map((pdf) => (
                <option key={pdf.path} value={pdf.textbookId}>{pdf.name}</option>
              ))}
            </select>

            <button onClick={() => setIsCapturing(true)} disabled={!selectedPdf}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="hidden sm:inline">框选提问</span>
            </button>

            {user.token && user.isAnonymous ? (
              <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
                <span className="text-xs text-slate-500 hidden sm:inline">游客</span>
                <button onClick={() => { setAuthMode('login'); setShowAuthModal(true); }} className="text-xs text-blue-600 hover:underline">登录</button>
                <span className="text-slate-300 hidden sm:inline">|</span>
                <button onClick={() => { setAuthMode('register'); setShowAuthModal(true); }} className="text-xs text-slate-500 hover:underline hidden sm:inline">注册</button>
              </div>
            ) : user.token ? (
              <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
                <span className="text-sm font-medium text-slate-700 hidden sm:inline">{user.username}</span>
                <button onClick={handleLogout} className="text-xs text-slate-500 hover:text-slate-600">退出</button>
              </div>
            ) : (
              <div className="flex items-center gap-1 pl-2 border-l border-slate-200">
                <button onClick={() => { setAuthMode('login'); setShowAuthModal(true); }} className="text-sm text-blue-600 hover:underline">登录</button>
                <span className="text-slate-300 hidden sm:inline">|</span>
                <button onClick={() => { setAuthMode('register'); setShowAuthModal(true); }} className="text-sm text-slate-400 hover:underline hidden sm:inline">注册</button>
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden p-3 gap-3">
          {isDesktop ? (
            <>
              <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {selectedPdf && textbookId ? (
                  <DeferredPanel><PDFViewer pdfUrl={selectedPdf} textbookId={textbookId} onPageChange={handlePageChange}
                    markers={markers.markers} pdfContainerRef={pdfContainerRef} onMarkerClick={handleMarkerClick} viewerPage={currentPage} /></DeferredPanel>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <div className="w-20 h-20 rounded-3xl bg-indigo-50 flex items-center justify-center mb-4">
                      <svg className="w-10 h-10 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
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
                  pendingImage={chat.pendingImage} onClearPendingImage={chat.clearPendingImage}
                  thinkingStage={chat.thinkingStage}
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
              {selectedPdf && !showMobileChat && (
                <button onClick={() => setShowMobileChat(true)}
                  className="fixed bottom-24 right-4 z-30 w-12 h-12 rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center hover:opacity-90 active:scale-95 transition-all"
                  title="打开聊天">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </button>
              )}
              {showMobileChat && (
                <MobileChatPanel
                  messages={chat.messages} onSendMessage={chat.handleSendMessage}
                  onClearMessages={chat.clearMessages}
                  isLoading={chat.isLoading}
                  pendingImage={chat.pendingImage} onClearPendingImage={chat.clearPendingImage}
                  thinkingStage={chat.thinkingStage}
                  onClose={() => setShowMobileChat(false)}
                />
              )}
              {selectedPdf && (
                <AiBall
                  messages={chat.messages} onSendMessage={chat.handleSendMessage}
                  onClearMessages={chat.clearMessages}
                  isLoading={chat.isLoading}
                  pendingImage={chat.pendingImage} onClearPendingImage={chat.clearPendingImage}
                  thinkingStage={chat.thinkingStage}
                  hasUnread={false} onRead={() => {}}
                />
              )}
            </div>
          )}
        </div>

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
