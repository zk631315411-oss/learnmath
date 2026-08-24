import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';
import type { SelectionBookmark } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Mathematics } from '@tiptap/extension-mathematics';
import { MathfieldElement } from 'mathlive';
import { Calculator, ChevronDown, Grid3X3, Keyboard, LoaderCircle, PenLine, Plus, Redo2, Sigma, Undo2, X } from 'lucide-react';

import MathLiveInput from './MathLiveInput';
import FormulaCommon from './FormulaCommon';
import FormulaFavorites from './FormulaFavorites';
import FormulaGlyph from './FormulaGlyph';
import FormulaHistory, { recordFormulaUsage } from './FormulaHistory';
import FormulaMathField from './FormulaMathField';
import FormulaPreview from './FormulaPreview';
import MatrixEditor from './MatrixEditor';
import HandwritingCanvas from './HandwritingCanvas';
import FormulaStructureNav from './FormulaStructureNav';
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
}

export interface FormulaComposerHandle { captureInsertionBookmark: () => void; }

export type ExternalFormulaDraft = { latex: string; displayMode: 'inline' | 'block'; nonce: string };

// glyph 是 KaTeX 渲染的图标（FormulaGlyph 会把 #0/#? 画成 □），label 只进 tooltip/aria
const templates = [
  { label: '分数', value: '\\frac{#0}{#?}', glyph: '\\frac{a}{b}' },
  { label: '根式', value: '\\sqrt{#0}', glyph: '\\sqrt{x}' },
  { label: '上标', value: '^{#0}', glyph: 'x^{2}' },
  { label: '下标', value: '_{#0}', glyph: 'x_{i}' },
  { label: '极限', value: '\\lim_{#0 \\to #?}', glyph: '\\lim_{x \\to 0}' },
  { label: '积分', value: '\\int_{#0}^{#?}', glyph: '\\int_{a}^{b}' },
  { label: '求和', value: '\\sum_{#0}^{#?}', glyph: '\\sum_{i=1}^{n}' },
  { label: '向量', value: '\\vec{#0}', glyph: '\\vec{a}' },
];

const moreTemplates = [
  { label: 'α', value: '\\alpha', glyph: '\\alpha' }, { label: 'β', value: '\\beta', glyph: '\\beta' },
  { label: 'γ', value: '\\gamma', glyph: '\\gamma' }, { label: 'θ', value: '\\theta', glyph: '\\theta' },
  { label: 'λ', value: '\\lambda', glyph: '\\lambda' }, { label: 'π', value: '\\pi', glyph: '\\pi' },
  { label: '∞', value: '\\infty', glyph: '\\infty' }, { label: '属于', value: '\\in', glyph: '\\in' },
  { label: '不属于', value: '\\notin', glyph: '\\notin' }, { label: '交', value: '\\cap', glyph: '\\cap' },
  { label: '并', value: '\\cup', glyph: '\\cup' }, { label: '推出', value: '\\Rightarrow', glyph: '\\Rightarrow' },
];

const quickTemplates: Record<string, { label: string; value: string }> = {
  '1': { label: '分数', value: '\\frac{#0}{#?}' }, '2': { label: '根号', value: '\\sqrt{#0}' },
  '3': { label: '上标', value: '^{#0}' }, '4': { label: '下标', value: '_{#0}' },
  '5': { label: '积分', value: '\\int_{#0}^{#?}' }, '6': { label: '求和', value: '\\sum_{#0}^{#?}' },
  v: { label: '向量', value: '\\vec{#0}' },
};

// P2：描述转写示例，点击后自动填入并触发转换
const CONVERT_EXAMPLE = 'x趋于0时（sin x）的平方除以x';

