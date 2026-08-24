import { useState, useCallback, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';

import ImageCropper from './ImageCropper';
import type { CropBBox } from '../types';
import { useSelectionAdjust, type ResizeHandle } from '../hooks/useSelectionAdjust';

// 仅纯触屏设备（手机/平板）走 ImageCropper；触屏笔记本有精准指针走桌面框选
const isMobileTouch = window.matchMedia('(pointer: coarse)').matches
  && !window.matchMedia('(pointer: fine)').matches;

// 八向缩放句柄：n/s/e/w 组合表示方位，百分比定位让句柄贴合选区边框的各边/角
const RESIZE_HANDLES: { handle: ResizeHandle; left: string; top: string; cursor: string }[] = [
  { handle: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
  { handle: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
  { handle: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
  { handle: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
  { handle: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
  { handle: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
  { handle: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
  { handle: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
];

/** 框选确认后的去向：直接提问进聊天待发区，或 OCR 提取后进聊天编辑 */
export type CaptureAction = 'question' | 'edit';

interface Props {
  isActive: boolean;
  currentPage: number;
  onCapture: (imageData: string, pageRatioX: number, pageRatioY: number, cropBBox: CropBBox, action: CaptureAction) => void;
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

  // 确认态选区的拖移/缩放纯逻辑集中在 hook，这里只消费状态与事件
  const {
    selectionRect,
    confirmSelection,
    clearSelection,
    startMove,
    startResize,
    onMouseMove: onAdjustMove,
    onMouseUp: onAdjustUp,
  } = useSelectionAdjust();

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
    // 到达这里说明按下点不在已确认选区内（选区内部/手柄的 mousedown 已 stopPropagation）：
    // 无论当前处于何种状态，都丢弃旧选区、开始一次新框选
    clearSelection();
    setConfirmed(false);
    setIsSelecting(true);
    setStartPos({ x: e.clientX, y: e.clientY });
    setEndPos({ x: e.clientX, y: e.clientY });
  }, [clearSelection]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isSelecting) {
      setEndPos({ x: e.clientX, y: e.clientY });
    } else {
      onAdjustMove(e);
    }
  }, [isSelecting, onAdjustMove]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!isSelecting) {
      onAdjustUp(e);
      return;
    }
    setIsSelecting(false);

    const width = Math.abs(endPos.x - startPos.x);
    const height = Math.abs(endPos.y - startPos.y);

    if (width < 20 || height < 20) {
      setConfirmed(false);
      return;
    }
    // 选区有效 → 落成确认态矩形，显示确认按钮，不立即截图
    confirmSelection(Math.min(startPos.x, endPos.x), Math.min(startPos.y, endPos.y), width, height);
    setConfirmed(true);
  }, [isSelecting, startPos, endPos, onAdjustUp, confirmSelection]);

  const handleConfirm = useCallback(async (action: CaptureAction) => {
    if (!confirmed || !selectionRect) return;

    // 截图裁剪一律以确认态矩形为准：拖移/缩放后与用户所见完全一致
    const { left, top, width, height } = selectionRect;

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
        // 截图期间仍可见的覆盖层 UI（提示框、选区框）不能进结果图：
        // 用 data-capture-ignore 标记，让 html2canvas 克隆时直接跳过这些元素
        ignoreElements: (el) => !!el.closest('[data-capture-ignore]'),
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
      onCapture(cropCanvas.toDataURL('image/png'), rx, ry, cropBBox, action);
    } catch (err) {
      console.error('截图失败:', err);
      alert('截图失败，请重试');
    } finally {
      setIsCapturing(false);
    }
  }, [confirmed, selectionRect, currentPage, onCapture]);

  const handleCancelSelection = () => {
    setConfirmed(false);
    clearSelection();
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

  const handleCropConfirm = (croppedBase64: string, rx: number, ry: number, cropBBox: CropBBox, action: CaptureAction) => {
    setCropSrc(null);
    onCapture(croppedBase64, rx, ry, cropBBox, action);
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
            <button onClick={handleCropCancel} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">返回</button>
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
  // 框选进行中使用的临时几何（实时跟随鼠标）
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
        {/* 框选进行中的选区高亮（小选区变红提示），无交互 */}
        {isSelecting && width > 0 && height > 0 && (
          <>
            <div
              className={`absolute border-2 bg-transparent ${
                (width < 20 || height < 20)
                  ? 'border-red-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.3)]'
                  : 'border-indigo-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.3)]'
              }`}
              style={selectionStyle}
              data-capture-ignore
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

        {/* 确认态选区：内部按下移动、手柄按下缩放；两者都拦截 mousedown，避免触发重新框选 */}
        {confirmed && selectionRect && !isCapturing && (
          <>
            <div
              className="absolute border-2 border-indigo-400 bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.3)]"
              style={{
                left: selectionRect.left,
                top: selectionRect.top,
                width: selectionRect.width,
                height: selectionRect.height,
                cursor: 'move',
              }}
              data-capture-ignore
              onMouseDown={startMove}
            >
              {RESIZE_HANDLES.map(({ handle, left: hl, top: ht, cursor }) => (
                <div
                  key={handle}
                  className="absolute w-2.5 h-2.5 bg-white border border-indigo-500"
                  style={{ left: hl, top: ht, transform: 'translate(-50%, -50%)', cursor }}
                  data-capture-ignore
                  onMouseDown={(e) => startResize(e, handle)}
                />
              ))}
            </div>

            {/* 取消/提取编辑/提问按钮（独立层，阻止所有鼠标事件穿透） */}
            <div
              className="absolute z-[10000]"
              style={{
                left: selectionRect.left + selectionRect.width - 232,
                top: selectionRect.top + selectionRect.height + 8,
                width: 232,
                height: 40,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex gap-2 justify-end">
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); handleCancelSelection(); }}
                  className="rounded-lg bg-white border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 shadow-lg"
                  title="取消选区"
                >
                  取消
                </button>
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); void handleConfirm('edit'); }}
                  className="rounded-lg bg-white border border-indigo-300 px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 shadow-lg"
                  title="提取文字/公式并编辑"
                >
                  提取编辑
                </button>
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); void handleConfirm('question'); }}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 shadow-lg font-medium"
                  title="直接提问"
                >
                  提问
                </button>
              </div>
            </div>
          </>
        )}

        {/* 加载提示：截图期间必须可见给用户反馈，但绝不能进结果图（data-capture-ignore） */}
        {isCapturing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30" data-capture-ignore>
            <div className="bg-white px-6 py-4 rounded-lg shadow-xl text-center">
              <div className="text-gray-700 mb-2">正在截取图片...</div>
            </div>
          </div>
        )}

        {/* 顶部提示 */}
        {!isCapturing && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap">
            {confirmed ? '拖动选区或手柄可调整，📝 提取编辑 / ✓ 直接提问' : '拖动鼠标框选区域，按 ESC 取消'}
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
