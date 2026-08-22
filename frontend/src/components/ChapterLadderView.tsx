import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import type { ChapterCatalogEdge } from '../catalog/types';
import type { LearningMapNode, LearningStatus, NodeMapResponse } from '../services/api';
import ChapterIslands from './kg/ChapterIslands';
import ChapterOverview from './kg/ChapterOverview';
import NodeDetailCard from './kg/NodeDetailCard';
import SectionLadder from './kg/SectionLadder';
import { CornerBadge, GlyphShape } from './kg/NodeGlyph';
import { STATUS_LABEL, STATUS_ORDER, TYPE_META, isProblemType, stripMath } from './kg/shared';

type Screen = 'overview' | 'ladder' | 'islands';

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
        <span className="inline-flex items-center gap-1.5"><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" stroke="var(--lm-edge)" strokeWidth="1.6" /></svg>已确认关系（岛屿总览）</span>
        <span className="inline-flex items-center gap-1.5"><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" stroke="var(--lm-brand)" strokeWidth="2.2" /></svg>选中节点的出边</span>
        <span className="inline-flex items-center gap-1.5"><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" stroke="var(--lm-edge-in)" strokeWidth="2.2" /></svg>选中节点的入边</span>
      </div>
    </div>
  </details>;
}

/**
 * 章知识地图（E v3.2 串联版）：章总览（默认落点，含岛屿入口）→ 节梯子 → 详情卡；
 * 岛屿总览不再占工具条按钮，从章总览的安静链接进入；
 * 岛屿里选中节点的详情卡带「定位到节梯子」，形成 岛→梯子 回链。
 */
export default function ChapterLadderView({ data, edges, onOpenChat, onContinueNode }: {
  data: NodeMapResponse;
  edges: ChapterCatalogEdge[];
  onOpenChat: (chatId: string) => void;
  onContinueNode?: (node: LearningMapNode) => void;
}) {
  const [screen, setScreen] = useState<Screen>('overview');
  const [currentSection, setCurrentSection] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodes = useMemo(() => data.sections.flatMap(section => section.nodes), [data.sections]);
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.node_id, node])), [nodes]);
  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;

  const activeSection = currentSection ?? data.sections[0]?.section ?? '';
  const sectionGroup = data.sections.find(group => group.section === activeSection);
  const sectionNodes = sectionGroup?.nodes ?? [];
  const sectionIds = useMemo(() => new Set(sectionNodes.map(node => node.node_id)), [sectionNodes]);
  const sectionEdges = useMemo(() => edges.filter(edge => sectionIds.has(edge.source) && sectionIds.has(edge.target)), [edges, sectionIds]);
  const visibleChapterNodes = useMemo(() => nodes.filter(node => showProblems || !isProblemType(node.type)), [nodes, showProblems]);

  const toggleSelect = (nodeId: string) => setSelectedId(prev => (prev === nodeId ? null : nodeId));

  const goTo = (nodeId: string) => {
    const target = nodeById.get(nodeId);
    if (!target) return;
    if (isProblemType(target.type) && !showProblems && screen === 'ladder') return; // 题型被收起时忽略跳转
    if (screen === 'ladder' && target.section !== activeSection) setCurrentSection(target.section);
    setSelectedId(nodeId);
  };

  // 岛→梯子回链：切到节点所在节并高亮（题型自动展开显示）
  const locateInLadder = (node: LearningMapNode) => {
    if (isProblemType(node.type) && !showProblems) setShowProblems(true);
    setCurrentSection(node.section);
    setScreen('ladder');
    setSelectedId(node.node_id);
  };

  const toggleProblems = () => {
    setShowProblems(value => !value);
    if (selected && isProblemType(selected.type)) setSelectedId(null);
  };

  return <div className="flex h-full flex-col bg-[var(--lm-bg)]" data-testid="chapter-ladder-view">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--lm-border)] bg-[var(--lm-surface)] px-4 py-2.5">
      {screen === 'overview' && <span className="text-sm font-medium text-slate-700 dark:text-slate-200">章总览 · {data.sections.length} 节 · {nodes.length} 知识点</span>}
      {screen !== 'overview' && <button type="button" onClick={() => { setScreen('overview'); setSelectedId(null); }} className="inline-flex h-7 items-center gap-1 rounded-full border border-[var(--lm-border)] px-3 text-[11px] font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"><ArrowLeft className="h-3 w-3" />返回总览</button>}
      {screen === 'ladder' && <select aria-label="切换小节" value={activeSection} onChange={event => { setCurrentSection(event.target.value); setSelectedId(null); }} className="h-7 max-w-56 rounded-md border border-[var(--lm-border)] bg-[var(--lm-surface)] px-2 text-xs text-slate-600 dark:text-slate-300">
        {data.sections.map(group => <option key={group.section} value={group.section}>{stripMath(group.section)}</option>)}
      </select>}
      {screen === 'islands' && <span className="text-sm font-medium text-slate-700 dark:text-slate-200">岛屿总览 · 整章连通分量</span>}
      <div className="ml-auto flex items-center gap-2">
        {screen !== 'overview' && <button type="button" aria-pressed={showProblems} onClick={toggleProblems} className={`inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-medium transition-colors ${showProblems ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900' : 'border-[var(--lm-border)] text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>显示题型</button>}
        <Legend />
      </div>
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto">
      {screen === 'overview' && <ChapterOverview data={data} edges={edges} onOpenIslands={() => setScreen('islands')} onOpenChat={onOpenChat} onContinueNode={onContinueNode} />}
      {screen === 'ladder' && sectionGroup && <>
        <div className="max-h-[62vh] overflow-y-auto border-b border-[var(--lm-border)] bg-[var(--lm-surface)]">
          <SectionLadder section={sectionGroup} edges={sectionEdges} showProblems={showProblems} selectedId={selectedId} onSelect={toggleSelect} />
        </div>
        {!selected && <p className="px-4 py-3 text-center text-xs text-slate-400">点击梯子或侧枝上的图形，展开聚焦子图（整章范围）与关系明细</p>}
        {selected && <div className="px-4 pb-6"><NodeDetailCard node={selected} nodes={nodes} edges={edges} onSelect={goTo} onClose={() => setSelectedId(null)} onContinueNode={onContinueNode} onOpenChat={onOpenChat} /></div>}
      </>}
      {screen === 'islands' && <>
        <ChapterIslands nodes={visibleChapterNodes} edges={edges} selectedId={selectedId} onSelect={toggleSelect} />
        {!selected && <p className="px-4 py-3 text-center text-xs text-slate-400">点击岛屿中的图形，展开聚焦子图（整章范围）与关系明细，或定位到它所在的节梯子</p>}
        {selected && <div className="px-4 pb-6"><NodeDetailCard node={selected} nodes={nodes} edges={edges} onSelect={goTo} onClose={() => setSelectedId(null)} onContinueNode={onContinueNode} onOpenChat={onOpenChat} onLocate={locateInLadder} /></div>}
      </>}
    </div>
  </div>;
}
