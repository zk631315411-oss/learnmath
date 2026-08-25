import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';
import type { SelectionBookmark } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Mathematics } from '@tiptap/extension-mathematics';
import { MathfieldElement } from 'mathlive';
import { Calculator, ChevronDown, Grid3X3, LoaderCircle, PenLine, Plus, Redo2, Sigma, Undo2, X } from 'lucide-react';

import MathLiveInput from './MathLiveInput';
import FormulaCommon from './FormulaCommon';
import FormulaFavorites from './FormulaFavorites';
import FormulaGlyph from './FormulaGlyph';
import FormulaHistory, { recordFormulaUsage } from './FormulaHistory';
import FormulaMathField from './FormulaMathField';
import MatrixEditor, { type MatrixEditorHandle } from './MatrixEditor';
import HandwritingCanvas from './HandwritingCanvas';
import { convertFormula, recognizeFormula } from '../../services/api';
import { errorMessage } from '../../utils/errorMessage';
import type { RecognizedBlock } from '../../types';
import { insertRecognizedBlocks } from './recognizedBlocks';

type DisplayChoice = 'auto' | 'inline' | 'block';
type FormulaNode = { pos: number; type: 'inline' | 'block' } | null;

interface Props {
  value: string;
  onChange: (value: string) => void;
  token?: string;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  onSubmit?: () => void;
  externalFormula?: ExternalFormulaDraft | null;
  onExternalFormulaConsumed?: (nonce: string) => void;
  externalContent?: { blocks: RecognizedBlock[]; nonce: string } | null;
  onExternalContentConsumed?: (nonce: string) => void;
  /** 识别出的多个公式：弹窗顶部显示一次性队列，逐个编辑插入（含单个，交互统一）。 */
  externalFormulaQueue?: { formulas: { latex: string; displayMode: 'inline' | 'block' }[]; nonce: string } | null;
  onExternalFormulaQueueConsumed?: (nonce: string) => void;
  leadingActions?: ReactNode;
  trailingActions?: ReactNode;
}

export interface FormulaComposerHandle { captureInsertionBookmark: () => void; }

export type ExternalFormulaDraft = { latex: string; displayMode: 'inline' | 'block'; nonce: string };

// 符号带：只放系统键盘/输入法打不出来的数学结构与大算符。
// 设计：数字、英文字母、加减乘除（+ - × ÷ =）一律不上带——这些系统键盘秒打。
// 每个键 = 一个 KaTeX 小图标(glyph) + 汉字标签(label)，学生不靠猜。
// 长按某个键滑动 → 浮出同类候选(variants)，收编偏导、希腊字母、逻辑符号等，不占主带。
// value 里 #0 是当前选区包裹、#? 是可点占位框（详见 insertTemplate 注释）。
interface SymbolKey {
  label: string;      // 汉字标签（显示在图标下方）
  value: string;      // 插入的 LaTeX（含 #0/#? 占位）
  glyph: string;      // KaTeX 渲染的小图标
  variants?: { label: string; value: string; glyph: string }[];  // 长按候选
}

