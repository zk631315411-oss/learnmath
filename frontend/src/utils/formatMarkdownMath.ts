export function formatMarkdownMath(text: string | undefined): string {
  if (!text) return '';

  let formatted = '';
  for (let i = 0; i < text.length; i += 1) {
    const current = text[i];
    const next = text[i + 1];
    const previous = text[i - 1];

    if (
      current === '\\'
      && previous !== '\\'
      && (next === '(' || next === ')' || next === '[' || next === ']')
    ) {
      formatted += next === '[' || next === ']' ? '$$' : '$';
      i += 1;
      continue;
    }

    formatted += current;
  }

  return formatted;
}
