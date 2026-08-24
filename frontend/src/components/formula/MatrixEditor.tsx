import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

import FormulaGlyph from './FormulaGlyph';

interface Props {
  rows?: number;
  cols?: number;
  onInsert: (latex: string) => void;
}

// 暴露给 FormulaComposer：符号键盘点符号时，若矩阵有聚焦格子则插到该格子
export interface MatrixEditorHandle {
  // 有聚焦格子则把 latex 追加进去并返回 true；无聚焦格子返回 false（走主编辑框）
  insertToActiveCell: (latex: string) => boolean;
}

// 把符号键盘的占位结构(#0/#?)转成矩阵格子可用的纯 LaTeX 片段：
// 格子是文本输入，占位符换成实际可编辑的形式——#0/#? 去掉花括号占位，留空让学生接着敲
function cellFragment(latex: string): string {
  return latex.replace(/#0|#\?/g, '');
}

const MatrixEditor = forwardRef<MatrixEditorHandle, Props>(function MatrixEditor({ rows = 2, cols = 2, onInsert }: Props, ref) {
  const [grid, setGrid] = useState<string[][]>(
    Array.from({ length: rows }, () => Array(cols).fill('')),
  );
  const [rowCount, setRowCount] = useState(rows);
  const [columnCount, setColumnCount] = useState(cols);
  // 行列式开关：false=矩阵(pmatrix 圆括号)，true=行列式(vmatrix 竖线 |a b|)
  const [isDeterminant, setIsDeterminant] = useState(false);
  // 当前聚焦的格子坐标（符号键盘插入目标）；null = 没聚焦任何格子
  const [activeCell, setActiveCell] = useState<{ r: number; c: number } | null>(null);
  // grid 的 ref，供 insertToActiveCell 读到最新值（避免闭包旧值）
  const gridRef = useRef(grid);
  gridRef.current = grid;

  const update = (nextRows: number, nextColumns: number, nextGrid: string[][]) => {
    setGrid(nextGrid);
    setRowCount(nextRows);
    setColumnCount(nextColumns);
  };

  const setCell = (rowIndex: number, columnIndex: number, value: string) => {
    update(rowCount, columnCount, grid.map((row, currentRow) =>
      currentRow === rowIndex
        ? row.map((cell, currentColumn) => currentColumn === columnIndex ? value : cell)
        : row,
    ));
  };

  // 符号键盘联动：有聚焦格子则把符号追加进去
  useImperativeHandle(ref, () => ({
    insertToActiveCell: (latex: string) => {
      if (!activeCell) return false;
      const { r, c } = activeCell;
      const current = gridRef.current[r]?.[c] ?? '';
      setCell(r, c, current + cellFragment(latex));
      return true;
    },
  }), [activeCell]);

  const toLatex = () => {
    const env = isDeterminant ? 'vmatrix' : 'pmatrix';
    return `\\begin{${env}}` +
      grid.map((row) => row.map((value) => value || '0').join(' & ')).join(' \\\\ ') +
      `\\end{${env}}`;
  };

  return (
    <div className="matrix-editor">
      <div className="matrix-dimensions">
        <button type="button" onClick={() => rowCount > 1 && update(rowCount - 1, columnCount, grid.slice(0, -1))} disabled={rowCount <= 1}>行−</button>
        <span>{rowCount}×{columnCount}</span>
        <button type="button" onClick={() => update(rowCount + 1, columnCount, [...grid, Array(columnCount).fill('')])}>行+</button>
        <button type="button" onClick={() => columnCount > 1 && update(rowCount, columnCount - 1, grid.map((row) => row.slice(0, -1)))} disabled={columnCount <= 1}>列−</button>
        <button type="button" onClick={() => update(rowCount, columnCount + 1, grid.map((row) => [...row, '']))}>列+</button>
      </div>
      <div className="matrix-grid">
        {grid.map((row, rowIndex) => (
          <div key={rowIndex} className="matrix-row">
            {row.map((cell, columnIndex) => (
              // 轻量版公式格子：文本输入 + 下方实时 KaTeX 预览。
              // 敲 x^2 立刻在上方看到 x² 渲染效果，不用等插入。
              <div key={columnIndex} className="matrix-cell">
                {cell.trim() && (
                  <div className="matrix-cell-preview" aria-hidden="true">
                    <FormulaGlyph latex={cell} fallback={cell} />
                  </div>
                )}
                <input value={cell} placeholder="0"
                  aria-label={`第${rowIndex + 1}行第${columnIndex + 1}列`}
                  onFocus={() => setActiveCell({ r: rowIndex, c: columnIndex })}
                  onBlur={(event) => {
                    // 点符号键盘按钮时焦点会离开格子，但不该清 activeCell（否则符号插不进格子）。
                    // 延迟一拍看新焦点：还在矩阵编辑器内（含符号键盘）就保留，去了别处才清。
                    const container = (event.target as HTMLElement).closest('.matrix-editor');
                    setTimeout(() => {
                      const active = document.activeElement;
                      const stillInside = active && (container?.contains(active) || active.closest('.formula-toolbar'));
                      if (!stillInside) {
                        setActiveCell((current) =>
                          current && current.r === rowIndex && current.c === columnIndex ? null : current);
                      }
                    }, 0);
                  }}
                  onChange={(event) => setCell(rowIndex, columnIndex, event.target.value)} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="matrix-actions">
        <button type="button" className={`matrix-det-toggle ${isDeterminant ? 'is-active' : ''}`}
          onClick={() => setIsDeterminant((v) => !v)}
          title="切换：圆括号矩阵 ↔ 竖线行列式">
          {isDeterminant ? '行列式 |·|' : '矩阵 (·)'}
        </button>
        <button type="button" className="matrix-insert" onClick={() => onInsert(toLatex())}>
          {isDeterminant ? '插入行列式' : '插入矩阵'}
        </button>
      </div>
    </div>
  );
});

export default MatrixEditor;
