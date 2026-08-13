import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ChatPanel from './ChatPanel';
import type { Message, PracticeDraft } from '../types';

interface Props {
  messages: Message[];
  onSendMessage: (content: string, image?: string) => void;
  onClearMessages: () => void;
  isLoading: boolean;
  pendingImage?: string | null;
  onClearPendingImage?: () => void;
  thinkingStage: string;
  thinkingContent?: string;
  isThinking: boolean;
  thinkingExpanded: boolean;
  setThinkingExpanded: (v: boolean) => void;
  hasUnread: boolean;
  onRead: () => void;
  token?: string;
  onGenerateAnimation?: (visualizationId: string) => Promise<void>;
  onOpenPractice?: (draft: PracticeDraft) => void;
  onRegeneratePractice?: (draft: PracticeDraft) => void;
  onRequestPractice?: (turnId: string, nodeId?: string) => void;
  autoPreparePractice?: boolean;
  onAutoPreparePracticeChange?: (value: boolean) => void;
}

export default function AiBall({
  messages, onSendMessage, onClearMessages, isLoading,
  pendingImage, onClearPendingImage,
  thinkingStage, thinkingContent: _thinkingContent, isThinking, thinkingExpanded, setThinkingExpanded,
  hasUnread, onRead, token, onGenerateAnimation,
  onOpenPractice, onRegeneratePractice, onRequestPractice, autoPreparePractice, onAutoPreparePracticeChange,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [screenSize, setScreenSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const dragRef = useRef({ active: false, startX: 0, startY: 0, ballX: 0, ballY: 0, moved: false });
  const ballRef = useRef<HTMLDivElement>(null);

  // 初始化位置：右下角
  useEffect(() => {
    setPos({ x: window.innerWidth - 80, y: window.innerHeight - 200 });
  }, []);

  // 监听屏幕尺寸变化，用于动态计算面板高度和横屏宽度
  useEffect(() => {
    const onResize = () => setScreenSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 展开面板高度：最小 50vh，最大 70vh，根据屏幕高度动态调整
  const panelHeight = useMemo(() => {
    // 屏幕较矮时用 50vh，较高时用 70vh，中间线性插值
    const ratio = Math.min(1, Math.max(0, (screenSize.h - 500) / 400));
    const vhValue = 50 + ratio * 20;
    return `${vhValue}vh`;
  }, [screenSize.h]);

  // 横屏时面板宽度占屏幕 60%，竖屏保持 max-w-lg
  const isLandscape = screenSize.w > screenSize.h;
  const panelMaxWidth = isLandscape ? '60vw' : '28rem';

  // 截图后自动展开
  useEffect(() => {
    if (pendingImage) {
      setExpanded(true);
      onRead();
    }
  }, [pendingImage]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- 拖拽：用 pointer 事件，不用 setPointerCapture（避免抑制 click） ---
  const handlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, ballX: pos.x, ballY: pos.y, moved: false };
    e.preventDefault();
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      dragRef.current.moved = true;
    }
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - 64, dragRef.current.ballX + dx)),
      y: Math.max(60, Math.min(window.innerHeight - 64, dragRef.current.ballY + dy)),
    });
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  // --- 点击：仅在没有拖动时展开 ---
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    setExpanded(true);
    onRead();
  }, [onRead]);

  return (
    <>
      {/* Collapsed ball */}
      {!expanded && (
        <div
          ref={ballRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onClick={handleClick}
          className="fixed z-40 w-14 h-14 rounded-full shadow-lg cursor-pointer select-none transition-transform active:scale-95"
          style={{ left: pos.x, top: pos.y, touchAction: 'none' }}
        >
          <div className={`w-full h-full rounded-full flex items-center justify-center text-white text-lg font-bold
            ${isLoading ? 'bg-blue-400 animate-pulse' : 'bg-blue-500/80 backdrop-blur hover:bg-blue-600'}`}
          >
            {isLoading ? '⋯' : 'AI'}
          </div>
          {hasUnread && !isLoading && (
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white dark:border-slate-900" />
          )}
        </div>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 dark:bg-black/50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setExpanded(false); }}>
          <div className="w-full bg-white dark:bg-slate-800 rounded-t-2xl shadow-xl flex flex-col overflow-hidden animate-slide-up"
            style={{ maxWidth: panelMaxWidth, height: panelHeight }}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">学数有道</span>
              </div>
              <button onClick={() => setExpanded(false)}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                −
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ChatPanel
                messages={messages} onSendMessage={onSendMessage}
                onClearMessages={onClearMessages} isLoading={isLoading}
                pendingImage={pendingImage} onClearPendingImage={onClearPendingImage}
                thinkingStage={thinkingStage}
                isThinking={isThinking} thinkingExpanded={thinkingExpanded}
                setThinkingExpanded={setThinkingExpanded}
                onGenerateAnimation={onGenerateAnimation}
                onOpenPractice={onOpenPractice}
                onRegeneratePractice={onRegeneratePractice}
                onRequestPractice={onRequestPractice}
                autoPreparePractice={autoPreparePractice}
                onAutoPreparePracticeChange={onAutoPreparePracticeChange}
                compact
                token={token}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