const templates: SymbolKey[] = [
  // 运算符：× ÷ 在系统键盘上难打，+ − = 虽能敲但点一下更顺手
  { label: '加', value: '+', glyph: '+' },
  { label: '减', value: '-', glyph: '-' },
  { label: '乘', value: '\\times', glyph: '\\times',
    variants: [{ label: '点乘', value: '\\cdot', glyph: '\\cdot' }, { label: '叉乘', value: '\\otimes', glyph: '\\otimes' }] },
  { label: '除', value: '\\div', glyph: '\\div' },
  { label: '等于', value: '=', glyph: '=' },
  { label: '分数', value: '\\frac{#0}{#?}', glyph: '\\frac{a}{b}' },
  { label: '根号', value: '\\sqrt{#0}', glyph: '\\sqrt{x}',
    variants: [{ label: 'n次根', value: '\\sqrt[#0]{#?}', glyph: '\\sqrt[n]{x}' }] },
  { label: '上标', value: '^{#0}', glyph: 'x^{2}' },
  { label: '下标', value: '_{#0}', glyph: 'x_{i}' },
  { label: '积分', value: '\\int_{#0}^{#?}', glyph: '\\int_{a}^{b}',
    variants: [
      { label: '不定积分', value: '\\int #0', glyph: '\\int' },
      { label: '环路积分', value: '\\oint_{#0}^{#?}', glyph: '\\oint' },
      { label: '二重积分', value: '\\iint_{#0}^{#?}', glyph: '\\iint' },
    ] },
  { label: '求和', value: '\\sum_{#0}^{#?}', glyph: '\\sum_{i=1}^{n}',
    variants: [{ label: '连乘', value: '\\prod_{#0}^{#?}', glyph: '\\prod_{i=1}^{n}' }] },
  { label: '极限', value: '\\lim_{#0 \\to #?}', glyph: '\\lim_{x \\to 0}' },
  { label: '偏导', value: '\\frac{\\partial #0}{\\partial #?}', glyph: '\\frac{\\partial f}{\\partial x}',
    variants: [
      { label: '导数', value: '\\frac{d#0}{d#?}', glyph: '\\frac{dy}{dx}' },
      { label: "导数'", value: "f'(#0)", glyph: "f'(x)" },
    ] },
  // 向量家族：只收真正的"向量"变体（箭头/单位向量/对时间求导的点）。
  // glyph 用 \overrightarrow 替代 \vec——KaTeX 的 \vec 箭头在小字号下太淡看不清，
  // \overrightarrow 是完整箭头，48px 键面里清晰可辨。
  // \bar（平均值）已删：太小众且 x̄ 的横线在小字号下认不出是"平均值"，只会造成困惑。
  { label: '向量', value: '\\vec{#0}', glyph: '\\overrightarrow{a}',
    variants: [
      { label: '单位向量', value: '\\hat{#0}', glyph: '\\hat{a}' },
      { label: '速度(点)', value: '\\dot{#0}', glyph: '\\dot{v}' },
    ] },
  { label: '无穷', value: '\\infty', glyph: '\\infty',
    variants: [
      { label: '正无穷', value: '+\\infty', glyph: '+\\infty' },
      { label: '负无穷', value: '-\\infty', glyph: '-\\infty' },
    ] },
];

// 长按"希腊/逻辑"类键时浮出的候选（收进希腊字母与逻辑符号，不占主带）
const greekLogicKey: SymbolKey = {
  label: '希腊', value: '\\alpha', glyph: '\\alpha',
  variants: [
    { label: 'α', value: '\\alpha', glyph: '\\alpha' }, { label: 'β', value: '\\beta', glyph: '\\beta' },
    { label: 'γ', value: '\\gamma', glyph: '\\gamma' }, { label: 'θ', value: '\\theta', glyph: '\\theta' },
    { label: 'λ', value: '\\lambda', glyph: '\\lambda' }, { label: 'π', value: '\\pi', glyph: '\\pi' },
    { label: 'Δ', value: '\\Delta', glyph: '\\Delta' }, { label: 'Σ', value: '\\Sigma', glyph: '\\Sigma' },
  ],
};
const logicKey: SymbolKey = {
  label: '逻辑', value: '\\in', glyph: '\\in',
  variants: [
    { label: '属于', value: '\\in', glyph: '\\in' }, { label: '不属于', value: '\\notin', glyph: '\\notin' },
    { label: '包含', value: '\\subset', glyph: '\\subset' }, { label: '交', value: '\\cap', glyph: '\\cap' },
    { label: '并', value: '\\cup', glyph: '\\cup' }, { label: '推出', value: '\\Rightarrow', glyph: '\\Rightarrow' },
    { label: '等价', value: '\\Leftrightarrow', glyph: '\\Leftrightarrow' }, { label: '任意', value: '\\forall', glyph: '\\forall' },
    { label: '存在', value: '\\exists', glyph: '\\exists' }, { label: '≠', value: '\\neq', glyph: '\\neq' },
    { label: '≤', value: '\\leq', glyph: '\\leq' }, { label: '≥', value: '\\geq', glyph: '\\geq' },
    { label: '±', value: '\\pm', glyph: '\\pm' }, { label: '→', value: '\\to', glyph: '\\to' },
  ],
};

