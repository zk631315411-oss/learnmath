import type { LearningStatus } from '../../services/api';

export const STATUS_LABEL: Record<LearningStatus, string> = {
  unexplored: '未探索',
  learning: '学习中',
  basically_mastered: '基本掌握',
  mastered: '已掌握',
  needs_review: '需要巩固',
};

export const STATUS_VAR: Record<LearningStatus, string> = {
  unexplored: 'var(--lm-status-unexplored)',
  learning: 'var(--lm-status-learning)',
  basically_mastered: 'var(--lm-status-basic)',
  mastered: 'var(--lm-status-mastered)',
  needs_review: 'var(--lm-status-review)',
};

export const STATUS_ORDER: LearningStatus[] = ['unexplored', 'learning', 'basically_mastered', 'mastered', 'needs_review'];

export interface TypeMeta { tag: string; label: string; color: string }

export const TYPE_META: Record<string, TypeMeta> = {
  concept: { tag: '概', label: '概念', color: 'var(--lm-type-concept)' },
  theorem: { tag: '定', label: '定理', color: 'var(--lm-type-theorem)' },
  formula: { tag: '公', label: '公式', color: 'var(--lm-type-formula)' },
  method: { tag: '方', label: '方法', color: 'var(--lm-type-method)' },
  problemclass: { tag: '题', label: '题型', color: 'var(--lm-type-problem)' },
};

export const typeMeta = (type?: string): TypeMeta => TYPE_META[type?.toLowerCase() || 'concept'] || TYPE_META.concept;

export const isProblemType = (type?: string) => type?.toLowerCase() === 'problemclass';

/** 关系词（REL_CN）：出边读作「本节点 {词} 目标」，入边读作「来源 {词} 本节点」 */
export const REL_CN: Record<string, string> = {
  USES: '使用',
  DERIVES: '推导出',
  GETS: '得到',
  HAS_PROPERTY: '具有性质',
  SUPERIOR: '上位于',
  PART_OF: '组成于',
  EQUATIVE: '并列于',
  PREREQUISITE_OF: '前置于',
};

export const relLabel = (type: string) => REL_CN[type] || type;

/** 小节序号前缀，如 "1.12 xxx" → "1.12"；取不到则回退前 3 字符 */
export const sectionTag = (section: string) => section.match(/^\d+(?:\.\d+)?/)?.[0] ?? section.slice(0, 3);

/** SVG 文本无法走 KaTeX，去掉 $ 符号保留可读纯文本 */
export const stripMath = (text: string) => text.replace(/\$/g, '');
