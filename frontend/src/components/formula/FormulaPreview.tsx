import { useMemo } from 'react';

import katex from 'katex';

// P4：对话框内的公式预览对坏公式有感知。
// 全局 MarkdownRenderer 的 KaTeX 配置是 throwOnError:false，坏公式只会静默丢渲染，
// 用户无法区分「没输入」和「公式写错」。这里改用 throwOnError:true + try/catch，
// 渲染失败时给出明确提示，而不是显示乱码或 LaTeX 源码。
interface Props {
  latex: string;
  display: 'inline' | 'block';
}

export default function FormulaPreview({ latex, display }: Props) {
  const rendered = useMemo(() => {
    const trimmed = latex.trim();
    if (!trimmed) return null;
    try {
      return {
        html: katex.renderToString(trimmed, {
          displayMode: display === 'block',
          throwOnError: true,
        }),
      };
    } catch {
      // 坏公式：返回 undefined 与「空输入」区分开，由调用方渲染提示文案
      return undefined;
    }
  }, [latex, display]);

  if (!latex.trim()) return <em>等待输入</em>;
  // 不用 role="alert"：转换失败行已是唯一的 role="alert"，这里用 aria-live 避免双 alert 触发 E2E strict mode 冲突
  if (!rendered) return <p className="formula-preview-error" aria-live="polite">公式可能无法渲染，请检查</p>;
  return <div className="formula-preview-render" dangerouslySetInnerHTML={{ __html: rendered.html }} />;
}