// P2：描述转写示例，点击后自动填入并触发转换
const CONVERT_EXAMPLE = 'x趋于0时（sin x）的平方除以x';

// 单个符号键：点击插入主符号，长按浮出候选条、滑动选中。
// 仿手机输入法"长按出候选"：按住 400ms 弹出候选条，手指/鼠标在候选上滑动高亮，松开即插入。
function SymbolKeyButton({ item, onInsert }: { item: SymbolKey; onInsert: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [shiftX, setShiftX] = useState(0);  // 候选条水平钳制偏移（防溢出弹窗）
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  const candidates = item.variants ?? [];

  const clearTimer = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };

  // 候选条打开后钳制水平位置：默认相对键居中，但若会溢出弹窗左右边界则向内收。
  // 纯 CSS 做不到"既相对键定位又不超出弹窗"（CSS 不知弹窗边界），故用 JS 测量。
  useLayoutEffect(() => {
    if (!open || !barRef.current) return;
    const bar = barRef.current;
    const dialog = bar.closest('.formula-dialog');
    if (!dialog) return;
    // 先复位 transform 到居中（直接改 style，绕开 setState 的异步，确保量到的是居中位置）
    bar.style.transform = 'translateX(-50%)';
    const r = bar.getBoundingClientRect();
    const d = dialog.getBoundingClientRect();
    const pad = 8;
    let shift = 0;
    if (r.right > d.right - pad) shift = (d.right - pad) - r.right;
    else if (r.left < d.left + pad) shift = (d.left + pad) - r.left;
    setShiftX(shift);
  }, [open]);

  const startPress = () => {
    longPressed.current = false;
    if (candidates.length === 0) return;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setActiveIdx(-1);
      setOpen(true);
    }, 400);
  };

  // 滑动选择：根据指针 x 坐标落在哪个候选上
  const movePress = (clientX: number, clientY: number) => {
    if (!open || !barRef.current) return;
    const kids = Array.from(barRef.current.children) as HTMLElement[];
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top - 20 && clientY <= r.bottom + 20) {
        setActiveIdx(i);
        return;
      }
    }
  };

  const endPress = (clientX?: number, clientY?: number) => {
    clearTimer();
    if (open) {
      // 松开时若有高亮候选则插入候选，否则关闭不插入
      if (activeIdx >= 0 && candidates[activeIdx]) onInsert(candidates[activeIdx].value);
      setOpen(false);
      setActiveIdx(-1);
    } else if (!longPressed.current) {
      // 短按：插入主符号
      onInsert(item.value);
    }
    longPressed.current = false;
  };

  return (
    <span className="symbol-key-wrap">
      {open && candidates.length > 0 && (
        <span className="symbol-variants" ref={barRef} role="listbox" aria-label={`${item.label}候选`}
          style={{ transform: `translateX(calc(-50% + ${shiftX}px))` }}>
          {candidates.map((c, i) => (
            <span key={c.label} className={`symbol-variant ${i === activeIdx ? 'is-active' : ''}`}>
              <FormulaGlyph latex={c.glyph} fallback={c.label} />
              <span className="symbol-variant-label">{c.label}</span>
            </span>
          ))}
        </span>
      )}
      <button
        type="button"
        className="symbol-key"
        title={item.label}
        aria-label={item.label}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); startPress(); }}
        onPointerMove={(e) => movePress(e.clientX, e.clientY)}
        onPointerUp={(e) => endPress(e.clientX, e.clientY)}
        onPointerCancel={() => { clearTimer(); setOpen(false); setActiveIdx(-1); longPressed.current = false; }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* 手机键盘式：主符号居中大字号（Q/W/E），右上角贴第一个候选的小符号当角标
            （Q 上的小数字）——提示"这键长按/滑动能出别的"，同时仍看得懂 */}
        {candidates.length > 0 && (
          <span className="symbol-key-corner" aria-hidden="true">
            <FormulaGlyph latex={candidates[0].glyph} fallback={candidates[0].label} />
          </span>
        )}
        <span className="symbol-key-glyph"><FormulaGlyph latex={item.glyph} fallback={item.label} /></span>
      </button>
    </span>
  );
}

