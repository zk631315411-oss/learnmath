import { useEffect, useRef, useState } from 'react';
import { Camera, FileImage, LoaderCircle, X } from 'lucide-react';

import { useFormulaRecognition } from '../hooks/useFormulaRecognition';
import type { RecognizedBlock } from '../types';
import { errorMessage } from '../utils/errorMessage';
import { prepareImageUpload } from '../utils/imageProcessing';
import RecognizedContentCard from './formula/RecognizedContentCard';

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const isMobileTouch = window.matchMedia('(pointer: coarse)').matches
  && !window.matchMedia('(pointer: fine)').matches;

interface Props {
  initialFile: File;
  token?: string | null;
  onPhotoQuestion: (image: string) => void;
  onInsert: (blocks: RecognizedBlock[]) => void;
  onClose: () => void;
}

function readAsDataUrl(value: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择'));
    reader.readAsDataURL(value);
  });
}

export default function PhotoPreviewSheet({ initialFile, token, onPhotoQuestion, onInsert, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState('');
  const [preparing, setPreparing] = useState(true);
  const [loadError, setLoadError] = useState('');
  const { busy, error, result, recognize, cancelRecognition, reset } = useFormulaRecognition({
    fallbackMessage: '识别失败，请重试',
  });

  const loadFile = async (file?: File) => {
    if (!file) return;
    cancelRecognition();
    setPreparing(true);
    reset();
    setImage('');
    setLoadError('');
    try {
      if (!SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase())) {
        throw new Error('当前浏览器无法处理该图片格式，请改选 JPEG、PNG 或 WebP');
      }
      const source = await readAsDataUrl(file);
      const prepared = await prepareImageUpload(source);
      setImage(await readAsDataUrl(prepared));
    } catch (loadErr) {
      setLoadError(errorMessage(loadErr, '图片无法解码，请改选 JPEG/PNG'));
    } finally {
      setPreparing(false);
    }
  };

  useEffect(() => {
    void loadFile(initialFile);
  }, [initialFile]);

  const doRecognize = () => recognize(image, token);

  const selected = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void loadFile(file);
  };

  if (result) return <RecognizedContentCard image={image} blocks={result.blocks} warnings={result.warnings}
    onInsert={onInsert} onRetry={() => { reset(); void doRecognize(); }}
    onQuestion={() => onPhotoQuestion(image)} onClose={onClose} />;

  return <div className="fixed inset-0 z-[105] grid place-items-center bg-slate-950/50 p-3">
    <section className="w-[min(520px,100%)] rounded-lg bg-white p-4 shadow-2xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-label="图片预览">
      <header className="flex items-center justify-between"><h3 className="text-sm font-semibold">图片预览</h3><button type="button" onClick={onClose} aria-label="取消并关闭" className="icon-button"><X className="h-4 w-4" /></button></header>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={event => selected(event.currentTarget)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={event => selected(event.currentTarget)} />
      {preparing ? <div className="mt-3 flex h-48 items-center justify-center gap-2 text-sm text-slate-500" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />正在处理图片…</div>
        : image ? <img src={image} alt="待识别图片" className="mt-3 max-h-[55dvh] w-full rounded-lg object-contain" />
          : <div className="mt-3 flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 text-center text-sm text-slate-500 dark:border-slate-700">图片未能载入，请重新选择</div>}
      {(loadError || error) && <p className="mt-3 text-xs text-rose-600" role="alert">{loadError || error}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {isMobileTouch && <button type="button" disabled={busy || preparing} onClick={() => cameraRef.current?.click()} className="toolbar-button"><Camera className="h-4 w-4" />重新拍摄</button>}
        <button type="button" disabled={busy || preparing} onClick={() => inputRef.current?.click()} className="toolbar-button"><FileImage className="h-4 w-4" />更换图片</button>
        <button type="button" onClick={() => onPhotoQuestion(image)} disabled={!image || busy || preparing} className="toolbar-button">拍题提问</button>
        {busy ? <button type="button" onClick={cancelRecognition} className="toolbar-button"><X className="h-4 w-4" />取消识别</button>
          : <button type="button" onClick={() => void doRecognize()} disabled={!image || preparing} className="toolbar-button toolbar-button-primary">识别内容</button>}
      </div>
    </section>
  </div>;
}
