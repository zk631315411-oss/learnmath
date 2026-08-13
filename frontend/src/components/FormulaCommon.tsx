// P1：常用公式预置区。
// 与工具栏模板不同：工具栏是「符号拼装」型（glyph + 短模板），
// 这里是一键插入完整的高频公式骨架，点击后进入 MathField 的占位符选择模式，
// 用户逐个跳转占位符补全，不用手动拼 LaTeX。
interface Props {
  onInsert: (latex: string) => void;
}

const commonFormulas = [
  { label: '极限', latex: '\\lim_{x \\to 0} \\frac{f(x)}{g(x)}' },
  { label: '积分', latex: '\\int_{a}^{b} f(x) \\, dx' },
  { label: '求和', latex: '\\sum_{i=1}^{n} a_i' },
  { label: '矩阵', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
  { label: '分数', latex: '\\frac{#0}{#?}' },
  { label: '根式', latex: '\\sqrt{#0}' },
  { label: '分段函数', latex: '\\begin{cases} #0 & \\text{if } #1 \\\\ #? & \\text{otherwise} \\end{cases}' },
  { label: '导数', latex: '\\frac{d}{dx} f(x)' },
  { label: '向量点积', latex: '\\vec{a} \\cdot \\vec{b}' },
  { label: '行列式', latex: '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}' },
];

export default function FormulaCommon({ onInsert }: Props) {
  return (
    <div className="formula-common" aria-label="常用公式">
      <span className="formula-section-label">常用公式</span>
      <div className="formula-common-list">
        {commonFormulas.map((item) => (
          <button key={item.label} type="button" onClick={() => onInsert(item.latex)} title={item.latex}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
