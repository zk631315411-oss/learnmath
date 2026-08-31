import type { Source } from '../types';

const CITATION_RE = /\[\[cite:([A-Za-z0-9_.:-]{1,240})\]\]/g;
export const SOURCE_HREF_PREFIX = '#learnmath-textbook-source-';

export function isClickableSource(source: Source | null | undefined): source is Required<Pick<Source,
  'textbook_id' | 'textbook_name' | 'node_id' | 'node_name' | 'chapter' | 'section' | 'source_code' | 'snippet'
>> & Source {
  return Boolean(
    source?.textbook_id && source.textbook_name && source.node_id && source.node_name
    && source.chapter && source.section && source.source_code && source.snippet,
  );
}

export function sourceLabel(source: Source): string {
  const match = (source.section || '').match(/(?:^|\s|§)(\d+(?:\.\d+)+)(?=\s|$)/);
  return match ? `教材 §${match[1]}` : '教材出处';
}

export function sourceHref(sourceCode: string): string {
  return `${SOURCE_HREF_PREFIX}${encodeURIComponent(sourceCode)}`;
}

export function sourceCodeFromHref(href: string): string | null {
  if (!href.startsWith(SOURCE_HREF_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(SOURCE_HREF_PREFIX.length));
  } catch {
    return null;
  }
}

/** Convert only server-validated markers; unmatched and streaming markers stay hidden. */
export function renderCitationMarkers(content: string, sources: Source[] = [], streaming = false): string {
  const byCode = new Map(
    sources.filter(isClickableSource).map(source => [source.source_code, source]),
  );
  return content.replace(CITATION_RE, (_marker, code: string) => {
    if (streaming) return '';
    const source = byCode.get(code);
    return source ? `[${sourceLabel(source)}](${sourceHref(code)})` : '';
  });
}

export function uniqueClickableSources(sources: Source[] = []): Source[] {
  const seen = new Set<string>();
  return sources.filter(source => {
    if (!isClickableSource(source) || seen.has(source.source_code)) return false;
    seen.add(source.source_code);
    return true;
  });
}
