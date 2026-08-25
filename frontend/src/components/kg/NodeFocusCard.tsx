import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

import type { ChapterCatalogEdge } from '../../catalog/types';
import type { LearningMapNode } from '../../services/api';
import { getNotationFormulas } from '../../utils/ladderLayout';
import { STATUS_LABEL, stripMath, typeMeta } from './shared';

/**
 * 节点聚焦详情卡（对齐 design-demos/map-home/map-home-demo-v3.html）：
 * 三块严格裁剪——
 *  ① 要先会（前置）：order 在前且有依赖边(USES/SUPERIOR/DERIVES/PART_OF/PREREQUISITE_OF)相连，
 *     就近取 ≤2；无边则取 order 紧邻在前 1 个并标注「按讲授顺序在前」。
 *  ② 方法·直接相关：仅与该节点有直接边相连的 Method，无边则整块不显示。
 *  ③ 用它练（题型）：直连 ProblemClass 优先，无边按 order 就近取代表；默认露 ≤3 个，
 *     其余「查看全部 N 个 →」折叠。
 * 非主干节点（方法/题型）则显示「关联知识点」。
 */

const STEM_TYPES = new Set(['concept', 'theorem', 'formula']);
const DEP_EDGE_TYPES = new Set(['USES', 'SUPERIOR', 'DERIVES', 'PART_OF', 'PREREQUISITE_OF']);
const DIRECT_EDGE_TYPES = new Set(['USES', 'APPLIES_TO']);

const isStem = (node: LearningMapNode) => STEM_TYPES.has(node.type?.toLowerCase() ?? '');
const byOrder = (a: LearningMapNode, b: LearningMapNode) => (a.order ?? 0) - (b.order ?? 0);

const ITEM_CLASS: Record<string, string> = {
  concept: 'c', theorem: 't', formula: 'c', method: 'm', problemclass: 'p',
};

