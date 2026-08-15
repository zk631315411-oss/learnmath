import { useCallback, useRef, useState } from 'react';

// 确认态选区的几何数据：视口坐标（px），截图裁剪与 cropBBox 换算都以此为准
export interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// 八向缩放句柄：n/s/e/w 分别代表上/下/右/左，单字符为边中点，双字符为角
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

// 选区最小尺寸：与框选校验的阈值保持一致，避免缩成不可用的细条
const MIN_SIZE = 20;

// 一次拖移/缩放过程中的起点信息。存 ref 而非 state：
// 渲染无需感知拖拽过程，只需按起点矩形 + 鼠标增量重算，可避免多余重渲染与闭包过期
interface DragState {
  type: 'move' | 'resize';
  handle: ResizeHandle | null; // 移动时为 null，缩放时为具体句柄
  startX: number;
  startY: number;
  rect: SelectionRect;         // 拖拽起点的矩形，按增量计算可避免累计误差
}

// 数值收敛到 [min, max] 区间
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// 移动：整体平移，边界 clamp 在视口内（不越出屏幕）
function applyMove(rect: SelectionRect, dx: number, dy: number): SelectionRect {
  return {
    ...rect,
    left: clamp(rect.left + dx, 0, window.innerWidth - rect.width),
    top: clamp(rect.top + dy, 0, window.innerHeight - rect.height),
  };
}

// 缩放：句柄所在边/角随光标移动，对边/对角固定；同时保证最小尺寸与视口边界
function applyResize(rect: SelectionRect, handle: ResizeHandle, cursorX: number, cursorY: number): SelectionRect {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  let left = rect.left;
  let top = rect.top;
  let newRight = right;
  let newBottom = bottom;

  if (handle.includes('w')) left = clamp(cursorX, 0, right - MIN_SIZE);
  if (handle.includes('e')) newRight = clamp(cursorX, rect.left + MIN_SIZE, window.innerWidth);
  if (handle.includes('n')) top = clamp(cursorY, 0, bottom - MIN_SIZE);
  if (handle.includes('s')) newBottom = clamp(cursorY, rect.top + MIN_SIZE, window.innerHeight);

  return { left, top, width: newRight - left, height: newBottom - top };
}

// 确认态选区的拖移/缩放逻辑：只承载状态与鼠标事件，渲染由 ScreenCapture 负责
export function useSelectionAdjust() {
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const dragRef = useRef<DragState | null>(null);

  // 框选校验通过后，把最终矩形落成确认态选区
  const confirmSelection = useCallback((left: number, top: number, width: number, height: number) => {
    dragRef.current = null;
    setSelectionRect({ left, top, width, height });
  }, []);

  // 丢弃选区（取消选区或重新框选前调用）
  const clearSelection = useCallback(() => {
    dragRef.current = null;
    setSelectionRect(null);
  }, []);

  // 选区内部按下 → 进入移动模式；stopPropagation 防止落到捕获层触发重新框选
  const startMove = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectionRect) return;
    dragRef.current = { type: 'move', handle: null, startX: e.clientX, startY: e.clientY, rect: selectionRect };
  }, [selectionRect]);

  // 手柄按下 → 进入缩放模式；同样拦截冒泡
  const startResize = useCallback((e: React.MouseEvent, handle: ResizeHandle) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectionRect) return;
    dragRef.current = { type: 'resize', handle, startX: e.clientX, startY: e.clientY, rect: selectionRect };
  }, [selectionRect]);

  // 捕获层上的 mousemove：仅在拖拽过程中更新选区
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.type === 'move') {
      setSelectionRect(applyMove(drag.rect, e.clientX - drag.startX, e.clientY - drag.startY));
    } else {
      setSelectionRect(applyResize(drag.rect, drag.handle!, e.clientX, e.clientY));
    }
  }, []);

  // 松开鼠标 → 结束本次拖移/缩放
  const onMouseUp = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = null;
  }, []);

  return { selectionRect, confirmSelection, clearSelection, startMove, startResize, onMouseMove, onMouseUp };
}
