import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// LaTeX 分隔符转换：\( → $, \[ → $$
const formatMath = (text: string | undefined) => {
  if (!text) return '';
  return text.split('\\(').join('$').split('\\)').join('$').split('\\[').join('$$').split('\\]').join('$$');
};

interface Props {
  children: string;
  className?: string;
  applyFormatMath?: boolean;  // 默认 true，ExercisePanel 可传 false
}

function MarkdownRenderer({ children, className, applyFormatMath = true }: Props) {
  const content = applyFormatMath ? formatMath(children) : children;
  return (
    <ReactMarkdown
      className={className}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        code: ({ children }) => <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded text-xs">{children}</code>,
        pre: ({ children }) => <pre className="bg-slate-100 dark:bg-slate-700 p-2 rounded overflow-x-auto text-xs mb-2">{children}</pre>,
        table: ({ children }) => <div className="mb-4 overflow-x-auto"><table className="min-w-full border-collapse text-sm">{children}</table></div>,
        th: ({ children }) => <th className="border border-slate-300 bg-slate-50 px-3 py-2 text-center font-medium dark:border-slate-600 dark:bg-slate-800">{children}</th>,
        td: ({ children }) => <td className="border border-slate-300 px-3 py-2 text-center dark:border-slate-600">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export default memo(MarkdownRenderer);
