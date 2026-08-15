import { useState, useRef, useEffect, memo } from 'react';
import { ArrowDown, BrainCircuit, ChevronDown, Send, X } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import FormulaComposer from './formula/FormulaComposer';
import EmptyGuideCard from './EmptyGuideCard';
import AgentActivity from './AgentActivity';
import type { Message, PendingImage } from '../types';

interface Props {
  messages: Message[];
  onSendMessage: (content: string) => void;
  onClearMessages: () => void;
  isLoading: boolean;
  token?: string | null;
  pendingImages?: PendingImage[];
  onRemovePendingImage?: (id: string) => void;
  onClearPendingImages?: () => void;
  /** 全局提示（含截图超量拒绝），显示在输入框上方的提示条 */
  error?: string | null;
  thinkingStage?: string;
  isThinking?: boolean;
  compact?: boolean;
}

function ThinkingBlock({ content, active }: { content: string; active: boolean }) {
  const [expanded, setExpanded] = useState(active);

  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);

  return (
    <div className="mb-3 border-b border-slate-200 pb-3">
      <button
        type="button"
        onClick={() => setExpanded(value => !value)}
        className="flex w-full items-center gap-2 text-left text-xs font-medium text-slate-500 hover:text-slate-700"
        aria-expanded={expanded}
      >
        <BrainCircuit className={`h-4 w-4 ${active ? 'animate-pulse text-blue-500' : 'text-slate-400'}`} />
        <span className="flex-1">{active ? '正在分析' : '模型分析'}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="mt-2 max-h-48 overflow-y-auto border-l-2 border-blue-200 pl-3 text-slate-500">
          <MarkdownRenderer className="text-xs leading-6 markdown-body">{content}</MarkdownRenderer>
        </div>
      )}
    </div>
  );
}

function LoadingStatus({ text }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <div className="flex gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-500" style={{ animationDelay: '150ms' }} />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '300ms' }} />
      </div>
      <span>{text || '正在准备回答…'}</span>
    </div>
  );
}

function ChatPanelInner({
  messages, onSendMessage, onClearMessages, isLoading,
  token, pendingImages, onRemovePendingImage, onClearPendingImages,
  error, thinkingStage, isThinking = false, compact,
}: Props) {
  const [input, setInput] = useState('');
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const previousMessageCountRef = useRef(messages.length);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
  };

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceFromBottom <= 80;
    setShouldAutoScroll(nearBottom);
    if (nearBottom) setShowScrollToBottom(false);
  };

  useEffect(() => {
    if (messages.length === 0 && previousMessageCountRef.current > 0) {
      setInput('');
    }
    const newUserMessageStarted = messages.length > previousMessageCountRef.current
      && messages[messages.length - 1]?.role === 'user';
    previousMessageCountRef.current = messages.length;
    if (newUserMessageStarted) {
      setShouldAutoScroll(true);
      setShowScrollToBottom(false);
      return;
    }
    if (shouldAutoScroll) {
      scrollToBottom(isLoading ? 'auto' : 'smooth');
    } else if (isLoading) {
      setShowScrollToBottom(true);
    }
  }, [messages, thinkingStage, isLoading, shouldAutoScroll]);

  const handleSubmit = () => {
    const hasImage = !!pendingImages && pendingImages.length > 0;
    if ((input.trim() || hasImage) && !isLoading) {
      onSendMessage(input.trim() || '请解答这张图片中的题目');
      setInput('');
      // 第一张的移除由 useChat 在发送时处理，其余截图保留在待发列表
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

      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="relative flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.length === 0 && <EmptyGuideCard />}

        {messages.map((msg, index) => {
          const isActiveAssistant = isLoading && msg.role === 'assistant' && index === messages.length - 1;
          return (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="flex min-w-0 max-w-[88%] flex-col items-start">
              <div className={`chat-message min-w-0 max-w-full rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-white text-slate-700 shadow-sm border border-slate-100 rounded-bl-md'
              }`}>
                {msg.image && (
                  <img src={msg.image} alt="用户截图" className="mb-2 max-w-full rounded-lg"
                    style={{ maxHeight: '200px' }} />
                )}
                {msg.role === 'assistant' && msg.toolActivities && msg.toolActivities.length > 0 && (
                  <AgentActivity activities={msg.toolActivities} active={isActiveAssistant} />
                )}
                {msg.role === 'assistant' && msg.thinking && (
                  <ThinkingBlock content={msg.thinking} active={isActiveAssistant && isThinking} />
                )}
                {msg.content ? (
                  <MarkdownRenderer className="text-sm leading-relaxed markdown-body">{msg.content}</MarkdownRenderer>
                ) : isActiveAssistant ? (
                  <LoadingStatus text={thinkingStage} />
                ) : null}
              </div>
            </div>
          </div>
          );
        })}
        <div ref={messagesEndRef} />
        {showScrollToBottom && (
          <button
            type="button"
            onClick={() => {
              setShouldAutoScroll(true);
              setShowScrollToBottom(false);
              requestAnimationFrame(() => scrollToBottom('smooth'));
            }}
            className="sticky bottom-3 ml-auto flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-md transition-colors hover:bg-slate-50 hover:text-slate-700"
            aria-label="回到底部"
            title="回到底部"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
      </div>

      {pendingImages && pendingImages.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-200 bg-blue-50/60">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-blue-600 font-medium">截图已捕获（{pendingImages.length}/3）</p>
            <button type="button" onClick={onClearPendingImages}
              className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors">
              <X className="w-3 h-3" />
              清空
            </button>
          </div>
          {/* 后端未支持多图前，多余截图会留在列表等下一轮提问，提示用户避免误以为丢失 */}
          {pendingImages.length > 1 && (
            <p className="text-xs text-amber-600 mb-2">当前版本一次发送 1 张，其余保留在待发列表</p>
          )}
          <div className="flex gap-2 overflow-x-auto">
            {pendingImages.map((item) => (
              <div key={item.id} className="relative shrink-0">
                <img src={item.data} alt="待发送截图"
                  className="w-16 h-16 object-cover rounded-lg shadow-sm border border-indigo-200" />
                <button type="button"
                  onClick={() => onRemovePendingImage?.(item.id)}
                  className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-600 text-white hover:bg-red-500 transition-colors"
                  aria-label="删除该截图" title="删除该截图">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="px-4 py-2 border-t border-red-200 bg-red-50 text-xs text-red-600" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}
        className="p-3 sm:p-4 border-t border-slate-200 bg-white shrink-0">
        <div className="flex gap-2 items-end">
          <div className="min-w-0 flex-1">
            <FormulaComposer value={input} onChange={setInput} token={token ?? undefined}
              placeholder="输入问题…" disabled={isLoading} onSubmit={handleSubmit} />
          </div>
          <button type="submit" disabled={(!input.trim() && !(pendingImages && pendingImages.length > 0)) || isLoading}
            aria-label="发送" title="发送"
            className="px-4 sm:px-5 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all  active:scale-95 whitespace-nowrap">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

export default memo(ChatPanelInner);
