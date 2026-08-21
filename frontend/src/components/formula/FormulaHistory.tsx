import { useEffect, useState } from 'react';

import { X } from 'lucide-react';
import { loadJSON, saveJSON } from '../../utils/storage';
import { STORAGE_KEYS } from '../../utils/storageKeys';

// P1：最近公式——自动记录每次成功插入的公式，跨会话可一键回填。
// 与收藏不同：收藏要用户显式点按钮保存，最近公式是系统悄悄记下"插过什么"。
// 数据损坏/存储不可用时静默回退，不能影响公式编辑主流程。
const HISTORY_EVENT = 'formula-history-updated';
const MAX_ITEMS = 20;

export interface HistoryFormula {
  label: string;
  latex: string;
}

function toItem(latex: string): HistoryFormula {
  return { label: latex.length > 16 ? `${latex.slice(0, 16)}…` : latex, latex };
}

function loadHistory(): HistoryFormula[] {
  const parsed = loadJSON<unknown>(STORAGE_KEYS.formulaHistory, []);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is HistoryFormula => Boolean(item) &&
      typeof item.latex === 'string' && item.latex.trim().length > 0 &&
      typeof item.label === 'string' && item.label.trim().length > 0)
    : [];
}

// 记录公式使用：去重（相同 latex 移最前）+ 上限 20 条 + 新记录在最前。
// 写入后派发自定义事件，让已挂载的 FormulaHistory 实时刷新。
// 用事件而非 lift state：历史模块自包含，FormulaComposer 只加一行调用，不膨胀行数。
export function recordFormulaUsage(latex: string): void {
  const clean = latex.trim();
  if (!clean) return;
  const next = [toItem(clean), ...loadHistory().filter((item) => item.latex !== clean)].slice(0, MAX_ITEMS);
  saveJSON(STORAGE_KEYS.formulaHistory, next);
  window.dispatchEvent(new Event(HISTORY_EVENT));
}

interface Props {
  onInsert: (latex: string) => void;
}

export default function FormulaHistory({ onInsert }: Props) {
  const [history, setHistory] = useState<HistoryFormula[]>(loadHistory);

  // 监听 recordFormulaUsage 派发的事件：同一对话框会话内连续插入也要立即显示最新，
  // 不能在挂载时只读一次快照（那样会漏掉会话中途新增的记录）
  useEffect(() => {
    const refresh = () => setHistory(loadHistory());
    window.addEventListener(HISTORY_EVENT, refresh);
    return () => window.removeEventListener(HISTORY_EVENT, refresh);
  }, []);

  const removeHistory = (index: number) => {
    const next = history.filter((_, i) => i !== index);
    saveJSON(STORAGE_KEYS.formulaHistory, next);
    setHistory(next);
  };

  // 空态隐藏整个面板，避免占位标题出现在对话框里
  if (history.length === 0) return null;

  return (
    <div className="formula-history" aria-label="最近使用">
      <span className="formula-section-label">最近使用</span>
      <div className="formula-history-list">
        {history.map((item, index) => (
          <div key={`${item.latex}-${index}`} className="formula-history-item">
            <button type="button" className="formula-history-insert" onClick={() => onInsert(item.latex)} title={item.latex}>
              {item.label}
            </button>
            <button type="button" className="formula-history-remove" onClick={() => removeHistory(index)}
              aria-label={`删除最近公式 ${item.label}`} title="删除最近公式">
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