export default function NodeFocusCard({ node, allNodes, edges, onJump, onStudy, onClose }: {
  node: LearningMapNode;
  allNodes: LearningMapNode[];
  edges: ChapterCatalogEdge[];
  onJump: (nodeId: string) => void;
  onStudy: (nodeId: string) => void;
  onClose: () => void;
}) {
  const [expandProblems, setExpandProblems] = useState(false);

  const meta = typeMeta(node.type);
  const stem = [...allNodes].filter(isStem).sort(byOrder);
  const stemIndex = stem.findIndex(item => item.node_id === node.node_id);
  const stemNode = isStem(node);

  /** 与指定节点有边相连的邻居节点，edgeTypes 限定边类型，targetType 限定邻居类型 */
  const neighborsOf = (fromId: string, edgeTypes?: Set<string>, targetType?: string) => {
    const ids = new Set<string>();
    edges.forEach(edge => {
      if (edgeTypes && !edgeTypes.has(edge.type)) return;
      if (edge.source === fromId) ids.add(edge.target);
      if (edge.target === fromId) ids.add(edge.source);
    });
    return allNodes.filter(item =>
      ids.has(item.node_id) && (!targetType || item.type?.toLowerCase() === targetType),
    );
  };
  const neighbors = (edgeTypes?: Set<string>, targetType?: string) =>
    neighborsOf(node.node_id, edgeTypes, targetType);

  /* ① 前置（≤2） */
  let prereqBlock: ReactNode = null;
  if (stemNode) {
    const before = stem.slice(0, Math.max(0, stemIndex));
    const linked = new Set(neighbors(DEP_EDGE_TYPES).map(item => item.node_id));
    const withEdge = before.filter(item => linked.has(item.node_id));
    const list = withEdge.length ? withEdge.slice(-2) : before.slice(-1);
    const approx = !withEdge.length && list.length > 0;
    prereqBlock = <>
      <h3 className="nfc-h">要先会</h3>
      {list.length > 0 ? <ul>{list.map(item => <JumpItem key={item.node_id} item={item} onJump={onJump} />)}</ul>
        : <p className="text-[13px] text-[var(--lm-text-muted)]">本节起点</p>}
    </>;
  }

  /* ①b 记法/公式：主干梯子已剔除的公式（HAS_PROPERTY / GETS 边判定，与梯子布局同一套边规则），这里收回展示 */
  let notationBlock: ReactNode = null;
  if (stemNode) {
    const notations = getNotationFormulas(node, allNodes, edges).sort(byOrder);
    if (notations.length > 0) {
      notationBlock = <>
        <h3 className="nfc-h">记法</h3>
        <ul>{notations.map(item => <JumpItem key={item.node_id} item={item} onJump={onJump} />)}</ul>
      </>;
    }
  }

  /* ② 方法 · 直接相关（仅直连，无边不显示整块） */
  let methodBlock: ReactNode = null;
  if (stemNode) {
    const directMethods = neighbors(DIRECT_EDGE_TYPES, 'method').sort(byOrder);
    if (directMethods.length > 0) {
      methodBlock = <>
        <h3 className="nfc-h">方法</h3>
        <ul>{directMethods.map(item => <JumpItem key={item.node_id} item={item} onJump={onJump} direct />)}</ul>
      </>;
    }
  }

  /* ③ 用它练 · 题型（直连排前+小圆点，其余本节相关排后；默认露 ≤3 不加序号，展开加淡序号） */
  let problemBlock: ReactNode = null;
  if (stemNode) {
    const directProblems = neighbors(DIRECT_EDGE_TYPES, 'problemclass').sort(byOrder);
    const directIds = new Set(directProblems.map(item => item.node_id));
    const others = allNodes
      .filter(item => item.type?.toLowerCase() === 'problemclass' && !directIds.has(item.node_id))
      .sort((a, b) => Math.abs((a.order ?? 0) - (node.order ?? 0)) - Math.abs((b.order ?? 0) - (node.order ?? 0)));
    const list = [...directProblems, ...others];
    if (list.length > 0) {
      const shown = expandProblems ? list : list.slice(0, 3);
      const hidden = list.length - shown.length;
      problemBlock = <>
        <h3 className="nfc-h">用它练</h3>
        <ul>{shown.map((item, idx) => (
          <JumpItem key={item.node_id} item={item} onJump={onJump}
            index={expandProblems ? idx + 1 : undefined} direct={directIds.has(item.node_id)} />
        ))}</ul>
        {hidden > 0 && <button type="button" className="nfc-more" onClick={() => setExpandProblems(true)}>查看全部 {list.length} 个 →</button>}
      </>;
    }
  }

  /* 非主干（方法/题型）：关联知识点——两跳穿透（题型-USES->方法-GETS/USES->概念） */
  let hostsBlock: ReactNode = null;
  if (!stemNode) {
    const seen = new Map<string, LearningMapNode>();
    let indirect = false;
    const firstHop = neighbors();
    firstHop.forEach(item => {
      if (isStem(item)) seen.set(item.node_id, item);
    });
    firstHop.forEach(item => {
      if (isStem(item)) return;
      neighborsOf(item.node_id).forEach(second => {
        if (isStem(second) && second.node_id !== node.node_id) {
          if (!seen.has(second.node_id)) indirect = true;
          seen.set(second.node_id, second);
        }
      });
    });
    const hosts = [...seen.values()].sort(byOrder);
    hostsBlock = <>
      <h3 className="nfc-h">关联知识点{indirect && <span className="ml-1 text-[11px] font-normal text-[var(--lm-text-muted)]">（含间接）</span>}</h3>
      {hosts.length > 0
        ? <ul>{hosts.map(item => <JumpItem key={item.node_id} item={item} onJump={onJump} prefix={`${typeMeta(item.type).label} · `} />)}</ul>
        : <p className="text-[13px] text-[var(--lm-text-muted)]">本节内无边相连</p>}
    </>;
  }

  return <div className="relative rounded-xl border border-[var(--lm-border)] bg-[var(--lm-surface)] p-4">
    <button type="button" onClick={onClose} aria-label="关闭详情" title="关闭详情"
      className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
      <X className="h-4 w-4" />
    </button>
    <h2 className="serif-zh pr-8 text-[17px] font-semibold text-slate-900 dark:text-slate-50">{stripMath(node.name)}</h2>
    <div className="mb-3 mt-1.5 text-xs text-[var(--lm-text-muted)]">
      <span className="mr-1.5 inline-block rounded-md px-1.5 py-0.5 text-xs text-white" style={{ background: meta.color }}>{meta.label}</span>
      {STATUS_LABEL[node.status]}
    </div>
    {prereqBlock}
    {notationBlock}
    {methodBlock}
    {problemBlock}
    {hostsBlock}
    <button type="button" onClick={() => onStudy(node.node_id)}
      className="mt-4 w-full rounded-lg bg-[var(--lm-brand)] py-2 text-sm font-medium text-white transition hover:brightness-105">
      去学这个 →
    </button>
  </div>;
}

function JumpItem({ item, onJump, prefix, index, direct }: {
  item: LearningMapNode;
  onJump: (nodeId: string) => void;
  prefix?: string;
  /** 展开态传入 1 起序号；折叠态不传（无序号） */
  index?: number;
  /** 与当前概念有直连边：名字前加品牌色小圆点 */
  direct?: boolean;
}) {
  const cls = ITEM_CLASS[item.type?.toLowerCase() ?? 'concept'] ?? 'c';
  return <li>
    <button type="button" onClick={() => onJump(item.node_id)}
      className="group flex w-full items-start gap-1.5 rounded px-0 py-0.5 text-left text-[13px] text-slate-700 dark:text-slate-200">
      {index !== undefined
        ? <span className="mt-px w-4 flex-none text-right text-[11px] leading-[18px] text-[var(--lm-text-muted)]" aria-hidden="true">{index}.</span>
        : <span className={`nfc-dot nfc-dot-${cls} mt-1.5`} aria-hidden="true" />}
      <span className="min-w-0 flex-1 break-words leading-snug transition group-hover:text-[var(--lm-brand)] group-hover:underline">
        {direct && <span className="mr-1 inline-block h-[5px] w-[5px] rounded-full align-[2px]" style={{ background: 'var(--lm-brand)' }} aria-label="直连" title="与本概念直连" />}
        {prefix}{stripMath(item.name)}
      </span>
    </button>
  </li>;
}
