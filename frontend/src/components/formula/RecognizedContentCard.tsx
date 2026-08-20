import { useRef, useState } from 'react';
import { Check, Copy, Edit3, Image as ImageIcon, Maximize2, RotateCcw, Trash2, X } from 'lucide-react';
import FormulaPreview from './FormulaPreview';
import FormulaMathField from './FormulaMathField';
import type { MathfieldElement } from 'mathlive';
import type { RecognizedBlock } from '../../types';
import { blocksToMarkdown, blocksToPlainText } from './recognizedBlocks';

interface Props { image: string; blocks: RecognizedBlock[]; warnings: string[]; onInsert: (blocks: RecognizedBlock[]) => void; onRetry?: () => void; onQuestion?: () => void; questionLabel?: string; onClose: () => void; }

export default function RecognizedContentCard({ image, blocks: initial, warnings, onInsert, onRetry, onQuestion, questionLabel = '转为拍题提问', onClose }: Props) {
  const [blocks, setBlocks] = useState(initial);
  const [copied, setCopied] = useState(false);
  const [editingFormula, setEditingFormula] = useState<number | null>(null);
  const [formulaDraft, setFormulaDraft] = useState('');
  const [imageExpanded, setImageExpanded] = useState(false);
  const formulaFieldRef = useRef<MathfieldElement | null>(null);
  const updateText = (index: number, text: string) => setBlocks(items => items.map((item, i) => i === index && item.type === 'text' ? { ...item, text } : item));
  const updateFormula = (index: number, latex: string) => setBlocks(items => items.map((item, i) => i === index && item.type === 'formula' ? { ...item, latex } : item));
  const updateDisplay = (index: number, display_mode: 'inline' | 'block') => setBlocks(items => items.map((item, i) => i === index && item.type === 'formula' ? { ...item, display_mode } : item));
  const removeBlock = (index: number) => setBlocks(items => items.filter((_, i) => i !== index));
  const copy = async (plainOnly = false) => {
    const markdown = blocksToMarkdown(blocks);
    const plain = blocksToPlainText(blocks);
    try {
      let richCopySucceeded = false;
      const supportsMarkdown = typeof ClipboardItem !== 'undefined'
        && (!ClipboardItem.supports || ClipboardItem.supports('text/markdown'));
      if (!plainOnly && navigator.clipboard.write && supportsMarkdown) {
        try {
          await navigator.clipboard.write([new ClipboardItem({
            'text/plain': new Blob([plain], { type: 'text/plain' }),
            'text/markdown': new Blob([markdown], { type: 'text/markdown' }),
          })]);
          richCopySucceeded = true;
        } catch {
          richCopySucceeded = false;
        }
      }
      if (!richCopySucceeded) await navigator.clipboard.writeText(plainOnly ? plain : markdown);
    } catch { /* browser permission denied */ }
    setCopied(true); window.setTimeout(() => setCopied(false), 1200);
  };
  return <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/50 p-3">
    <section className="flex max-h-[92dvh] w-[min(680px,100%)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" role="dialog" aria-label="识别结果">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700"><div className="flex items-center gap-2 text-sm font-semibold"><ImageIcon className="h-4 w-4 text-indigo-500" />识别结果</div><button type="button" onClick={onClose} aria-label="关闭" className="icon-button"><X className="h-4 w-4" /></button></header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"><button type="button" onClick={() => setImageExpanded(true)} className="group relative block w-full" aria-label="放大查看原图"><img src={image} alt="原图预览" className="max-h-36 w-full rounded-lg border border-slate-200 object-contain dark:border-slate-700" /><span className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-md bg-slate-900/70 text-white opacity-80 group-hover:opacity-100"><Maximize2 className="h-4 w-4" /></span></button>
        {warnings.map((warning, i) => <div key={`${warning}-${i}`} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">{warning}</div>)}
        {blocks.map((block, i) => block.type === 'text' ? <div key={i} className="relative"><div className="mb-1 text-[11px] text-slate-400">文字块 {i + 1}</div><textarea value={block.text} onChange={e => updateText(i, e.target.value)} rows={Math.min(5, Math.max(2, Math.ceil(block.text.length / 36)))} className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 pr-10 text-sm leading-6 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800" /><button type="button" onClick={() => removeBlock(i)} className="icon-button absolute right-1 top-6" title="删除文字块" aria-label="删除文字块"><Trash2 className="h-3.5 w-3.5" /></button></div> : <div key={i} className="relative rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/20"><div className="mb-1 text-[11px] text-indigo-500">公式块 {i + 1}</div><div className="flex items-start justify-between gap-2"><FormulaPreview latex={block.latex} display={block.display_mode} /><div className="flex shrink-0"><button type="button" onClick={() => { setEditingFormula(i); setFormulaDraft(block.latex); }} className="icon-button" title="编辑公式" aria-label={`编辑第 ${i + 1} 个公式`}><Edit3 className="h-4 w-4" /></button><button type="button" onClick={() => removeBlock(i)} className="icon-button" title="删除公式块" aria-label="删除公式块"><Trash2 className="h-3.5 w-3.5" /></button></div></div><div className="mt-2 flex w-fit rounded-md border border-slate-200 bg-white p-0.5 text-xs dark:border-slate-700 dark:bg-slate-900" role="group" aria-label={`第 ${i + 1} 个公式显示方式`}><button type="button" onClick={() => updateDisplay(i, 'inline')} aria-pressed={block.display_mode === 'inline'} className={`rounded px-2 py-1 ${block.display_mode === 'inline' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>行内</button><button type="button" onClick={() => updateDisplay(i, 'block')} aria-pressed={block.display_mode === 'block'} className={`rounded px-2 py-1 ${block.display_mode === 'block' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>独立</button></div><code className="mt-2 block overflow-x-auto text-xs text-slate-500">{block.latex}</code></div>)}
        {editingFormula !== null && <div className="rounded-lg border border-indigo-200 bg-white p-3 shadow-sm dark:border-indigo-800 dark:bg-slate-900"><p className="mb-2 text-xs font-medium text-slate-500">编辑公式</p><FormulaMathField value={formulaDraft} onChange={setFormulaDraft} fieldRef={formulaFieldRef} /><div className="mt-3 overflow-x-auto rounded-md bg-slate-50 p-2 dark:bg-slate-800"><FormulaPreview latex={formulaDraft} display="block" /></div><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setEditingFormula(null)} className="toolbar-button">取消</button><button type="button" disabled={!formulaDraft.trim()} onClick={() => { updateFormula(editingFormula, formulaDraft); setEditingFormula(null); }} className="toolbar-button toolbar-button-primary"><Check className="h-4 w-4" />确认</button></div></div>}
        {blocks.length === 0 && <p className="py-8 text-center text-sm text-slate-500">没有可插入的内容，请重新识别或转为拍题提问。</p>}
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-3 dark:border-slate-700"><button type="button" disabled={blocks.length === 0} onClick={() => void copy()} className="toolbar-button"><Copy className="h-4 w-4" />复制内容</button><button type="button" disabled={blocks.length === 0} onClick={() => void copy(true)} className="toolbar-button">纯文本</button>{onRetry && <button type="button" onClick={onRetry} className="toolbar-button"><RotateCcw className="h-4 w-4" />重试</button>}{onQuestion && <button type="button" onClick={onQuestion} className="toolbar-button">{questionLabel}</button>}<span className="ml-auto text-xs text-emerald-600">{copied ? '已复制' : ''}</span><button type="button" disabled={blocks.length === 0} onClick={() => onInsert(blocks)} className="toolbar-button toolbar-button-primary"><Check className="h-4 w-4" />插入聊天</button></footer>
    </section>
    {imageExpanded && <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/90 p-4" role="dialog" aria-modal="true" aria-label="原图大图"><button type="button" onClick={() => setImageExpanded(false)} className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20" aria-label="关闭大图"><X className="h-5 w-5" /></button><img src={image} alt="识别原图大图" className="max-h-full max-w-full object-contain" /></div>}
  </div>;
}
