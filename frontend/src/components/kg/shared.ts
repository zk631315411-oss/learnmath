import type { LearningMapNode, LearningStatus } from '../../services/api';

export const STATUS_LABEL: Record<LearningStatus, string> = {
  unexplored: '未探索',
  learning: '学习中',
  basically_mastered: '基本学过',
  mastered: '已学过',
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
  knowledgegroup: { tag: '组', label: '知识组', color: '#8b5cf6' },
  outcome: { tag: '果', label: '结果', color: '#f59e0b' },
  rulecase: { tag: '例', label: '情形', color: '#ec4899' },
  conditionexpression: { tag: '条', label: '条件', color: '#64748b' },
};

export const typeMeta = (type?: string): TypeMeta => TYPE_META[type?.toLowerCase() || 'concept'] || TYPE_META.concept;

export const isProblemType = (type?: string) => type?.toLowerCase() === 'problemclass';

/** 小节状态摘要：需巩固 > 学习中 > 未探索 > 已探索计数 > 全部学过 */
export function sectionStatusSummary(nodes: LearningMapNode[]): string {
  const explored = nodes.filter(n => n.status !== 'unexplored').length;
  const review = nodes.filter(n => n.status === 'needs_review').length;
  const learning = nodes.some(n => n.status === 'learning');
  if (review) return `${review} 个需巩固`;
  if (learning) return '学习中';
  if (explored === 0) return '未探索';
  if (explored === nodes.length) return nodes.length ? '已学过' : '已探索';
  return `${explored}/${nodes.length} 已探索`;
}

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

/** 常见 LaTeX 符号命令的纯文本替代（SVG/原生控件无法走 KaTeX 时使用） */
const LATEX_SYMBOLS: Record<string, string> = {
  '\\infty': '∞', '\\in': '∈', '\\int': '∫', '\\sum': '∑', '\\prod': '∏',
  '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\lambda': 'λ',
  '\\mu': 'μ', '\\pi': 'π', '\\sigma': 'σ', '\\phi': 'φ', '\\omega': 'ω',
  '\\dots': '…', '\\cdots': '…', '\\ln': 'ln', '\\log': 'log', '\\sin': 'sin', '\\cos': 'cos',
  '\\times': '×', '\\cdot': '·', '\\pm': '±', '\\leq': '≤', '\\geq': '≥', '\\neq': '≠',
  '\\partial': '∂', '\\subset': '⊂', '\\cup': '∪', '\\cap': '∩', '\\forall': '∀', '\\exists': '∃',
};

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵',
  '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', 'n': 'ⁿ', 'i': 'ⁱ', '-': '⁻', '+': '⁺',
};

/** SVG 文本/原生控件无法走 KaTeX，把 LaTeX 片段降级为可读纯文本（\pmb{n}→n、\frac{a}{b}→a/b、$ 与花括号去除） */
export const stripMath = (text: string) => {
  let out = String(text ?? '');
  // 数据里偶发泄漏的 Unicode 转义，如 \u2124 → ℤ
  out = out.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  // \frac{a}{b} → a/b（循环以处理嵌套）
  let prev = '';
  while (prev !== out) {
    prev = out;
    out = out.replace(/\\[a-zA-Z]+\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2');
  }
  // \pmb{n}、\mathbf{n} 等单参数格式命令 → 保留参数
  prev = '';
  while (prev !== out) {
    prev = out;
    out = out.replace(/\\[a-zA-Z]+\s*\{([^{}]*)\}/g, '$1');
  }
  // 已知符号命令替换（长的在前，避免 \in 吃掉 \infty）
  for (const cmd of Object.keys(LATEX_SYMBOLS).sort((a, b) => b.length - a.length)) {
    out = out.split(cmd).join(LATEX_SYMBOLS[cmd]);
  }
  // 上标 x^{2} / x^2 → x²；下标记号直接去掉（x_{1} → x1）
  out = out.replace(/\^\{?([^{}\s])\}?/g, (_m, ch: string) => SUPERSCRIPT[ch] ?? ch);
  out = out.replace(/_/g, '');
  // 兜底：去 $、花括号和残留反斜杠
  return out.replace(/[\$\\{}]/g, '').replace(/\s{2,}/g, ' ').trim();
};
