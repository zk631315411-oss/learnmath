import type { KeyboardEvent } from 'react';

import type { LearningMapNode, LearningStatus } from '../../services/api';
import { STATUS_LABEL, STATUS_VAR, stripMath, typeMeta } from './shared';

/** 形状=类型：概念圆 / 定理三角 / 公式方 / 方法六边形 / 题型纸页（两横线） */
export function GlyphShape({ type }: { type?: string }) {
  const meta = typeMeta(type);
  const key = type?.toLowerCase() || 'concept';
  const common = { fill: 'var(--lm-surface)', stroke: meta.color, strokeWidth: 2 };
  if (key === 'theorem') return <path d="M 0 -8 L 7.5 6 L -7.5 6 Z" strokeLinejoin="round" {...common} />;
  if (key === 'formula') return <rect x="-6.5" y="-6.5" width="13" height="13" rx="2" {...common} />;
  if (key === 'method') return <path d="M 7.5 0 L 3.75 6.5 L -3.75 6.5 L -7.5 0 L -3.75 -6.5 L 3.75 -6.5 Z" strokeLinejoin="round" {...common} />;
  if (key === 'problemclass') return <>
    <rect x="-5" y="-6.5" width="10" height="13" rx="1.8" {...common} />
    <line x1="-2.4" y1="-1.6" x2="2.4" y2="-1.6" stroke={meta.color} strokeWidth="1.3" />
    <line x1="-2.4" y1="1.8" x2="2.4" y2="1.8" stroke={meta.color} strokeWidth="1.3" />
  </>;
  return <circle cx="0" cy="0" r="7" {...common} />;
}

/** 状态=右上角角标：未探索空心，其余实心状态色 */
export function CornerBadge({ status }: { status: LearningStatus }) {
  if (status === 'unexplored') {
    return <circle cx="9" cy="-9" r="4" fill="var(--lm-surface)" stroke={STATUS_VAR.unexplored} strokeWidth="1.4" />;
  }
  return <circle cx="9" cy="-9" r="4" fill={STATUS_VAR[status]} stroke="var(--lm-surface)" strokeWidth="1.2" />;
}

/** 受阻（前置需巩固）：左上角琥珀小点 */
export function BlockedDot() {
  return <circle cx="-9" cy="-9" r="3" fill="var(--lm-status-learning)" stroke="var(--lm-surface)" strokeWidth="1" />;
}

/**
 * 地图节点图形（SVG 内复用单元）：halo + 类型图形 + 状态角标（+受阻点）。
 * 自带 <g> 定位与选中放大；onSelect 存在时可点击/键盘触发。
 */
export default function NodeGlyph({ node, x, y, selected = false, neighbor = false, onSelect }: {
  node: LearningMapNode;
  x: number;
  y: number;
  selected?: boolean;
  neighbor?: boolean;
  onSelect?: (nodeId: string) => void;
}) {
  const className = `kg-glyph${selected ? ' kg-sel' : ''}${neighbor ? ' kg-nb' : ''}`;
  const handleKey = (event: KeyboardEvent<SVGGElement>) => {
    if (!onSelect) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node.node_id); }
  };
  return <g
    className={className}
    transform={`translate(${x} ${y})${selected ? ' scale(1.35)' : ''}`}
    role={onSelect ? 'button' : undefined}
    tabIndex={onSelect ? 0 : undefined}
    aria-label={onSelect ? `${stripMath(node.name)}，${STATUS_LABEL[node.status]}` : undefined}
    onClick={onSelect ? () => onSelect(node.node_id) : undefined}
    onKeyDown={handleKey}
  >
    <title>{stripMath(node.name)}</title>
    <circle className="kg-halo" cx="0" cy="0" r="12" fill="none" stroke="var(--lm-brand)" strokeWidth="1.6" />
    <GlyphShape type={node.type} />
    <CornerBadge status={node.status} />
    {node.blocked && <BlockedDot />}
  </g>;
}
