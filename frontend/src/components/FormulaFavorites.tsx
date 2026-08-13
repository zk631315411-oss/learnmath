import { useState } from 'react';

import { Star, X } from 'lucide-react';

// P1：本地收藏——把当前 MathField 里的公式存入 localStorage，跨会话可再次插入。
// 收藏数据是纯前端体验，损坏/不可用时静默回退，不能影响公式编辑主流程。
const STORAGE_KEY = 'formula_favorites';

export interface FavoriteFormula {
  label: string;
  latex: string;
}

function loadFavorites(): FavoriteFormula[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? // label 必须非空：损坏数据缺 label 或 label 为空串都会渲染出空标签按钮，直接过滤
        parsed.filter((item) => typeof item?.latex === 'string' && typeof item?.label === 'string' && item.label.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function saveFavorites(items: FavoriteFormula[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // 隐私模式或存储已满时静默失败，收藏只是增强功能
  }
}

interface Props {
  currentLatex: string;
  onInsert: (latex: string) => void;
}

export default function FormulaFavorites({ currentLatex, onInsert }: Props) {
  const [favorites, setFavorites] = useState<FavoriteFormula[]>(loadFavorites);
  // 用计数而非布尔：重复收藏时递增触发提示重新渲染，避免提示"粘住"上一次状态
  const [savedTip, setSavedTip] = useState(0);

  const canSave = currentLatex.trim().length > 0;

  // 已存在的公式不重复收藏，避免列表越长越难用
  const saveCurrent = () => {
    const latex = currentLatex.trim();
    if (!latex || favorites.some((item) => item.latex === latex)) return;
    const next = [
      ...favorites,
      { label: latex.length > 16 ? `${latex.slice(0, 16)}…` : latex, latex },
    ];
    saveFavorites(next);
    setFavorites(next);
    setSavedTip((count) => count + 1);
  };

  const removeFavorite = (index: number) => {
    const next = favorites.filter((_, i) => i !== index);
    saveFavorites(next);
    setFavorites(next);
  };

  return (
    <div className="formula-favorites">
      <div className="formula-favorites-head">
        <button type="button" className="formula-save-favorite" disabled={!canSave}
          onClick={saveCurrent} title="收藏当前公式">
          <Star size={14} />收藏当前公式
        </button>
        {/* key 随计数变化强制重建节点，让每次收藏的提示都重新出现 */}
        {savedTip > 0 && <span key={savedTip} className="formula-saved-tip">已收藏</span>}
      </div>
      {favorites.length > 0 && (
        <div className="formula-favorites-list" aria-label="我的收藏">
          {favorites.map((item, index) => (
            <div key={`${item.latex}-${index}`} className="formula-favorite-item">
              <button type="button" className="formula-favorite-insert" onClick={() => onInsert(item.latex)} title={item.latex}>
                {item.label}
              </button>
              <button type="button" className="formula-favorite-remove" onClick={() => removeFavorite(index)}
                aria-label={`删除收藏 ${item.label}`} title="删除收藏">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
