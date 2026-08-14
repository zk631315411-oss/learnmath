import { memo } from 'react';
import ChatPanel from './ChatPanel';
import type { Message } from '../types';

interface Props {
  messages: Message[];
  onSendMessage: (content: string, image?: string) => void;
  onClearMessages: () => void;
  isLoading: boolean;
  pendingImage?: string | null;
  onClearPendingImage?: () => void;
  thinkingStage?: string;
  onClose: () => void;
}

function MobileChatPanelInner({
  messages, onSendMessage, onClearMessages, isLoading,
  pendingImage, onClearPendingImage, thinkingStage, onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col animate-slide-up">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <span className="text-sm font-semibold text-slate-800">智能问答</span>
        </div>
        <button onClick={onClose}
          className="w-8 h-8 rounded-full bg-white shadow-sm border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <ChatPanel
          messages={messages} onSendMessage={onSendMessage}
          onClearMessages={onClearMessages} isLoading={isLoading}
          pendingImage={pendingImage} onClearPendingImage={onClearPendingImage}
          thinkingStage={thinkingStage}
          compact
        />
      </div>
    </div>
  );
}

export default memo(MobileChatPanelInner);
