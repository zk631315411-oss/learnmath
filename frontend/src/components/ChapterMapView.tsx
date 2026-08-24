import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, Map as MapIcon } from 'lucide-react';

import type { ChapterCatalogEdge } from '../catalog/types';
import type { LearningMapNode, NodeMapResponse } from '../services/api';
import { splitChapterTitle } from '../utils/chapterTitle';
import SectionLadderPanel from './kg/SectionLadderPanel';
import InlineMathText from './InlineMathText';
import { sectionStatusSummary } from './kg/shared';

/**
 * 地图页（整章视图）：与主页同款「节就地展开 = 纯概念梯子 + 聚焦详情卡 + 节尾方法题型清单」，
 * 复用 SectionLadderPanel，不再使用旧侧枝梯子/NodeDetailCard。
 */
export default function ChapterMapView({ data, edges, onBack, onStartReading, onContinueNode, initialSection }: {
  data: NodeMapResponse;
  edges?: ChapterCatalogEdge[];
  onBack: () => void;
  onStartReading?: () => void;
  onContinueNode?: (chapter: string, node: LearningMapNode) => void;
  initialSection?: string | null;
}) {
  const [expandedSection, setExpandedSection] = useState<string | null>(initialSection ?? null);
  useEffect(() => { if (initialSection) setExpandedSection(initialSection); }, [initialSection]);
  const title = splitChapterTitle(data.chapter);

  const toggle = (section: string) => setExpandedSection(prev => prev === section ? null : section);

  return <div className="flex h-full flex-col bg-[var(--lm-bg)]" data-testid="chapter-map-view">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--lm-border)] bg-[var(--lm-surface)] px-3 py-2.5 sm:px-4">
      <button type="button" onClick={onBack} aria-label="返回学习地图" title="返回学习地图" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-[var(--lm-border)] px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-800"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">学习地图</span></button>
      <div className="min-w-[10rem] flex-1">{title.number && <p className="text-[11px] font-medium text-slate-400">{title.number}</p>}<h1 className="serif-zh truncate text-base font-semibold text-slate-800 dark:text-slate-100">{title.title || title.display}</h1></div>
      <span className="inline-flex items-center gap-1 text-xs text-slate-400"><MapIcon className="h-3.5 w-3.5" />{data.sections.length} 节</span>
      {onStartReading && <button type="button" onClick={onStartReading} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-700"><BookOpen className="h-3.5 w-3.5" />开始本章</button>}
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
      <ul className="mx-auto max-w-5xl divide-y divide-[var(--lm-border)] border-y border-[var(--lm-border)]">
        {data.sections.map(section => {
          const expanded = expandedSection === section.section;
          const hasReview = section.nodes.some(node => node.status === 'needs_review');
          return <li key={section.section}>
            <button type="button" onClick={() => toggle(section.section)} aria-expanded={expanded} className="group flex w-full items-baseline justify-between gap-4 px-2 py-3 text-left text-sm transition hover:text-indigo-700 dark:hover:text-indigo-300">
              <span className="inline-flex min-w-0 items-center gap-2 truncate text-slate-600 group-hover:text-indigo-700 dark:text-slate-300 dark:group-hover:text-indigo-300">
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
                <InlineMathText>{section.section}</InlineMathText>
              </span>
              <span className={`shrink-0 text-xs ${hasReview ? 'text-rose-600 dark:text-rose-300' : 'text-slate-400'}`}>{sectionStatusSummary(section.nodes)}</span>
            </button>
            {expanded && <div className="pb-4 pl-6 pr-1 sm:pl-8"><SectionLadderPanel chapter={data.chapter} section={section} edges={edges || []} onContinueNode={onContinueNode} /></div>}
          </li>;
        })}
      </ul>
    </div>
  </div>;
}
