import { useState, useRef, useEffect, memo } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import FormulaComposer from './FormulaComposer';
import type { Message } from '../types';

interface Props {
  messages: Message[];
  onSendMessage: (content: string, image?: string) => void;
  onClearMessages: () => void;
  isLoading: boolean;
  pendingImage?: string | null;
  onClearPendingImage?: () => void;
  thinkingStage?: string;
  compact?: boolean;
}

function ChatPanelInner({
  messages, onSendMessage, onClearMessages, isLoading,
  pendingImage, onClearPendingImage, thinkingStage, compact,
}: Props) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); };
  useEffect(() => { if (!isLoading) scrollToBottom(); }, [messages, isLoading]);

  const handleSubmit = () => {
    if ((input.trim() || pendingImage) && !isLoading) {
      onSendMessage(input.trim() || '请解答这张图片中的题目', pendingImage || undefined);
      setInput('');
      onClearPendingImage?.();
    }
  };

  return (
    <div className="relative flex flex-col h-full overflow-hidden bg-white">
      {!compact && (
        <div className="px-4 py-3 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <h3 className="font-semibold text-slate-800 text-sm">AI 智能问答</h3>
          </div>
          {messages.length > 0 && (
            <button onClick={onClearMessages} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
              清除对话
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <div className="w-16 h-16 rounded-xl bg-blue-50 flex items-center justify-center mb-3 ">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-sm font-medium">开始提问</p>
            <p className="text-xs mt-1 opacity-70">框选教材截图或直接输入数学问题</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="flex flex-col items-start max-w-[88%]">
              <div className={`chat-message rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-white text-slate-700 shadow-sm border border-slate-100 rounded-bl-md'
              }`}>
                {msg.image && (
                  <img src={msg.image} alt="用户截图" className="mb-2 max-w-full rounded-lg"
                    style={{ maxHeight: '200px' }} />
                )}
                <MarkdownRenderer className="text-sm leading-relaxed markdown-body">{msg.content}</MarkdownRenderer>
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white shadow-sm border border-slate-100 rounded-2xl rounded-bl-md px-4 py-3 max-w-[85%]">
              {thinkingStage && (
                <div className="flex items-center gap-2 text-slate-500 text-sm mb-1">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span>{thinkingStage || 'AI 正在思考…'}</span>
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {pendingImage && (
        <div className="px-4 py-3 border-t border-slate-200 bg-blue-50/60">
          <div className="flex items-start gap-2">
            <img src={pendingImage} alt="待发送截图" className="max-w-[120px] max-h-[100px] rounded-lg shadow-sm border border-indigo-200" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-blue-600 mb-1 font-medium">截图已捕获</p>
              <button type="button" onClick={onClearPendingImage} className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                删除图片
              </button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}
        className="p-3 sm:p-4 border-t border-slate-200 bg-white shrink-0">
        <div className="flex gap-2 items-end">
          <div className="min-w-0 flex-1">
            <FormulaComposer value={input} onChange={setInput}
              placeholder="输入问题…" disabled={isLoading} onSubmit={handleSubmit} />
          </div>
          <button type="submit" disabled={(!input.trim() && !pendingImage) || isLoading}
            className="px-4 sm:px-5 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all  active:scale-95 whitespace-nowrap">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}

export default memo(ChatPanelInner);
