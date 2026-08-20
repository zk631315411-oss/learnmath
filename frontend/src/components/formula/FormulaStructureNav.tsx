import { ArrowUp, Check } from 'lucide-react';
import type { MathfieldElement } from 'mathlive';

export default function FormulaStructureNav({ field }: { field: MathfieldElement | null }) {
  if (!field) return null;
  return <div className="formula-structure-nav" aria-label="公式结构导航">
    <span className="formula-structure-label">当前结构</span>
    <button type="button" onClick={() => { try { field.executeCommand('selectGroup'); } catch { /* feature-detect */ } field.focus(); }} title="选中当前结构" aria-label="选中当前结构"><Check size={13} />选中</button>
    <button type="button" onClick={() => { try { field.executeCommand('moveAfterParent'); } catch { /* feature-detect */ } field.focus(); }} title="移到结构外" aria-label="移到结构外"><ArrowUp size={13} />结构外</button>
  </div>;
}
