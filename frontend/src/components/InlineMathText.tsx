import { useMemo } from 'react';
import katex from 'katex';

function renderFormula(source: string): string {
  const normalized = source.replace(/\\{2,}/g, '\\');
  return katex.renderToString(normalized, {
    displayMode: false,
    throwOnError: false,
    strict: 'ignore',
    trust: false,
  });
}

export default function InlineMathText({ children }: { children: string }) {
  const parts = useMemo(() => children.split(/(\$[^$\n]+\$)/g), [children]);

  return <>{parts.map((part, index) => {
    if (part.length >= 2 && part.startsWith('$') && part.endsWith('$')) {
      return <span key={index} dangerouslySetInnerHTML={{ __html: renderFormula(part.slice(1, -1)) }} />;
    }
    return <span key={index}>{part}</span>;
  })}</>;
}
