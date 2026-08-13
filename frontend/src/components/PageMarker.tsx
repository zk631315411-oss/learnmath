import { useMemo, useEffect, useState } from 'react';
import type { CropBBox } from '../types';

export interface Marker {
  id: string;
  page_number: number;
  marker_y_ratio: number;
  marker_type: 'screenshot' | 'text';
  thumbnail?: string | null;
  crop_bbox?: CropBBox | string | null;
  screenshot_context_id?: string | null;
  question: string;
  answer: string | null;  // null = AI 思考中
  thinking: string | null;  // AI 思维链
  follow_ups: Array<{
    question: string;
    answer: string | null;
    thinking: string | null;
    image?: string | null;
    crop_bbox?: CropBBox | string | null;
    screenshot_context_id?: string | null;
  }>;
}

interface Props {
  markers: Marker[];
  currentPage: number;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  containerHeight?: number;
  onMarkerClick: (marker: Marker) => void;
}

const MIN_GAP = 36;
const MARKER_SIZE_DESKTOP = 24;
const MARKER_SIZE_MOBILE = 18;

function useIsDesktop() {
  const [v, setV] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const h = (e: MediaQueryListEvent) => setV(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return v;
}

export default function PageMarker({ markers, currentPage, containerHeight: heightProp, onMarkerClick }: Props) {
  const isDesktop = useIsDesktop();
  // Prefer prop (passed from PDFViewer via ResizeObserver on container div).
  // Fallback to DOM query only if prop not yet available.
  const [domHeight, setDomHeight] = useState(0);
  const containerHeight = heightProp || domHeight;

  useEffect(() => {
    const page = document.querySelector('.react-pdf__Page');
    if (!page || heightProp) return; // prop available, no fallback needed
    const el = page as HTMLElement;
    setDomHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setDomHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [heightProp]);

  const placed = useMemo(() => {
    const pageMarkers = markers.filter(m => m.page_number === currentPage);
    if (!pageMarkers.length || !containerHeight) return { left: [], right: [] };

    const placeSide = (list: Marker[]) => {
      const sorted = [...list].sort((a, b) => a.marker_y_ratio - b.marker_y_ratio);
      const result: Array<{ marker: Marker; y_px: number }> = [];
      let lastY = -MIN_GAP;

      for (const m of sorted) {
        const ratio = Math.max(0, Math.min(100, m.marker_y_ratio ?? 50));
        let y = (ratio / 100) * containerHeight;
        if (y - lastY < MIN_GAP) y = lastY + MIN_GAP;
        // 超出容器 → 截断
        if (y > containerHeight - 12) break;
        result.push({ marker: m, y_px: y });
        lastY = y;
      }
      return result;
    };

    return {
      left: placeSide(pageMarkers.filter(m => m.marker_type === 'text')),
      right: placeSide(pageMarkers.filter(m => m.marker_type === 'screenshot')),
    };
  }, [markers, currentPage, containerHeight]);

  if (!placed.left.length && !placed.right.length) return null;

  const size = isDesktop ? MARKER_SIZE_DESKTOP : MARKER_SIZE_MOBILE;

  const renderBadge = (
    m: Marker, y_px: number, side: 'left' | 'right',
    colorClass: string, index: number,
  ) => {
    // 平板左侧留 20px 避免被 ChatPanel 遮挡
    const leftInset = isDesktop ? 8 : 20;
    const rightInset = isDesktop ? 8 : 8;
    const posStyle: React.CSSProperties = side === 'left'
      ? { left: leftInset, top: y_px }
      : { right: rightInset, top: y_px };

    // 触摸设备扩大点击热区
    const hitPadding = isDesktop ? 0 : 12;

    return (
      <div
        key={m.id}
        className={`absolute z-40 rounded-full flex items-center justify-center text-white text-xs font-bold cursor-pointer transition-transform hover:scale-110 shadow-md ${colorClass}`}
        style={{
          width: size,
          height: size,
          padding: hitPadding,
          margin: hitPadding ? -hitPadding : 0,
          pointerEvents: 'auto',
          ...posStyle,
          // 统一半透明白底，确保在 PDF 内容上可辨认
          background: colorClass === 'bg-red-500' ? 'rgba(239,68,68,0.85)' : 'rgba(59,130,246,0.85)',
        }}
        onClick={(e) => { e.stopPropagation(); onMarkerClick(m); }}
        title={`第${m.page_number}页 · ${m.question.slice(0, 30)}`}
      >
        {m.marker_type === 'screenshot'
          ? ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'][index] || String(index + 1)
          : String(index + 1)}
      </div>
    );
  };

  return (
    <div style={{
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      pointerEvents: 'none',
      zIndex: 40,
    }}>
      {placed.left.map((p, i) =>
        renderBadge(p.marker, p.y_px, 'left', 'bg-blue-500', i)
      )}
      {placed.right.map((p, i) =>
        renderBadge(p.marker, p.y_px, 'right', 'bg-red-500', i)
      )}
    </div>
  );
}
