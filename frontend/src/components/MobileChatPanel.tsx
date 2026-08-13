/**
 * 移动端全屏聊天面板
 *
 * 从 App.tsx 提取，用于移动端临时展开的聊天界面。
 * 支持全屏显示、关闭按钮、紧凑模式。
 */
import { memo } from 'react';
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
  isThinking: boolean;
  thinkingExpanded: boolean;
  setThinkingExpanded: (v: boolean) => void;
  onOpenPractice?: (draft: PracticeDraft) => void;
  onRegeneratePractice?: (draft: PracticeDraft) => void;
  onRequestPractice?: (turnId: string, nodeId?: string) => void;
  autoPreparePractice?: boolean;
  onAutoPreparePracticeChange?: (value: boolean) => void;
  markerBanner?: { id: string; page: number; question: string } | null;
  onCloseMarkerBanner?: () => void;
  onDeleteMarker?: (id: string) => void;
  onForkMessage?: (message: Message) => void;
  branchAnchor?: { title: string } | null;
  onCancelFork?: () => void;
  onClose: () => void;
  token?: string;
  onGenerateAnimation?: (visualizationId: string) => Promise<void>;
}

function MobileChatPanelInner({
  messages, onSendMessage, onClearMessages, isLoading,
  pendingImage, onClearPendingImage,
  thinkingStage, isThinking, thinkingExpanded, setThinkingExpanded,
  onOpenPractice, onRegeneratePractice, onRequestPractice, autoPreparePractice, onAutoPreparePracticeChange,
  markerBanner, onCloseMarkerBanner, onDeleteMarker,
  onForkMessage, branchAnchor, onCancelFork, onClose, token, onGenerateAnimation,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-slate-900 flex flex-col animate-slide-up">
      {/* 头部：标题 + 关闭按钮 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">智能问答</span>
        </div>
        <button onClick={onClose}
          className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
          ✕
        </button>
      </div>
      {/* 聊天内容区 */}
      <div className="flex-1 overflow-hidden">
        <ChatPanel
          messages={messages} onSendMessage={onSendMessage}
          onClearMessages={onClearMessages} isLoading={isLoading}
          pendingImage={pendingImage} onClearPendingImage={onClearPendingImage}
          thinkingStage={thinkingStage}
          isThinking={isThinking} thinkingExpanded={thinkingExpanded}
          setThinkingExpanded={setThinkingExpanded}
          onOpenPractice={onOpenPractice}
          onRegeneratePractice={onRegeneratePractice}
          onRequestPractice={onRequestPractice}
          autoPreparePractice={autoPreparePractice}
          onAutoPreparePracticeChange={onAutoPreparePracticeChange}
          markerBanner={markerBanner}
          onCloseMarkerBanner={onCloseMarkerBanner}
          onDeleteMarker={onDeleteMarker}
          onForkMessage={onForkMessage}
          branchAnchor={branchAnchor}
          onCancelFork={onCancelFork}
          onGenerateAnimation={onGenerateAnimation}
          compact
          token={token}
        />
      </div>
    </div>
  );
}

export default memo(MobileChatPanelInner);
