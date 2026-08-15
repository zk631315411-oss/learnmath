import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  CircleMinus,
  LoaderCircle,
  Network,
  XCircle,
} from 'lucide-react';
import type { KGRetrievalFocus, ToolActivity } from '../types';

interface Props {
  activities: ToolActivity[];
  active: boolean;
}

const focusLabels: Record<KGRetrievalFocus, string> = {
  prerequisites: '明确前置',
  successors: '明确后置',
  supporting: '支撑知识',
  applications: '应用扩展',
  rules: '条件规则',
  structure: '知识结构',
  overview: '综合概览',
};

const validFocus = new Set<KGRetrievalFocus>(Object.keys(focusLabels) as KGRetrievalFocus[]);

function focusValues(value: unknown): KGRetrievalFocus[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is KGRetrievalFocus => (
    typeof item === 'string' && validFocus.has(item as KGRetrievalFocus)
  ));
}

function focusText(values: KGRetrievalFocus[]): string {
  return values.map(value => focusLabels[value]).join('、');
}

function activityState(activity: ToolActivity) {
  if (activity.status === 'running') {
    return { label: '查询中', icon: LoaderCircle, color: 'text-blue-500', spin: true };
  }
  if (activity.status === 'error') {
    return { label: '查询失败', icon: XCircle, color: 'text-red-500', spin: false };
  }
  if (activity.status === 'cancelled') {
    return { label: '已取消', icon: CircleMinus, color: 'text-slate-400', spin: false };
  }
  if (activity.status === 'skipped') {
    return { label: '已跳过', icon: CircleMinus, color: 'text-amber-500', spin: false };
  }
  if (activity.result?.status === 'not_found' || activity.result?.found === false) {
    return { label: '未命中', icon: CircleMinus, color: 'text-amber-500', spin: false };
  }
  if (activity.result?.status === 'ambiguous') {
    return { label: '待消歧', icon: CircleMinus, color: 'text-amber-500', spin: false };
  }
  return { label: '已命中', icon: CheckCircle2, color: 'text-emerald-600', spin: false };
}

function queryText(activity: ToolActivity): string {
  const value = activity.arguments?.query ?? activity.arguments?.concept_name;
  return typeof value === 'string' && value.trim() ? value.trim() : '相关知识点';
}

function NodeNames({ label, nodes }: { label: string; nodes?: Array<{ name?: string }> }) {
  const names = (nodes || []).map(node => node.name).filter(Boolean);
  if (!names.length) return null;
  return (
    <div>
      <span className="text-slate-400">{label}：</span>
      <span className="break-words text-slate-600">{names.join('、')}</span>
    </div>
  );
}

export default function AgentActivity({ activities, active }: Props) {
  const [expanded, setExpanded] = useState(active);
  const wasActive = useRef(active);

  useEffect(() => {
    if (active) setExpanded(true);
    else if (wasActive.current) setExpanded(false);
    wasActive.current = active;
  }, [active]);

  if (!activities.length) return null;

  const running = activities.some(activity => activity.status === 'running');
  const hitCount = activities.filter(activity => (
    activity.status === 'success'
    && (activity.result?.status === 'resolved' || activity.result?.found === true)
  )).length;
  const summary = running
    ? '正在使用知识图谱'
    : `知识图谱 · ${hitCount}/${activities.length} 次命中`;

  return (
    <div className="mb-3 border-b border-slate-200 pb-3">
      <button
        type="button"
        onClick={() => setExpanded(value => !value)}
        className="flex w-full items-center gap-2 text-left text-xs font-medium text-slate-600 hover:text-slate-800"
        aria-expanded={expanded}
      >
        <Network className={`h-4 w-4 shrink-0 ${running ? 'animate-pulse text-blue-500' : 'text-emerald-600'}`} />
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="mt-2 border-l-2 border-emerald-200 pl-3">
          {activities.map((activity, index) => {
            const state = activityState(activity);
            const StatusIcon = state.icon;
            const result = activity.result;
            const requestedFocus = result?.requested_focus?.length
              ? result.requested_focus
              : focusValues(activity.arguments?.focus);
            const emptyFocus = result?.empty_focus || [];
            const truncatedFocus = Object.entries(result?.focus_stats || {})
              .filter(([, stat]) => stat?.truncated)
              .map(([focus]) => focus as KGRetrievalFocus)
              .filter(focus => validFocus.has(focus));
            return (
              <div
                key={activity.id}
                className={index ? 'border-t border-slate-100 py-2' : 'pb-2'}
              >
                <div className="flex min-h-5 items-start gap-2 text-xs">
                  <StatusIcon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${state.color} ${state.spin ? 'animate-spin' : ''}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="font-medium text-slate-700">查询“{queryText(activity)}”</span>
                      <span className={state.color}>{state.label}</span>
                    </div>
                    {!!requestedFocus.length && (
                      <div className="mt-1 text-slate-400">检索方向：{focusText(requestedFocus)}</div>
                    )}
                    {activity.status === 'running' && (
                      <div className="mt-1 text-slate-400">正在检索对应方向的节点与教材依据...</div>
                    )}
                    {activity.status === 'success' && (result?.status === 'resolved' || result?.found) && (
                      <div className="mt-1 space-y-1 leading-5">
                        <div>
                          <span className="text-slate-400">命中：</span>
                          <span className="text-slate-600">{result.selected_node?.name || result.node?.name || queryText(activity)}</span>
                        </div>
                        <NodeNames label="明确前置" nodes={result.relationships?.explicit_prerequisites || result.support_nodes} />
                        <NodeNames label="明确后置" nodes={result.relationships?.explicit_successors} />
                        <NodeNames label="支撑知识" nodes={result.relationships?.supporting_knowledge} />
                        <NodeNames label="应用扩展" nodes={result.relationships?.applications_and_extensions || result.lookahead_nodes} />
                        <NodeNames label="知识结构" nodes={result.relationships?.structural_context} />
                        {!!result.rule_case_count && (
                          <div className="text-slate-500">条件规则：{result.rule_case_count} 条</div>
                        )}
                        {!!emptyFocus.length && (
                          <div className="text-amber-600">无结果方向：{focusText(emptyFocus)}</div>
                        )}
                        {!!truncatedFocus.length && (
                          <div className="text-amber-600">结果已截断：{focusText(truncatedFocus)}</div>
                        )}
                        {(result.selected_node?.source_code || result.node?.source_code) && (
                          <div>
                            <span className="text-slate-400">来源：</span>
                            <span className="text-slate-600">{result.selected_node?.source_code || result.node?.source_code}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {activity.status === 'success' && result?.status === 'ambiguous' && (
                      <div className="mt-1 text-slate-500">
                        候选：{(result.candidates || []).map(item => item.name).filter(Boolean).join('、') || '需要进一步确认'}
                      </div>
                    )}
                    {activity.status === 'success' && (result?.status === 'not_found' || result?.found === false) && (
                      <div className="mt-1 text-slate-400">{result.message || '知识图谱中暂无对应节点'}</div>
                    )}
                    {activity.status === 'error' && (
                      <div className="mt-1 text-red-500">{activity.error_message || '工具执行失败'}</div>
                    )}
                    {activity.duration_ms != null && activity.status !== 'running' && (
                      <div className="mt-1 text-[11px] text-slate-400">耗时 {activity.duration_ms} ms</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
