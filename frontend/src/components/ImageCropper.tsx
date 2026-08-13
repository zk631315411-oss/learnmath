import { useState, useRef, useCallback } from 'react';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import type { CropBBox } from '../types';

interface Props {
  src: string;
  onConfirm: (croppedBase64: string, centerRatioX: number, centerRatioY: number, cropBBox: CropBBox) => void;
  onCancel: () => void;
}

function ratio(val: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(1, val / total)) : 0.5;
}

export default function ImageCropper({ src, onConfirm, onCancel }: Props) {
  const [crop, setCrop] = useState<Crop>({ unit: '%', width: 50, height: 50, x: 25, y: 25 });
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const handleConfirm = useCallback(() => {
    if (!completedCrop || !imgRef.current) return;

    const dpr = window.devicePixelRatio || 1;
    const img = imgRef.current;
    const canvas = document.createElement('canvas');
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;

    canvas.width = completedCrop.width * dpr;
    canvas.height = completedCrop.height * dpr;
    const ctx = canvas.getContext('2d')!;

    ctx.drawImage(
      img,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0, 0,
      canvas.width,
      canvas.height,
    );

    const centerRatioX = ratio(completedCrop.x + completedCrop.width / 2, img.width);
    const centerRatioY = ratio(completedCrop.y + completedCrop.height / 2, img.height);
    onConfirm(canvas.toDataURL('image/png'), centerRatioX, centerRatioY, {
      x: ratio(completedCrop.x, img.width),
      y: ratio(completedCrop.y, img.height),
      width: ratio(completedCrop.width, img.width),
      height: ratio(completedCrop.height, img.height),
      unit: 'page_ratio',
    });
  }, [completedCrop, onConfirm]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">裁剪截图</span>
          <button onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">✕</button>
        </div>

        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-100 dark:bg-slate-900">
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setCompletedCrop(c)}
            minWidth={30}
            minHeight={30}
          >
            <img ref={imgRef} src={src} alt="截图预览" style={{ maxHeight: '60vh' }} />
          </ReactCrop>
        </div>

        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex gap-2 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
            取消
          </button>
          <button onClick={handleConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors font-medium">
            确认截取
          </button>
        </div>
      </div>
    </div>
  );
}
