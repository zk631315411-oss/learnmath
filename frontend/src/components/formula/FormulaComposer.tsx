import { useEffect, useRef, useState } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Mathematics } from '@tiptap/extension-mathematics';
import { MathfieldElement } from 'mathlive';
import { Calculator, ChevronDown, Grid3X3, LoaderCircle, Plus, Redo2, Sigma, Undo2, X } from 'lucide-react';

import MathLiveInput from './MathLiveInput';
import FormulaCommon from './FormulaCommon';
import FormulaFavorites from './FormulaFavorites';
import FormulaHistory, { recordFormulaUsage } from './FormulaHistory';
import FormulaMathField from './FormulaMathField';
import FormulaPreview from './FormulaPreview';
import MatrixEditor from './MatrixEditor';
import { convertFormula } from '../../services/api';

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
}

const templates = [
  { label: '分数', value: '\\frac{#0}{#?}', glyph: 'a/b' },
  { label: '根式', value: '\\sqrt{#0}', glyph: '√' },
  { label: '上标', value: '^{#0}', glyph: 'x²' },
  { label: '下标', value: '_{#0}', glyph: 'x₂' },
  { label: '极限', value: '\\lim_{#0 \\to #?}', glyph: 'lim' },
  { label: '积分', value: '\\int_{#0}^{#?}', glyph: '∫' },
  { label: '求和', value: '\\sum_{#0}^{#?}', glyph: 'Σ' },
  { label: '向量', value: '\\vec{#0}', glyph: 'vec' },
];

const moreTemplates = [
  { label: 'α', value: '\\alpha' }, { label: 'β', value: '\\beta' },
  { label: 'γ', value: '\\gamma' }, { label: 'θ', value: '\\theta' },
  { label: 'λ', value: '\\lambda' }, { label: 'π', value: '\\pi' },
  { label: '∞', value: '\\infty' }, { label: '属于', value: '\\in' },
  { label: '不属于', value: '\\notin' }, { label: '交', value: '\\cap' },
  { label: '并', value: '\\cup' }, { label: '推出', value: '\\Rightarrow' },
];

// P2：描述转写示例，点击后自动填入并触发转换
const CONVERT_EXAMPLE = 'x趋于0时（sin x）的平方除以x';

export default function FormulaComposer({
  value, onChange, token, placeholder = '输入文字，或插入数学公式…', disabled, compact, onSubmit,
}: Props) {
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
  const mathFieldRef = useRef<MathfieldElement | null>(null);
  const conversionRequestRef = useRef(0);
  const submitRef = useRef(onSubmit);
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
  }, []);

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
    setDialogOpen(true);
  };

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
      setError(conversionError instanceof Error ? conversionError.message : '转换服务暂时不可用，请手动输入公式');
    } finally {
      if (requestId === conversionRequestRef.current) setConverting(false);
    }
  };

  const insertTemplate = (template: string) => {
    mathFieldRef.current?.insert(template, { selectionMode: 'placeholder' });
    mathFieldRef.current?.focus();
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

              <div className="formula-visual-editor"><FormulaMathField value={latex} onChange={setLatex} fieldRef={mathFieldRef} /></div>

              <div className="formula-toolbar" aria-label="公式工具栏">
                {templates.map((item) => <button key={item.label} type="button" onClick={() => insertTemplate(item.value)} title={item.label}>{item.glyph}</button>)}
                <button type="button" onClick={() => setShowMatrix((shown) => !shown)} title="矩阵"><Grid3X3 size={16} /></button>
                <button type="button" onClick={() => setShowMore((shown) => !shown)} title="更多符号"><ChevronDown size={16} /></button>
              </div>
              {showMore && <div className="formula-more-symbols">
                {moreTemplates.map((item) => <button key={item.label} type="button" onClick={() => insertTemplate(item.value)}>{item.label}</button>)}
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
}
