/**
 * Header 方案对比预览 — 展示 4 种风格，点击切换查看
 * 仅用于调试/选型，正式上线时删掉此组件
 */
import { useState } from 'react';
import { PRESET_PDFS } from '../hooks/useTextbookPreference';

type Style = 'compact' | 'centered' | 'minimal' | 'bold';
const STYLES: { key: Style; label: string }[] = [
  { key: 'compact',   label: '方案 A：紧凑商务' },
  { key: 'centered',  label: '方案 B：居中学院' },
  { key: 'minimal',   label: '方案 C：极简留白' },
  { key: 'bold',      label: '方案 D：深色撞色' },
];

function HeaderA({ textbookId, setTextbookId }: { textbookId: string; setTextbookId: (v: string) => void }) {
  return (
    <header className="px-4 py-2 bg-white border-b border-slate-200 flex items-center gap-4 text-sm">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded bg-blue-600 text-white flex items-center justify-center font-bold text-xs">LM</div>
        <span className="font-semibold text-slate-800">LearnMath</span>
      </div>
      <div className="flex-1" />
      <select value={textbookId} onChange={e => setTextbookId(e.target.value)}
        className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 bg-white">
        <option value="">选择教材</option>
        {PRESET_PDFS.map(p => <option key={p.path} value={p.textbookId}>{p.name}</option>)}
      </select>
      <button className="text-xs text-slate-500 hover:text-slate-700">登录</button>
    </header>
  );
}

function HeaderB({ textbookId, setTextbookId }: { textbookId: string; setTextbookId: (v: string) => void }) {
  return (
    <header className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-col items-center gap-2">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-xs">∫</div>
        <span className="font-semibold text-slate-800 text-base tracking-tight">学数有道</span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <select value={textbookId} onChange={e => setTextbookId(e.target.value)}
          className="border border-slate-200 rounded px-2 py-1 text-slate-600 bg-white">
          <option value="">选择教材</option>
          {PRESET_PDFS.map(p => <option key={p.path} value={p.textbookId}>{p.name}</option>)}
        </select>
        <span className="text-slate-300">|</span>
        <button className="text-slate-500 hover:text-slate-700">登录</button>
      </div>
    </header>
  );
}

function HeaderC({ textbookId, setTextbookId }: { textbookId: string; setTextbookId: (v: string) => void }) {
  return (
    <header className="px-5 py-2 bg-white border-b border-slate-100 flex items-center justify-between">
      <span className="text-sm font-medium text-slate-700">LearnMath</span>
      <select value={textbookId} onChange={e => setTextbookId(e.target.value)}
        className="text-xs border border-slate-100 rounded px-2 py-1 text-slate-500 bg-transparent">
        <option value="">教材</option>
        {PRESET_PDFS.map(p => <option key={p.path} value={p.textbookId}>{p.name}</option>)}
      </select>
    </header>
  );
}

function HeaderD({ textbookId, setTextbookId }: { textbookId: string; setTextbookId: (v: string) => void }) {
  return (
    <header className="px-5 py-3 bg-slate-900 flex items-center gap-4">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded bg-cyan-400 text-slate-900 flex items-center justify-center font-bold text-xs">∑</div>
        <span className="font-semibold text-white text-sm">学数有道</span>
      </div>
      <div className="flex-1" />
      <select value={textbookId} onChange={e => setTextbookId(e.target.value)}
        className="text-xs border border-slate-700 rounded px-2 py-1 text-slate-300 bg-slate-800">
        <option value="">选择教材</option>
        {PRESET_PDFS.map(p => <option key={p.path} value={p.textbookId}>{p.name}</option>)}
      </select>
      <button className="text-xs text-slate-400 hover:text-white transition-colors">登录</button>
    </header>
  );
}

const MAP = { compact: HeaderA, centered: HeaderB, minimal: HeaderC, bold: HeaderD };

export default function HeaderPreview() {
  const [style, setStyle] = useState<Style>('compact');
  const [textbookId, setTextbookId] = useState('');
  const Header = MAP[style];

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-xs text-amber-700">
        <span>🔍 这是 Header 方案预览，选择一种风格后我来替换 App.tsx</span>
      </div>
      <div className="flex gap-2 p-3 border-b border-slate-200 bg-slate-50 flex-wrap">
        {STYLES.map(s => (
          <button key={s.key} onClick={() => setStyle(s.key)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              style === s.key ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:border-blue-300'
            }`}>
            {s.label}
          </button>
        ))}
      </div>
      <Header textbookId={textbookId} setTextbookId={setTextbookId} />
      <div className="flex-1 bg-slate-100 flex items-center justify-center text-slate-400 text-sm">
        选「框选提问」或教材下拉框试试交互
      </div>
    </div>
  );
}
