import { memo } from 'react';
import { BookOpen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { formatMarkdownMath } from '../utils/formatMarkdownMath';
import type { Source } from '../types';
import { renderCitationMarkers, sourceCodeFromHref } from '../utils/sourceCitations';

interface Props {
  children: string;
  className?: string;
  applyFormatMath?: boolean;  // 默认 true，ExercisePanel 可传 false
  sources?: Source[];
  streaming?: boolean;
  onOpenSource?: (source: Source) => void;
}

function MarkdownRenderer({ children, className, applyFormatMath = true, sources = [], streaming = false, onOpenSource }: Props) {
  const citedContent = renderCitationMarkers(children, sources, streaming);
  const content = applyFormatMath ? formatMarkdownMath(citedContent) : citedContent;
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
        a: ({ href = '', children }) => {
          const sourceCode = sourceCodeFromHref(href);
          const source = sourceCode ? sources.find(item => item.source_code === sourceCode) : undefined;
          if (sourceCode && source) {
            // 引用徽标：淡靛蓝底小药丸 + 书图标 + 短标签(§2.1)，无下划线，hover 加深
            return <button
              type="button"
              onClick={() => onOpenSource?.(source)}
              title={`${source.textbook_name} ${source.section} · ${source.node_name}`}
              aria-label={`教材出处 ${source.section} ${source.node_name}`}
              className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 align-baseline text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300 dark:hover:bg-indigo-900/70 dark:hover:text-indigo-100"
            ><BookOpen className="h-3 w-3 shrink-0" aria-hidden />{children}</button>;
          }
          return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export default memo(MarkdownRenderer);
