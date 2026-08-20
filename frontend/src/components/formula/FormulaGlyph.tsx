import { useMemo } from 'react';

import katex from 'katex';

// 工具栏/公式库按钮的公式图标：KaTeX 渲染符号本身，替代文字标签，认"长相"不认名字。
// 模板里的 #0/#? 占位符 KaTeX 不认识，先换成 \square 再渲染；
// 渲染失败回退 fallback 文字，按钮绝不空白。
export default function FormulaGlyph({ latex, fallback }: { latex: string; fallback: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex.replace(/#\d|#\?/g, '\\square'), {
        throwOnError: true,
        displayMode: false,
      });
    } catch {
      return null;
    }
  }, [latex]);
  if (!html) return <span>{fallback}</span>;
  return <span className="formula-glyph" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}
