import { useEffect, useRef, useState } from 'react';
import { Camera, Image as ImageIcon, Plus, Upload } from 'lucide-react';

const isMobileTouch = window.matchMedia('(pointer: coarse)').matches
  && !window.matchMedia('(pointer: fine)').matches;

interface Props {
  disabled?: boolean;
  onBeforeSelect?: () => void;
  onSelectFile: (file: File) => void;
}

export default function ChatPlusMenu({ disabled, onBeforeSelect, onSelectFile }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const choose = (input: HTMLInputElement | null) => {
    onBeforeSelect?.();
    setOpen(false);
    input?.click();
  };

  const selected = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (file) onSelectFile(file);
  };

  return <div ref={rootRef} className="relative shrink-0">
    <button type="button" disabled={disabled} onClick={() => setOpen(value => !value)}
      className="icon-button" title="添加图片" aria-label="添加图片" aria-haspopup="menu" aria-expanded={open}>
      <Plus className="h-4 w-4" />
    </button>
    <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={event => selected(event.currentTarget)} />
    <input ref={libraryRef} type="file" accept="image/*" className="hidden" onChange={event => selected(event.currentTarget)} />
    {open && <div role="menu" aria-label="添加图片" className="absolute bottom-full left-0 z-30 mb-2 min-w-40 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      {isMobileTouch ? <>
        <button type="button" role="menuitem" onClick={() => choose(cameraRef.current)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"><Camera className="h-4 w-4" />拍照识别</button>
        <button type="button" role="menuitem" onClick={() => choose(libraryRef.current)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"><ImageIcon className="h-4 w-4" />相册识别</button>
      </> : <button type="button" role="menuitem" onClick={() => choose(libraryRef.current)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"><Upload className="h-4 w-4" />上传图片识别</button>}
    </div>}
  </div>;
}
