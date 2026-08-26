import { ChevronDown, ChevronRight, ListTree, LoaderCircle, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import type { CatalogChapter, CatalogChapterSummary, TextbookCatalog } from '../catalog/types';

export interface TableOfContentsProps {
  chapters: CatalogChapterSummary[];
  currentPage?: number;
  loadChapter?: (chapter: string) => Promise<TextbookCatalog | null>;
  onSelectPage: (page: number) => void;
  onClose?: () => void;
  mobile?: boolean;
}

export function chapterIsCurrent(chapters: CatalogChapterSummary[], index: number, page: number): boolean {
  const start = chapters[index]?.first_page;
  if (!start || page < start) return false;
  const next = chapters[index + 1]?.first_page;
  return !next || page < next;
}

function pageLabel(page: number | null | undefined): string {
  return page == null ? '暂无页码' : `第 ${page} 页`;
}

/** A compact, shared TOC for the desktop toolbar and the mobile reader sheet. */
export default function TableOfContents({
  chapters,
  currentPage = 1,
  loadChapter,
  onSelectPage,
  onClose,
  mobile = false,
}: TableOfContentsProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, CatalogChapter | null>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleChapter = useCallback(async (chapter: CatalogChapterSummary) => {
    if (expanded === chapter.name) {
      setExpanded(null);
      return;
    }
    setExpanded(chapter.name);
    setError(null);
    if (details[chapter.name] || !loadChapter) return;
    setLoading(chapter.name);
    try {
      const catalog = await loadChapter(chapter.name);
      const loaded = catalog?.chapters.find(item => item.name === chapter.name) || null;
      setDetails(previous => ({ ...previous, [chapter.name]: loaded }));
      if (!loaded) setError('本章小节目录暂不可用');
    } catch {
      setError('本章小节目录暂不可用');
    } finally {
      setLoading(null);
    }
  }, [details, expanded, loadChapter]);

  const selectPage = (page: number | null | undefined) => {
    if (page == null || !Number.isFinite(page) || page < 1) return;
    onSelectPage(Math.floor(page));
    onClose?.();
  };

  return (
    <section
      aria-label="教材目录"
      data-testid="table-of-contents"
      className={mobile
        ? 'flex h-full min-h-0 flex-col bg-[var(--lm-surface)]'
        : 'w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--lm-border)] bg-[var(--lm-surface)] shadow-xl'}
    >
      <header className={`${mobile ? 'hidden' : 'flex'} shrink-0 items-center justify-between border-b border-[var(--lm-border)] px-4 py-3`}>
        <div className="flex min-w-0 items-center gap-2">
          <ListTree className="h-4 w-4 shrink-0 text-[var(--lm-brand)]" aria-hidden="true" />
          <h2 className="truncate text-sm font-semibold text-[var(--lm-text)]">教材目录</h2>
        </div>
        {onClose && <button type="button" onClick={onClose} className="icon-button" title="关闭目录" aria-label="关闭目录"><X className="h-4 w-4" /></button>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {chapters.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--lm-text-muted)]">目录暂不可用</p>
        ) : (
          <ol className="divide-y divide-[var(--lm-border)]">
            {chapters.map((chapter, index) => {
              const isExpanded = expanded === chapter.name;
              const isCurrent = chapterIsCurrent(chapters, index, currentPage);
              const detail = details[chapter.name];
              return (
                <li key={chapter.id || chapter.name}>
                  <div className={`flex items-stretch gap-1 ${isCurrent ? 'bg-[var(--lm-brand)]/8' : ''}`}>
                    <button
                      type="button"
                      data-testid={`toc-chapter-${index}`}
                      onClick={() => selectPage(chapter.first_page)}
                      disabled={chapter.first_page == null}
                      className="min-w-0 flex-1 px-4 py-3 text-left transition hover:bg-[var(--lm-brand)]/8 disabled:cursor-not-allowed disabled:opacity-50"
                      title={chapter.first_page == null ? '暂无页码' : `跳转到${chapter.name}`}
                    >
                      <span className="block truncate text-sm font-medium text-[var(--lm-text)]">{chapter.name}</span>
                      <span className="mt-0.5 block text-xs text-[var(--lm-text-muted)]">{pageLabel(chapter.first_page)} · {chapter.node_count} 个知识点</span>
                    </button>
                    {loadChapter && <button
                      type="button"
                      onClick={() => void toggleChapter(chapter)}
                      className="flex w-11 shrink-0 items-center justify-center text-[var(--lm-text-muted)] transition hover:bg-[var(--lm-brand)]/8 hover:text-[var(--lm-brand)]"
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? '收起' : '展开'}${chapter.name}小节`}
                      title={`${isExpanded ? '收起' : '展开'}小节`}
                    >
                      {loading === chapter.name ? <LoaderCircle className="h-4 w-4 animate-spin" /> : isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>}
                  </div>
                  {isExpanded && (
                    <div className="border-t border-[var(--lm-border)] bg-[var(--lm-bg)] px-4 py-2">
                      {detail?.sections.length ? (
                        <ul className="space-y-0.5">
                          {detail.sections.map(section => (
                            <li key={section.id || section.name}>
                              <button
                                type="button"
                                data-testid={`toc-section-${index}-${section.id || section.name}`}
                                onClick={() => selectPage(section.page)}
                                disabled={section.page == null}
                                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-xs text-[var(--lm-text-muted)] transition hover:bg-[var(--lm-brand)]/8 hover:text-[var(--lm-text)] disabled:cursor-not-allowed disabled:opacity-50"
                                title={section.page == null ? '暂无页码' : `跳转到${section.name}`}
                              >
                                <span className="min-w-0 truncate">{section.name}</span>
                                <span className="shrink-0 tabular-nums">{pageLabel(section.page)}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : loading === chapter.name ? (
                        <p className="flex items-center gap-2 px-2 py-2 text-xs text-[var(--lm-text-muted)]"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />正在加载小节…</p>
                      ) : (
                        <p className="px-2 py-2 text-xs text-[var(--lm-text-muted)]">{error || '暂无小节页码'}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
