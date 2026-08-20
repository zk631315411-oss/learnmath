export interface ChapterTitleParts {
  number: string | null;
  title: string;
  display: string;
}

const chineseChapterPattern = /^\s*(第\s*\d+\s*章)\s*(.*)$/;
const numericChapterPattern = /^\s*(\d+\s*[.]?)\s*(.*)$/;

export function splitChapterTitle(value: string): ChapterTitleParts {
  const raw = String(value || '').trim();
  if (!raw) return { number: null, title: '', display: '' };

  const chineseMatch = raw.match(chineseChapterPattern);
  if (chineseMatch) {
    const number = `第 ${chineseMatch[1].replace(/\D/g, '')} 章`;
    const title = chineseMatch[2].trim();
    return { number, title, display: title || number };
  }

  const numericMatch = raw.match(numericChapterPattern);
  if (numericMatch && /^\d/.test(numericMatch[1])) {
    const number = `第 ${numericMatch[1].replace('.', '').trim()} 章`;
    const title = numericMatch[2].trim();
    return { number, title, display: title || number };
  }

  return { number: null, title: raw, display: raw };
}
