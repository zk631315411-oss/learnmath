/**
 * 纯文本数学公式输入框（LearnMath 精简版）
 *
 * 保留了核心的消息发送功能，砍掉 ai-math 的 AI 描述转写（convertFormula）。
 * 输入框为简单 textarea，支持多行，Enter 发送、Shift+Enter 换行。
 * 视觉：柔和现代风，圆角 + 淡蓝聚焦环。
 */
import { useRef } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onSubmit?: () => void;
}

export default function FormulaComposer({
  value, onChange, placeholder = '输入数学问题，或先截图后提问…', disabled, onSubmit,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送，Shift+Enter 换行，避免中文输入法组合期间误发
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!disabled && (value.trim() || onSubmit)) onSubmit?.();
    }
  };

  const autosize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(132, el.scrollHeight)}px`;
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => { onChange(e.target.value); autosize(); }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        placeholder={placeholder}
        className="w-full resize-none rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 transition-all focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-100 disabled:opacity-60 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-indigo-500 dark:focus:ring-indigo-900/30"
      />
    </div>
  );
}
