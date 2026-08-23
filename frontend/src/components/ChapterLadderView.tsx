import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import type { ChapterCatalogEdge } from '../catalog/types';
import type { LearningMapNode, LearningStatus, NodeMapResponse } from '../services/api';
import SectionLadder from './kg/SectionLadder';
import ChapterOverview from './kg/ChapterOverview';
import NodeDetailCard from './kg/NodeDetailCard';
import { CornerBadge, GlyphShape } from './kg/NodeGlyph';
import { STATUS_LABEL, STATUS_ORDER, TYPE_META, isProblemType, stripMath } from './kg/shared';

const STEM_TYPES = new Set(['concept', 'theorem', 'formula']);
const isStem = (type?: string) => STEM_TYPES.has(type?.toLowerCase() ?? '');
const isLeaf = (type?: string) => !isStem(type);

type Screen = 'overview' | 'ladder';

function Legend() {
  return <details className="group relative">
    <summary className="inline-flex h-7 cursor-pointer list-none items-center rounded-full border border-[var(--lm-border)] px-3 text-[11px] font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">图例</summary>
    <div className="absolute right-0 z-30 mt-1 w-80 rounded-lg border border-[var(--lm-border)] bg-[var(--lm-surface)] p-3 text-xs text-slate-600 shadow-lg dark:text-slate-300">
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1.5">
        {STATUS_ORDER.map(status => <span key={status} className="inline-flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="-4 -14 18 18" aria-hidden="true"><CornerBadge status={status} /></svg>
          {STATUS_LABEL[status]}
        </span>)}
      </div>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-[var(--lm-border)] pt-2">
        {Object.entries(TYPE_META).map(([key, meta]) => <span key={key} className="inline-flex items-center gap-1.5">
          <svg width="16" height="16" viewBox="-9 -9 18 18" aria-hidden="true"><GlyphShape type={key} /></svg>
          {meta.label}
        </span>)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 border-t border-[var(--lm-border)] pt-2">
        <span className="inline-flex items-center gap-1.5"><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" className="kg-spine" strokeWidth="7" /></svg>学习路径（课本顺序）</span>
        <span className="inline-flex items-center gap-1.5"><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" stroke="var(--lm-edge)" strokeWidth="1.6" /></svg>已确认关系</span>
        <span className="inline-flex items-center gap-1.5"><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" stroke="var(--lm-brand)" strokeWidth="2.2" /></svg>选中节点的出边</span>
        <span className="inline-flex items-center gap-1.5"><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" stroke="var(--lm-edge-in)" strokeWidth="2.2" /></svg>选中节点的入边</span>
      </div>
    </div>
  </details>;
}

/**
 * 章知识地图（E v3.2 串联版）：章总览（默认落点）→ 节梯子 → 详情卡。
 */
export default function ChapterLadderView({ data, edges, onOpenChat, onContinueNode, initialSection }: {
  data: NodeMapResponse;
  edges: ChapterCatalogEdge[];
  onOpenChat: (chatId: string) => void;
  onContinueNode?: (node: LearningMapNode) => void;
  initialSection?: string | null;
}) {
  const [screen, setScreen] = useState<Screen>(() => initialSection ? 'ladder' : 'overview');
  const [currentSection, setCurrentSection] = useState<string | null>(() => initialSection ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodes = useMemo(() => data.sections.flatMap(section => section.nodes), [data.sections]);
  const chapterExplored = useMemo(() => nodes.filter(n => n.status !== 'unexplored').length, [nodes]);
  const chapterReview = useMemo(() => nodes.filter(n => n.status === 'needs_review').length, [nodes]);
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.node_id, node])), [nodes]);
  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;

  const activeSection = currentSection ?? data.sections[0]?.section ?? '';
  const sectionGroup = data.sections.find(group => group.section === activeSection);
  const sectionNodes = sectionGroup?.nodes ?? [];
  const sectionIds = useMemo(() => new Set(sectionNodes.map(node => node.node_id)), [sectionNodes]);
  const sectionEdges = useMemo(() => edges.filter(edge => sectionIds.has(edge.source) && sectionIds.has(edge.target)), [edges, sectionIds]);

  const toggleSelect = (nodeId: string) => setSelectedId(prev => (prev === nodeId ? null : nodeId));

  const goTo = (nodeId: string) => {
    const target = nodeById.get(nodeId);
    if (!target) return;
    if (isLeaf(target.type) && screen === 'ladder') return; // 分支节点不上主干，详情卡内跳转忽略
    if (screen === 'ladder' && target.section !== activeSection) setCurrentSection(target.section);
    setSelectedId(nodeId);
  };

  return <div className="flex h-full flex-col bg-[var(--lm-bg)]" data-testid="chapter-ladder-view">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--lm-border)] bg-[var(--lm-surface)] px-4 py-2.5">
      {screen === 'overview' && <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
        章总览 · {data.sections.length} 节 · {nodes.length} 知识点
        {chapterExplored > 0 ? ` · 已探索 ${chapterExplored}` : ''}
        {chapterReview > 0 ? ` · 需巩固 ${chapterReview}` : ''}
      </span>}
      {screen !== 'overview' && <button type="button" onClick={() => { setScreen('overview'); setSelectedId(null); }} className="inline-flex h-7 items-center gap-1 rounded-full border border-[var(--lm-border)] px-3 text-[11px] font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"><ArrowLeft className="h-3 w-3" />返回总览</button>}
      {screen === 'ladder' && <select aria-label="切换小节" value={activeSection} onChange={event => { setCurrentSection(event.target.value); setSelectedId(null); }} className="h-7 max-w-56 rounded-md border border-[var(--lm-border)] bg-[var(--lm-surface)] px-2 text-xs text-slate-600 dark:text-slate-300">
        {data.sections.map(group => <option key={group.section} value={group.section}>{stripMath(group.section)}</option>)}
      </select>}
      <div className="ml-auto flex items-center gap-2">
        <Legend />
      </div>
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto">
      {screen === 'overview' && <ChapterOverview data={data} onOpenSection={(section) => { setCurrentSection(section); setScreen('ladder'); }} />}
      {screen === 'ladder' && sectionGroup && <>
        <div className="max-h-[62vh] overflow-y-auto border-b border-[var(--lm-border)] bg-[var(--lm-surface)]">
          <SectionLadder section={sectionGroup} edges={sectionEdges} selectedId={selectedId} onSelect={toggleSelect} />
        </div>
        {!selected && <p className="px-4 py-3 text-center text-xs text-slate-400">点击梯子上的图形查看详情</p>}
        {selected && <div className="px-4 pb-6"><NodeDetailCard node={selected} nodes={nodes} edges={edges} onSelect={goTo} onClose={() => setSelectedId(null)} onContinueNode={onContinueNode} onOpenChat={onOpenChat} /></div>}
      </>}
    </div>
  </div>;
}
