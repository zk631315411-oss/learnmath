import { useRef, useState } from 'react';
import { Check, Copy, Edit3, Image as ImageIcon, RotateCcw, Trash2, X } from 'lucide-react';
import FormulaPreview from './FormulaPreview';
import FormulaMathField from './FormulaMathField';
import type { MathfieldElement } from 'mathlive';
import type { RecognizedBlock } from '../../types';
import { blocksToMarkdown, blocksToPlainText } from './recognizedBlocks';

interface Props { image: string; blocks: RecognizedBlock[]; warnings: string[]; onInsert: (blocks: RecognizedBlock[]) => void; onRetry?: () => void; onPhotoQuestion?: () => void; onClose: () => void; }

export default function RecognizedContentCard({ image, blocks: initial, warnings, onInsert, onRetry, onPhotoQuestion, onClose }: Props) {
  const [blocks, setBlocks] = useState(initial);
  const [copied, setCopied] = useState(false);
  const [editingFormula, setEditingFormula] = useState<number | null>(null);
  const [formulaDraft, setFormulaDraft] = useState('');
  const formulaFieldRef = useRef<MathfieldElement | null>(null);
  const updateText = (index: number, text: string) => setBlocks(items => items.map((item, i) => i === index && item.type === 'text' ? { ...item, text } : item));
  const updateFormula = (index: number, latex: string) => setBlocks(items => items.map((item, i) => i === index && item.type === 'formula' ? { ...item, latex } : item));
  const removeBlock = (index: number) => setBlocks(items => items.filter((_, i) => i !== index));
  const copy = async (plain = false) => {
    const text = plain ? blocksToPlainText(blocks) : blocksToMarkdown(blocks);
    try { await navigator.clipboard.writeText(text); } catch { /* browser permission denied */ }
    setCopied(true); window.setTimeout(() => setCopied(false), 1200);
  };
  return <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/50 p-3">
    <section className="flex max-h-[92dvh] w-[min(680px,100%)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" role="dialog" aria-label="识别结果">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700"><div className="flex items-center gap-2 text-sm font-semibold"><ImageIcon className="h-4 w-4 text-indigo-500" />识别结果</div><button type="button" onClick={onClose} aria-label="关闭" className="icon-button"><X className="h-4 w-4" /></button></header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"><img src={image} alt="原图预览" className="max-h-36 w-full rounded-lg border border-slate-200 object-contain dark:border-slate-700" />
        {warnings.map((warning, i) => <div key={`${warning}-${i}`} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">{warning}</div>)}
        {blocks.map((block, i) => block.type === 'text' ? <div key={i} className="relative"><textarea value={block.text} onChange={e => updateText(i, e.target.value)} rows={Math.min(5, Math.max(2, Math.ceil(block.text.length / 36)))} className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 pr-10 text-sm leading-6 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800" /><button type="button" onClick={() => removeBlock(i)} className="icon-button absolute right-1 top-1" title="删除文字块" aria-label="删除文字块"><Trash2 className="h-3.5 w-3.5" /></button></div> : <div key={i} className="relative rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/20"><div className="flex items-start justify-between gap-2"><FormulaPreview latex={block.latex} display={block.display_mode} /><div className="flex shrink-0"><button type="button" onClick={() => { setEditingFormula(i); setFormulaDraft(block.latex); }} className="icon-button" title="编辑公式" aria-label={`编辑第 ${i + 1} 个公式`}><Edit3 className="h-4 w-4" /></button><button type="button" onClick={() => removeBlock(i)} className="icon-button" title="删除公式块" aria-label="删除公式块"><Trash2 className="h-3.5 w-3.5" /></button></div></div><code className="mt-2 block overflow-x-auto text-xs text-slate-500">{block.latex}</code></div>)}
        {editingFormula !== null && <div className="rounded-lg border border-indigo-200 bg-white p-3 shadow-sm dark:border-indigo-800 dark:bg-slate-900"><p className="mb-2 text-xs font-medium text-slate-500">编辑公式</p><FormulaMathField value={formulaDraft} onChange={setFormulaDraft} fieldRef={formulaFieldRef} /><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setEditingFormula(null)} className="toolbar-button">取消</button><button type="button" onClick={() => { updateFormula(editingFormula, formulaDraft); setEditingFormula(null); }} className="toolbar-button toolbar-button-primary"><Check className="h-4 w-4" />确认</button></div></div>}
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-3 dark:border-slate-700"><button type="button" onClick={() => void copy()} className="toolbar-button"><Copy className="h-4 w-4" />复制内容</button><button type="button" onClick={() => void copy(true)} className="toolbar-button">纯文本</button>{onRetry && <button type="button" onClick={onRetry} className="toolbar-button"><RotateCcw className="h-4 w-4" />重试</button>}{onPhotoQuestion && <button type="button" onClick={onPhotoQuestion} className="toolbar-button">转为拍题提问</button>}<span className="ml-auto text-xs text-emerald-600">{copied ? '已复制' : ''}</span><button type="button" onClick={() => onInsert(blocks)} className="toolbar-button toolbar-button-primary"><Check className="h-4 w-4" />插入聊天</button></footer>
    </section>
  </div>;
}