const FormulaComposer = forwardRef<FormulaComposerHandle, Props>(function FormulaComposer({
  value, onChange, token, placeholder = '输入文字，或插入数学公式…', disabled, compact, onSubmit,
  externalFormula, onExternalFormulaConsumed, externalContent, onExternalContentConsumed,
  externalFormulaQueue, onExternalFormulaQueueConsumed,
  leadingActions, trailingActions,
}: Props, ref) {
  const [dialogOpen, setDialogOpen] = useState(false);
  // 识别公式队列：一次性的，逐个编辑插入，不写永久历史
  const [queue, setQueue] = useState<{ latex: string; displayMode: 'inline' | 'block' }[] | null>(null);
  const [queueIndex, setQueueIndex] = useState(0);
  const [queueDone, setQueueDone] = useState<boolean[]>([]);
  const [description, setDescription] = useState('');
  const [latex, setLatex] = useState('');
  const [displayChoice, setDisplayChoice] = useState<DisplayChoice>('block');
  const [resolvedDisplay, setResolvedDisplay] = useState<'inline' | 'block'>('block');
  const [editingNode, setEditingNode] = useState<FormulaNode>(null);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState('');
  const [showMatrix, setShowMatrix] = useState(false);
  const [showExample, setShowExample] = useState(true);
  const [showHandwriting, setShowHandwriting] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const mathFieldRef = useRef<MathfieldElement | null>(null);
  const conversionRequestRef = useRef(0);
  const submitRef = useRef(onSubmit);
  const consumedNonceRef = useRef<string | null>(null);
  const consumedQueueNonceRef = useRef<string | null>(null);
  const insertionBookmarkRef = useRef<SelectionBookmark | null>(null);
  const matrixEditorRef = useRef<MatrixEditorHandle | null>(null);
  // 标记"当前占位符选中态是不是上一次 insertTemplate 留下的"。
  // true=刚由符号带插入（下次点符号键应平级追加到末尾）；
  // 用户一旦主动点击/输入（pointerdown/beforeinput），标记清零 → 点符号键时嵌进所点空框。
  const justInsertedRef = useRef(false);
  submitRef.current = onSubmit;

  const invalidateConversion = () => {
    conversionRequestRef.current += 1;
    setConverting(false);
  };

  const closeDialog = () => {
    invalidateConversion();
    setDialogOpen(false);
  };

  const openNodeEditor = (nodeLatex: string, pos: number, type: 'inline' | 'block') => {
    invalidateConversion();
    setEditingNode({ pos, type });
    setLatex(nodeLatex);
    setDescription('');
    setDisplayChoice(type);
    setResolvedDisplay(type);
    setError('');
    setDialogOpen(true);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, blockquote: false, codeBlock: false }),
      Markdown,
      // P0：单 $ 实时识别，放在 Mathematics 之前，让单行 $…$ 优先命中本规则
      MathLiveInput,
      Mathematics.configure({
        katexOptions: { throwOnError: false },
        inlineOptions: { onClick: (node, pos) => openNodeEditor(node.attrs.latex, pos, 'inline') },
        blockOptions: { onClick: (node, pos) => openNodeEditor(node.attrs.latex, pos, 'block') },
      }),
    ],
    content: value,
    contentType: 'markdown',
    editable: !disabled,
    editorProps: {
      attributes: {
        class: `formula-prosemirror ${compact ? 'is-compact' : ''}`,
        role: 'textbox',
        'aria-label': placeholder,
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && submitRef.current) {
          event.preventDefault();
          submitRef.current();
          view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getMarkdown()),
    onTransaction: ({ transaction }) => {
      if (insertionBookmarkRef.current) insertionBookmarkRef.current = insertionBookmarkRef.current.map(transaction.mapping);
    },
  }, []);

  useImperativeHandle(ref, () => ({
    captureInsertionBookmark: () => { if (editor) insertionBookmarkRef.current = editor.state.selection.getBookmark(); },
  }), [editor]);

  useEffect(() => { editor?.setEditable(!disabled); }, [disabled, editor]);
  useEffect(() => {
    if (!editor || editor.getMarkdown() === value) return;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);

  const openNewFormula = () => {
    invalidateConversion();
    setEditingNode(null);
    setDescription('');
    setLatex('');
    // 显示方式固定独立(block)：去掉三选一后，新建公式默认独立一行展示
    setDisplayChoice('block');
    setResolvedDisplay('block');
    setError('');
    setShowMatrix(false);
    setShowExample(true);
    setShowHandwriting(false);
    setDialogOpen(true);
  };

  useEffect(() => {
    if (!externalFormula || consumedNonceRef.current === externalFormula.nonce) return;
    consumedNonceRef.current = externalFormula.nonce;
    invalidateConversion();
    setEditingNode(null);
    setDescription('');
    setLatex(externalFormula.latex);
    setDisplayChoice(externalFormula.displayMode);
    setResolvedDisplay(externalFormula.displayMode);
    setError('');
    setDialogOpen(true);
    onExternalFormulaConsumed?.(externalFormula.nonce);
  }, [externalFormula, onExternalFormulaConsumed]);

  // 识别公式队列：出现新队列时初始化（当前第 1 个），弹公式编辑器
  useEffect(() => {
    if (!externalFormulaQueue || externalFormulaQueue.formulas.length === 0) return;
    if (consumedQueueNonceRef.current === externalFormulaQueue.nonce) return;
    consumedQueueNonceRef.current = externalFormulaQueue.nonce;
    invalidateConversion();
    const fs = externalFormulaQueue.formulas;
    setQueue(fs);
    setQueueIndex(0);
    setQueueDone(new Array(fs.length).fill(false));
    setEditingNode(null);
    setDescription('');
    setLatex(fs[0].latex);
    setDisplayChoice(fs[0].displayMode);
    setResolvedDisplay(fs[0].displayMode);
    setError('');
    setDialogOpen(true);
  }, [externalFormulaQueue]);

  useEffect(() => {
    if (!editor || !externalContent || consumedNonceRef.current === externalContent.nonce) return;
    if (insertRecognizedBlocks(editor, externalContent.blocks, insertionBookmarkRef.current)) {
      consumedNonceRef.current = externalContent.nonce;
      insertionBookmarkRef.current = null;
      onExternalContentConsumed?.(externalContent.nonce);
    }
  }, [editor, externalContent, onExternalContentConsumed]);

  // overrideDescription 用于示例点击：此时 setDescription 尚未生效，直接传入目标文案
  const handleConvert = async (overrideDescription?: string) => {
    const text = (overrideDescription ?? description).trim();
    if (!text || converting) return;
    const requestId = ++conversionRequestRef.current;
    setConverting(true);
    setError('');
    try {
      const result = await convertFormula(text, displayChoice, token);
      if (requestId !== conversionRequestRef.current) return;
      setLatex(result.latex);
      setResolvedDisplay(result.display_mode);
    } catch (conversionError) {
      if (requestId !== conversionRequestRef.current) return;
      setError(errorMessage(conversionError, '转换服务暂时不可用，请手动输入公式'));
    } finally {
      if (requestId === conversionRequestRef.current) setConverting(false);
    }
  };

  const insertTemplate = (template: string) => {
    // 矩阵联动（用户反馈）：矩阵编辑器开着且某个格子聚焦时，符号键盘的符号
    // 优先插进那个格子，而不是主编辑框——这样矩阵里也能用 x²/√/∫ 等结构符号。
    // 但矩阵自身的"插入矩阵"按钮会把整段 pmatrix latex 传进来，那段很长且含
    // \begin{pmatrix}，不应进格子——用 \begin 判断跳过。
    if (showMatrix && !template.includes('\\begin{') && matrixEditorRef.current?.insertToActiveCell(template)) {
      return;
    }
    const field = mathFieldRef.current;
    if (!field) return;
    // 嵌套控制（叠层 bug 修复 + 根号套极限需求）：
    // - 叠层根因（子代理定位）：上次 insert 后选区停在占位符上且非折叠，再 insert 会
    //   替换该占位符 → 越嵌越深（√{lim_{∫…}}）。
    // - 但"根号里放极限"是合理需求：用户**主动点某个空框**后，应允许嵌进去。
    // 区分靠 justInsertedRef：符号带插入后设 true；用户主动点击/输入时清零。
    // 仅当"标记还在 且 选区非折叠"（=上次符号带插入留下的状态、用户没点过别处）
    // 才跳末尾平级追加；否则保留当前位置（主动点进空框→嵌套；手动输入→光标处）。
    if (justInsertedRef.current && !field.selectionIsCollapsed) {
      field.executeCommand('moveToMathfieldEnd');
    }
    // MathLive 的 #0 会被替换成当前选区内容：选区为空时变成空串，产生零宽度空组
    // （光标进不去、鼠标点不中——体验报告的 vec bug 根因）。空选区改用 #? 占位符填空；
    // 有选区时保留 #0，选区内容被包进结构（先写内容后画线的包裹式输入）。
    const effective = field.selectionIsCollapsed ? template.replace(/#0/g, '#?') : template;
    field.insert(effective, { mode: 'math', selectionMode: 'placeholder' });
    justInsertedRef.current = true;
    // Button click completes after this handler and would otherwise reclaim focus.
    requestAnimationFrame(() => field.focus());
  };

  // 用户主动交互（点击空框/键盘输入）时清掉"刚插入"标记 → 下次点符号键嵌进所点位置。
  // 轮询挂载：math-field 由 FormulaMathField 异步创建，dialog 打开后短暂延迟才就绪，
  // 故每 200ms 检查一次直到挂上；removeEventListener 保证不重复绑定。
  useEffect(() => {
    if (!dialogOpen) return;
    const clearMark = () => { justInsertedRef.current = false; };
    let bound: MathfieldElement | null = null;
    const tryBind = () => {
      const field = mathFieldRef.current;
      if (field && field !== bound) {
        bound = field;
        field.addEventListener('pointerdown', clearMark);
        field.addEventListener('beforeinput', clearMark);
      }
    };
    tryBind();
    const timer = setInterval(tryBind, 200);
    return () => {
      clearInterval(timer);
      if (bound) {
        bound.removeEventListener('pointerdown', clearMark);
        bound.removeEventListener('beforeinput', clearMark);
      }
    };
  }, [dialogOpen]);

  // Escape 关闭弹窗
  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeDialog(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen]);

  const recognizeHandwriting = async (dataUrl: string) => {
    setError('');
    try {
      const result = await recognizeFormula(dataUrl, token);
      setLatex(result.latex); setResolvedDisplay(result.display_mode);
    } catch (recognitionError) {
      setError(errorMessage(recognitionError, '手写识别失败，请重试'));
    }
  };

  const insertFormula = () => {
    const cleanLatex = latex.trim();
    if (!editor || !cleanLatex) return;
    const mode = displayChoice === 'auto' ? resolvedDisplay : displayChoice;
    const type = mode === 'block' ? 'blockMath' : 'inlineMath';
    let inserted = false;
    if (editingNode) {
      // 编辑已有节点：先确认原节点仍在文档中，节点已不存在则放弃插入（不执行也不记录）
      const oldNode = editor.state.doc.nodeAt(editingNode.pos);
      if (oldNode) {
        inserted = editor.commands.insertContentAt({ from: editingNode.pos, to: editingNode.pos + oldNode.nodeSize }, { type, attrs: { latex: cleanLatex } });
      }
    } else if (mode === 'block') {
      inserted = editor.chain().focus().insertBlockMath({ latex: cleanLatex }).run();
    } else {
      inserted = editor.chain().focus().insertInlineMath({ latex: cleanLatex }).run();
    }
    // 仅当命令返回 true（文档确实被修改）才记入最近公式，插入失败不污染历史
    // 识别队列是一次性的（已有 OCR 来源），不写永久历史
    if (inserted && !queue) recordFormulaUsage(cleanLatex);

    // 队列模式：插入当前项 → 标记完成 → 切到下一个未完成项；全部完成才关窗并消耗队列
    if (queue) {
      if (inserted) {
        const newDone = queueDone.slice();
        newDone[queueIndex] = true;
        setQueueDone(newDone);
        const nextIdx = queue.findIndex((_, i) => !newDone[i]);
        if (nextIdx >= 0) {
          setQueueIndex(nextIdx);
          setLatex(queue[nextIdx].latex);
          setDisplayChoice(queue[nextIdx].displayMode);
          setResolvedDisplay(queue[nextIdx].displayMode);
          return; // 不关窗，继续编辑下一个
        }
        // 全部插入完成 → 消耗队列并关窗
        if (externalFormulaQueue) onExternalFormulaQueueConsumed?.(externalFormulaQueue.nonce);
        setQueue(null);
        setQueueDone([]);
        setQueueIndex(0);
        closeDialog();
        setEditingNode(null);
        return;
      }
      return; // 插入失败：停留当前项不关窗
    }

    closeDialog();
    setEditingNode(null);
  };

  return (
    <div className="formula-composer relative">
      <div className="formula-editor-shell">
        <div className="relative min-w-0 flex-1">
          {!value && <span className="formula-placeholder">{placeholder}</span>}
          <EditorContent editor={editor} />
        </div>
      </div>
      {/* 编辑工具独立于文本区域，避免在窄侧栏里挤压学生正在输入的内容。 */}
      <div className="formula-editor-actions" aria-label="输入编辑工具">
        <div className="formula-editor-leading">{leadingActions}</div>
        <div className="formula-editor-action-group">
          {/* undo/redo 作用于 Tiptap 文档历史（StarterKit 自带 History 扩展），不是 MathField 的历史 */}
          <button type="button" className="formula-undo-redo" disabled={disabled || !editor?.can().undo()}
            onClick={() => editor?.commands.undo()} title="撤销" aria-label="撤销">
            <Undo2 size={16} />
          </button>
          <button type="button" className="formula-undo-redo" disabled={disabled || !editor?.can().redo()}
            onClick={() => editor?.commands.redo()} title="重做" aria-label="重做">
            <Redo2 size={16} />
          </button>
          <button type="button" onClick={openNewFormula} disabled={disabled}
            className="formula-trigger" title="插入公式" aria-label="插入公式">
            <Calculator size={18} />
          </button>
        </div>
        <div className="formula-editor-trailing">{trailingActions}</div>
      </div>

      {dialogOpen && (
        <div className="formula-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}>
          <section className="formula-dialog" role="dialog" aria-modal="true" aria-label="公式编辑器">
            <header className="formula-dialog-header">
              <div><h3>{editingNode ? '编辑公式' : '插入公式'}</h3><p>{queue ? `识别到 ${queue.length} 个公式 · 第 ${queueDone.filter(Boolean).length + 1} / ${queue.length} 个（逐个编辑插入，编完即弃）` : '描述转写'}</p></div>
              <button type="button" onClick={closeDialog} title="关闭" aria-label="关闭"><X size={18} /></button>
            </header>

            {queue && (
              <div className="border-b border-[var(--lm-border)] px-4 pb-3 pt-1">
                <p className="mb-2 text-xs text-[var(--lm-text-muted)]">识别到的公式（点击切换编辑）：</p>
                <div className="flex flex-wrap gap-2">
                  {queue.map((f, i) => {
                    const isCur = i === queueIndex;
                    const isDone = queueDone[i];
                    return (
                      <button key={i} type="button" disabled={isDone}
                        onClick={() => {
                          if (isDone) return;
                          setQueueIndex(i);
                          setLatex(f.latex);
                          setDisplayChoice(f.displayMode);
                          setResolvedDisplay(f.displayMode);
                        }}
                        className={`rounded-md border px-3 py-1.5 font-serif text-sm transition ${
                          isCur ? 'border-2 border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
                          : isDone ? 'border-slate-200 text-slate-300 line-through dark:border-slate-700 dark:text-slate-600'
                          : 'border-[var(--lm-border)] text-slate-700 hover:border-indigo-300 dark:text-slate-200'
                        }`}>
                        {`公式 ${i + 1}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="formula-dialog-body">
              <div className="formula-description-row">
                <input autoFocus value={description} maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) void handleConvert();
                  }}
                  placeholder="例如：x趋于0时sin x除以x的极限" />
                <button type="button" onClick={() => void handleConvert()} disabled={!description.trim() || converting} className="formula-convert-button">
                  {converting ? <LoaderCircle size={16} className="animate-spin" /> : <Sigma size={16} />}转换
                </button>
              </div>
              {showExample && (
                <button type="button" className="formula-example" onClick={() => {
                  setDescription(CONVERT_EXAMPLE);
                  setShowExample(false);
                  void handleConvert(CONVERT_EXAMPLE);
                }}>
                  试试：{CONVERT_EXAMPLE}
                </button>
              )}
              {error && (
                <div className="formula-error-row" role="alert">
                  <span className="formula-error">{error}</span>
                  <button type="button" className="formula-retry-button" disabled={converting}
                    onClick={() => void handleConvert()}>重试</button>
                </div>
              )}

              <div className="formula-visual-editor"><FormulaMathField value={latex} onChange={setLatex} fieldRef={mathFieldRef} /></div>

              {/* 符号带：只放系统键盘打不出的结构/大算符，符号+汉字标签，长按滑动出候选。
                  数字、英文字母、加减乘除不上带——系统键盘秒打。 */}
              <div className="formula-toolbar" aria-label="公式工具栏">
                {[...templates, greekLogicKey, logicKey].map((item) => (
                  <SymbolKeyButton key={item.label} item={item} onInsert={insertTemplate} />
                ))}
                <button type="button" className="symbol-key" onClick={() => setShowMatrix((shown) => !shown)} title="矩阵" aria-label="矩阵">
                  <span className="symbol-key-glyph"><Grid3X3 size={19} /></span>
                </button>
                <button type="button" className="symbol-key" onClick={() => setShowHandwriting((shown) => !shown)} title="手写输入" aria-label="手写输入">
                  <span className="symbol-key-glyph"><PenLine size={19} /></span>
                </button>
              </div>
              {showHandwriting && <HandwritingCanvas onRecognize={recognizeHandwriting} />}
              {showMatrix && <div className="formula-matrix-panel">
                <MatrixEditor ref={matrixEditorRef} onInsert={(matrixLatex) => {
                  insertTemplate(matrixLatex);
                  setResolvedDisplay('block');
                  if (displayChoice === 'auto') setDisplayChoice('block');
                  setShowMatrix(false);
                }} />
              </div>}

              <div className="formula-library">
                <button type="button" className="formula-library-toggle" aria-expanded={showLibrary}
                  onClick={() => setShowLibrary((shown) => !shown)}>
                  <ChevronDown size={14} className={showLibrary ? 'is-open' : ''} />
                  现成公式
                  <span className="formula-library-hint">常用 · 收藏 · 历史</span>
                </button>
                {showLibrary && (
                  <div className="formula-library-body">
                    <FormulaCommon onInsert={insertTemplate} />
                    <FormulaFavorites currentLatex={latex} onInsert={insertTemplate} />
                    <FormulaHistory onInsert={insertTemplate} />
                  </div>
                )}
              </div>

              <div className="formula-dialog-footer">
                {/* 显示方式已固定为"独立"(block)：去掉 自动/行内/独立 三选一——
                    对学生是多余心智负担，且本场景(问 AI 数学题)公式多单独成行展示。
                    displayChoice 常量化，见下方 display 相关逻辑。 */}
                <button type="button" className="formula-insert-button" disabled={!latex.trim()} onClick={insertFormula}>
                  <Plus size={16} />{editingNode ? '更新' : queue ? (queueDone.filter(Boolean).length + 1 < queue.length ? '插入并编辑下一个' : '插入（最后一个）') : '插入'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
});

export default FormulaComposer;