const FormulaComposer = forwardRef<FormulaComposerHandle, Props>(function FormulaComposer({
  value, onChange, token, placeholder = '输入文字，或插入数学公式…', disabled, compact, onSubmit,
  externalFormula, onExternalFormulaConsumed, externalContent, onExternalContentConsumed,
}: Props, ref) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [latex, setLatex] = useState('');
  const [displayChoice, setDisplayChoice] = useState<DisplayChoice>('auto');
  const [resolvedDisplay, setResolvedDisplay] = useState<'inline' | 'block'>('inline');
  const [editingNode, setEditingNode] = useState<FormulaNode>(null);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);
  const [showExample, setShowExample] = useState(true);
  const [showQuickPanel, setShowQuickPanel] = useState(false);
  const [showHandwriting, setShowHandwriting] = useState(false);
  const [readyField, setReadyField] = useState<MathfieldElement | null>(null);
  const mathFieldRef = useRef<MathfieldElement | null>(null);
  const conversionRequestRef = useRef(0);
  const submitRef = useRef(onSubmit);
  const consumedNonceRef = useRef<string | null>(null);
  const insertionBookmarkRef = useRef<SelectionBookmark | null>(null);
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
    setDisplayChoice('auto');
    setResolvedDisplay('inline');
    setError('');
    setShowMore(false);
    setShowMatrix(false);
    setShowExample(true);
    setShowQuickPanel(false);
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
    setShowQuickPanel(false);
    setDialogOpen(true);
    onExternalFormulaConsumed?.(externalFormula.nonce);
  }, [externalFormula, onExternalFormulaConsumed]);

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
    const field = mathFieldRef.current;
    if (!field) return;
    // MathLive 的 #0 会被替换成当前选区内容：选区为空时变成空串，产生零宽度空组
    // （光标进不去、鼠标点不中——体验报告的 vec bug 根因）。空选区改用 #? 占位符填空；
    // 有选区时保留 #0，选区内容被包进结构（先写内容后画线的包裹式输入）。
    const effective = field.selectionIsCollapsed ? template.replace(/#0/g, '#?') : template;
    field.insert(effective, { mode: 'math', selectionMode: 'placeholder' });
    // Button click completes after this handler and would otherwise reclaim focus.
    requestAnimationFrame(() => field.focus());
  };

  const handleFieldReady = useCallback((field: MathfieldElement | null) => setReadyField(field), []);

  const executeQuick = useCallback((key: string) => {
    if (key === 'm') {
      setShowMatrix(true);
    } else {
      const action = quickTemplates[key];
      if (!action) return false;
      insertTemplate(action.value);
    }
    setShowQuickPanel(false);
    requestAnimationFrame(() => mathFieldRef.current?.focus());
    return true;
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'g') {
        event.preventDefault(); setShowQuickPanel(true); return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (showQuickPanel) setShowQuickPanel(false); else closeDialog();
        return;
      }
      if (showQuickPanel && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (executeQuick(key)) event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen, executeQuick, showQuickPanel]);

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
    if (inserted) recordFormulaUsage(cleanLatex);
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

      {dialogOpen && (
        <div className="formula-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}>
          <section className="formula-dialog" role="dialog" aria-modal="true" aria-label="公式编辑器">
            <header className="formula-dialog-header">
              <div><h3>{editingNode ? '编辑公式' : '插入公式'}</h3><p>描述转写</p></div>
              <button type="button" onClick={closeDialog} title="关闭" aria-label="关闭"><X size={18} /></button>
            </header>

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

              <div className="formula-preview">
                <span>预览</span>
                {/* 手动选了显示方式就立即生效，auto 才用后端判定的结果，避免切换后预览"不即时" */}
                <FormulaPreview latex={latex} display={displayChoice === 'auto' ? resolvedDisplay : displayChoice} />
              </div>

              <div className="formula-visual-editor"><FormulaMathField value={latex} onChange={setLatex} fieldRef={mathFieldRef} onReady={handleFieldReady} /></div>
              <FormulaStructureNav field={readyField} />

              <div className="formula-toolbar" aria-label="公式工具栏">
                {templates.map((item) => (
                  <button key={item.label} type="button" onClick={() => insertTemplate(item.value)} title={item.label} aria-label={item.label}>
                    <FormulaGlyph latex={item.glyph} fallback={item.label} />
                  </button>
                ))}
                <button type="button" onClick={() => setShowMatrix((shown) => !shown)} title="矩阵" aria-label="矩阵"><Grid3X3 size={16} /></button>
                <button type="button" onClick={() => setShowMore((shown) => !shown)} title="更多符号" aria-label="更多符号"><ChevronDown size={16} /></button>
                <button type="button" onClick={() => setShowQuickPanel((shown) => !shown)} title="快捷插入（Ctrl+Shift+G）" aria-label="打开快捷插入"><Keyboard size={16} /></button>
                <button type="button" onClick={() => setShowHandwriting((shown) => { const next = !shown; if (next) { mathFieldRef.current?.blur(); window.mathVirtualKeyboard?.hide(); } return next; })} title="手写输入" aria-label="手写输入"><PenLine size={16} /></button>
              </div>
              {showQuickPanel && (
                <div className="formula-quick-panel" role="dialog" aria-label="快捷插入">
                  {Object.entries(quickTemplates).map(([key, item]) => <button key={key} type="button" onClick={() => executeQuick(key)}><kbd>{key.toUpperCase()}</kbd><span>{item.label}</span></button>)}
                  <button type="button" onClick={() => executeQuick('m')}><kbd>M</kbd><span>矩阵</span></button>
                </div>
              )}
              {showHandwriting && <HandwritingCanvas onRecognize={recognizeHandwriting} />}
              {showMore && <div className="formula-more-symbols">
                {moreTemplates.map((item) => (
                  <button key={item.label} type="button" onClick={() => insertTemplate(item.value)} title={item.label} aria-label={item.label}>
                    <FormulaGlyph latex={item.glyph} fallback={item.label} />
                  </button>
                ))}
              </div>}
              {showMatrix && <div className="formula-matrix-panel">
                <MatrixEditor onInsert={(matrixLatex) => {
                  insertTemplate(matrixLatex);
                  setResolvedDisplay('block');
                  if (displayChoice === 'auto') setDisplayChoice('block');
                  setShowMatrix(false);
                }} />
              </div>}

              <FormulaCommon onInsert={insertTemplate} />
              <FormulaFavorites currentLatex={latex} onInsert={insertTemplate} />
              <FormulaHistory onInsert={insertTemplate} />

              <div className="formula-dialog-footer">
                <div className="formula-display-toggle" aria-label="公式显示方式">
                  {(['auto', 'inline', 'block'] as const).map((choice) => (
                    <button key={choice} type="button" className={displayChoice === choice ? 'is-active' : ''} onClick={() => setDisplayChoice(choice)}>{choice === 'auto' ? '自动' : choice === 'inline' ? '行内' : '独立'}</button>
                  ))}
                </div>
                <button type="button" className="formula-insert-button" disabled={!latex.trim()} onClick={insertFormula}>
                  <Plus size={16} />{editingNode ? '更新' : '插入'}
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
