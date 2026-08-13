import { useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import type { Marker } from './PageMarker';

interface Props {
  marker: Marker;
  onClose: () => void;
  onDelete: (id: string) => void;
}

const popKatexCSS = `
  .popover-content .katex-display,
  .popover-content .katex-display > .katex {
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .popover-content .katex {
    max-width: 100%;
  }
`;

export default function MarkerPopover({ marker, onClose, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const hasAnswer = marker.answer && marker.answer.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-start justify-center pt-[10vh] bg-black/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[75vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {marker.marker_type === 'screenshot' ? '🔴' : '🔵'} 第{marker.page_number}页 · 提问
          </span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-lg leading-none">✕</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 popover-content">
          <style>{popKatexCSS}</style>
          {/* 首个问题 */}
          <div className="p-3 bg-blue-50 dark:bg-blue-900/10 rounded-lg">
            <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">问题</p>
            <div               className="text-sm text-slate-700 dark:text-slate-300 marker-popover-content"><MarkdownRenderer>{marker.question}</MarkdownRenderer></div>
          </div>

          {/* 回答 */}
          {hasAnswer ? (
            <div className="p-3 bg-green-50 dark:bg-green-900/10 rounded-lg">
              <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">回答</p>
              <div               className="text-sm text-slate-700 dark:text-slate-300 marker-popover-content"><MarkdownRenderer>{marker.answer!}</MarkdownRenderer></div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
              <span className="animate-pulse">●</span> AI 正在思考...
            </div>
          )}

          {/* 追问历史 */}
          {marker.follow_ups && marker.follow_ups.length > 0 && marker.follow_ups.map((fu, i) => (
            <div key={i} className="space-y-2 pl-3 border-l-2 border-slate-300 dark:border-slate-600">
              <div className="p-2 bg-slate-50 dark:bg-slate-900 rounded">
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-0.5">追问 {i + 1}</p>
                <div className="text-xs text-slate-700 dark:text-slate-300 marker-popover-content"><MarkdownRenderer>{fu.question}</MarkdownRenderer></div>
              </div>
              {fu.answer ? (
                <div className="p-2 bg-green-50 dark:bg-green-900/10 rounded">
                  <div className="text-xs text-slate-600 dark:text-slate-400 marker-popover-content"><MarkdownRenderer>{fu.answer}</MarkdownRenderer></div>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-xs text-slate-400 pl-2">
                  <span className="animate-pulse">●</span> 思考中...
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-700">
          <span className="text-xs text-slate-400">标记 ID: {marker.id.slice(0, 8)}...</span>
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-500">确认删除？</span>
              <button onClick={() => { onDelete(marker.id); setConfirming(false); onClose(); }} className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">删除</button>
              <button onClick={() => setConfirming(false)} className="px-3 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-100 dark:hover:bg-slate-700">取消</button>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)} className="text-sm text-slate-400 hover:text-red-500 transition-colors">删除此对话</button>
          )}
        </div>
      </div>
    </div>
  );
}
