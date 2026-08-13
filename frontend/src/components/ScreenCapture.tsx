import { useState, useCallback, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import ImageCropper from './ImageCropper';
import type { CropBBox } from '../types';

// 仅纯触屏设备（手机/平板）走 ImageCropper；触屏笔记本有精准指针走桌面框选
const isMobileTouch = window.matchMedia('(pointer: coarse)').matches
  && !window.matchMedia('(pointer: fine)').matches;

interface Props {
  isActive: boolean;
  currentPage: number;
  onCapture: (imageData: string, pageRatioX: number, pageRatioY: number, cropBBox: CropBBox) => void;
  onCancel: () => void;
}

export default function ScreenCapture({ isActive, currentPage, onCapture, onCancel }: Props) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [endPos, setEndPos] = useState({ x: 0, y: 0 });
  const [confirmed, setConfirmed] = useState(false);  // 选区已确认，等用户点 ✓
  const [isCapturing, setIsCapturing] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const maskRef = useRef<HTMLDivElement>(null);       // 蒙层 ref，截图前隐藏

  // 移动端：精确查找当前页码的 Canvas → 打开 ImageCropper
  useEffect(() => {
    if (!isActive || !isMobileTouch) return;

    const canvas = document.querySelector(
      `.react-pdf__Page[data-page-number="${currentPage}"] canvas`
    ) as HTMLCanvasElement | null;
    if (canvas) {
      try {
        setCropSrc(canvas.toDataURL('image/png'));
      } catch {
        html2canvas(document.body, { scale: 1, backgroundColor: '#ffffff' }).then((c) => {
          setCropSrc(c.toDataURL('image/png'));
        }).catch(() => setCropSrc(null));
      }
    } else {
      const pageEl = document.querySelector(
        `.react-pdf__Page[data-page-number="${currentPage}"]`
      ) as HTMLElement | null;
      html2canvas(pageEl || document.body, { scale: 1, backgroundColor: '#ffffff', useCORS: true }).then((c) => {
        setCropSrc(c.toDataURL('image/png'));
      }).catch(() => setCropSrc(null));
    }
  }, [isActive]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setConfirmed(false);
    setIsSelecting(true);
    setStartPos({ x: e.clientX, y: e.clientY });
    setEndPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isSelecting) {
      setEndPos({ x: e.clientX, y: e.clientY });
    }
  }, [isSelecting]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!isSelecting) return;
    setIsSelecting(false);

    const width = Math.abs(endPos.x - startPos.x);
    const height = Math.abs(endPos.y - startPos.y);

    if (width < 20 || height < 20) {
      setConfirmed(false);
      return;
    }
    // 选区有效 → 显示确认按钮，不立即截图
    setConfirmed(true);
  }, [isSelecting, startPos, endPos]);

  const handleConfirm = useCallback(async () => {
    if (!confirmed) return;

    const left = Math.min(startPos.x, endPos.x);
    const top = Math.min(startPos.y, endPos.y);
    const width = Math.abs(endPos.x - startPos.x);
    const height = Math.abs(endPos.y - startPos.y);

    // 隐藏蒙层再截图
    if (maskRef.current) maskRef.current.style.display = 'none';
    setIsCapturing(true);

    try {
      // 等一帧让 display:none 生效
      await new Promise(r => requestAnimationFrame(r));

      // 直接截整个视口，不做坐标裁剪（避免 html2canvas 坐标系问题）
      const fullCanvas = await html2canvas(document.body, {
        scale: 1,
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: true,
      });

      // 用 Canvas 裁剪出选区
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = width;
      cropCanvas.height = height;
      const ctx = cropCanvas.getContext('2d')!;
      ctx.drawImage(fullCanvas, left, top, width, height, 0, 0, width, height);

      const centerX = left + width / 2;
      const centerY = top + height / 2;
      const pageEl = document.querySelector(
        `.react-pdf__Page[data-page-number="${currentPage}"]`
      ) || document.querySelector('.react-pdf__Page');
      const rect = pageEl?.getBoundingClientRect();
      const rx = rect && rect.width > 0 ? Math.max(0, Math.min(1, (centerX - rect.left) / rect.width)) : 0.5;
      const ry = rect && rect.height > 0 ? Math.max(0, Math.min(1, (centerY - rect.top) / rect.height)) : 0.5;
      const cropBBox: CropBBox = rect && rect.width > 0 && rect.height > 0
        ? {
            x: Math.max(0, Math.min(1, (left - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (top - rect.top) / rect.height)),
            width: Math.max(0, Math.min(1, width / rect.width)),
            height: Math.max(0, Math.min(1, height / rect.height)),
            unit: 'page_ratio',
          }
        : { x: Math.max(0, rx - 0.25), y: Math.max(0, ry - 0.25), width: 0.5, height: 0.5, unit: 'page_ratio' };
      onCapture(cropCanvas.toDataURL('image/png'), rx, ry, cropBBox);
    } catch (err) {
      console.error('截图失败:', err);
      alert('截图失败，请重试');
    } finally {
      setIsCapturing(false);
    }
  }, [confirmed, startPos, endPos, onCapture]);

  const handleCancelSelection = () => {
    setConfirmed(false);
  };

  const handleCancel = () => {
    onCancel();
  };

  // ESC键：有选区时取消选区，无选区时退出
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmed) {
          handleCancelSelection();
        } else {
          handleCancel();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, confirmed]);

  // 阻止iframe上的鼠标事件
  useEffect(() => {
    if (!isActive) return;
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => {
      (iframe as HTMLIFrameElement).style.pointerEvents = 'none';
    });
    return () => {
      iframes.forEach(iframe => {
        (iframe as HTMLIFrameElement).style.pointerEvents = 'auto';
      });
    };
  }, [isActive]);

  const handleCropConfirm = (croppedBase64: string, rx: number, ry: number, cropBBox: CropBBox) => {
    setCropSrc(null);
    onCapture(croppedBase64, rx, ry, cropBBox);
  };

  const handleCropCancel = () => {
    setCropSrc(null);
    onCancel();
  };

  if (!isActive) return null;

  // 移动端：二段式截图裁剪
  if (isMobileTouch) {
    if (cropSrc) {
      return <ImageCropper src={cropSrc} onConfirm={handleCropConfirm} onCancel={handleCropCancel} />;
    }
    if (cropSrc === null) {
      return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30">
          <div className="bg-white px-6 py-4 rounded-lg shadow-xl text-center">
            <div className="text-red-500 mb-2">截图失败</div>
            <button onClick={handleCropCancel} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">返回</button>
          </div>
        </div>
      );
    }
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30">
        <div className="bg-white px-6 py-4 rounded-lg shadow-xl text-center">
          <div className="text-gray-700">正在截图...</div>
        </div>
      </div>
    );
  }

  // 桌面端：本页直接框选
  const left = Math.min(startPos.x, endPos.x);
  const top = Math.min(startPos.y, endPos.y);
  const width = Math.abs(endPos.x - startPos.x);
  const height = Math.abs(endPos.y - startPos.y);
  const selectionStyle = { left, top, width, height };

  return (
    <>
      {/* 半透明蒙层（截图前隐藏，防止被截进去） */}
      <div
        ref={maskRef}
        className="fixed inset-0 z-[9998]"
        style={{ cursor: isSelecting ? 'crosshair' : 'default', background: 'rgba(0,0,0,0.3)' }}
      />

      {/* 事件捕获层 */}
      <div
        className="fixed inset-0 z-[9999]"
        style={{ cursor: isSelecting ? 'crosshair' : 'default' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* 选区高亮（始终显示，小选区变红提示） */}
        {(isSelecting || confirmed) && width > 0 && height > 0 && (
          <>
            <div
              className={`absolute border-2 bg-transparent ${
                (isSelecting && (width < 20 || height < 20))
                  ? 'border-red-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.3)]'
                  : 'border-blue-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.3)]'
              }`}
              style={selectionStyle}
            />
            {/* 拖拽中且太小 → 浮动提示 */}
            {isSelecting && (width < 20 || height < 20) && (
              <div
                className="absolute z-[10000] bg-red-500 text-white text-xs px-2 py-1 rounded whitespace-nowrap"
                style={{ left: left + width / 2, top: top + height + 8, transform: 'translateX(-50%)' }}
              >
                选区太小，请框选更大区域
              </div>
            )}
          </>
        )}

        {/* 确认/取消按钮（独立层，阻止所有鼠标事件穿透） */}
        {confirmed && !isCapturing && (
          <>
            {/* 透明拦截层，防止按钮区域的鼠标事件穿透到选区蒙层 */}
            <div
              className="absolute z-[10000]"
              style={{
                left: left + width - 80, top: top + height + 8,
                width: 80, height: 40,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex gap-2 justify-end">
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); handleCancelSelection(); }}
                  className="w-8 h-8 rounded-full bg-white border border-slate-300 flex items-center justify-center text-slate-500 hover:bg-slate-100 shadow-lg text-sm"
                  title="取消选区"
                >
                  ✕
                </button>
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); handleConfirm(); }}
                  className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white hover:bg-blue-700 shadow-lg text-sm"
                  title="确认截图"
                >
                  ✓
                </button>
              </div>
            </div>
          </>
        )}

        {/* 加载提示 */}
        {isCapturing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="bg-white px-6 py-4 rounded-lg shadow-xl text-center">
              <div className="text-gray-700 mb-2">正在截取图片...</div>
            </div>
          </div>
        )}

        {/* 顶部提示 */}
        {!isCapturing && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap">
            {confirmed ? '点击 ✓ 确认截图，点击 ✕ 重新框选' : '拖动鼠标框选区域，按 ESC 取消'}
          </div>
        )}

        {/* 退出按钮 */}
        {!isCapturing && (
          <button
            onClick={(e) => { e.stopPropagation(); handleCancel(); }}
            className="absolute top-4 right-4 bg-black/70 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/90 transition-colors"
          >
            ✕
          </button>
        )}
      </div>
    </>
  );
}
