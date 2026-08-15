import { useState } from 'react';

interface Props {
  rows?: number;
  cols?: number;
  onInsert: (latex: string) => void;
}

export default function MatrixEditor({ rows = 2, cols = 2, onInsert }: Props) {
  const [grid, setGrid] = useState<string[][]>(
    Array.from({ length: rows }, () => Array(cols).fill('')),
  );
  const [rowCount, setRowCount] = useState(rows);
  const [columnCount, setColumnCount] = useState(cols);

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

  const toLatex = () => '\\begin{pmatrix}' +
    grid.map((row) => row.map((value) => value || '0').join(' & ')).join(' \\\\ ') +
    '\\end{pmatrix}';

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
              <input key={columnIndex} value={cell} placeholder="0"
                aria-label={`第${rowIndex + 1}行第${columnIndex + 1}列`}
                onChange={(event) => setCell(rowIndex, columnIndex, event.target.value)} />
            ))}
          </div>
        ))}
      </div>
      <button type="button" className="matrix-insert" onClick={() => onInsert(toLatex())}>插入矩阵</button>
    </div>
  );
}
