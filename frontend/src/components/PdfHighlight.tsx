import { useEffect, useState } from 'react';

import type { TextbookId } from '../textbooks';

export interface NodeHighlight {
  page: number;
  bbox: [number, number, number, number]; // PDF 点坐标 [x0, y0, x1, y1]
  sim?: number;
  low_confidence?: boolean;
}

type HighlightMap = Record<string, NodeHighlight>;

const cache = new Map<string, Promise<HighlightMap>>();

function loadHighlights(textbookId: TextbookId): Promise<HighlightMap> {
  let p = cache.get(textbookId);
  if (!p) {
    p = fetch(`/highlights/${textbookId}.json`)
      .then(res => (res.ok ? (res.json() as Promise<HighlightMap>) : {}))
      .catch(() => ({}));
    cache.set(textbookId, p);
  }
  return p;
}

/** 按 node_id 查询高亮记录；低置信视为不可用（宁缺毋错） */
export async function getNodeHighlight(
  textbookId: string,
  nodeId: string,
): Promise<NodeHighlight | null> {
  if (!textbookId) return null;
  const map = await loadHighlights(textbookId as TextbookId);
  const entry = map[nodeId];
  if (!entry || entry.low_confidence) return null;
  if (!entry.page || !Array.isArray(entry.bbox) || entry.bbox.length !== 4) return null;
  return entry;
}

interface Props {
  textbookId: TextbookId;
  nodeId: string | null;
  currentPage: number;
  scale: number;
}

/**
 * PDF 页内高亮框：bbox 为 PDF 点坐标，乘以渲染 scale 得到像素。
 * 只在当前页与高亮页匹配时渲染，翻页/换教材后自动消失。
 */
export default function PdfHighlight({ textbookId, nodeId, currentPage, scale }: Props) {
  const [highlight, setHighlight] = useState<NodeHighlight | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!nodeId) {
      setHighlight(null);
      return;
    }
    void getNodeHighlight(textbookId, nodeId).then(entry => {
      if (!cancelled) setHighlight(entry);
    });
    return () => { cancelled = true; };
  }, [textbookId, nodeId]);

  if (!highlight || highlight.page !== currentPage) return null;

  const [x0, y0, x1, y1] = highlight.bbox;
  const width = Math.max(0, (x1 - x0) * scale);
  const height = Math.max(0, (y1 - y0) * scale);
  if (!width || !height) return null;

  return (
    <div
      data-testid="pdf-node-highlight"
      style={{
        position: 'absolute',
        left: x0 * scale,
        top: y0 * scale,
        width,
        height,
        background: 'rgba(250, 204, 21, 0.28)',
        border: '1.5px solid rgba(245, 158, 11, 0.75)',
        borderRadius: 4,
        pointerEvents: 'none',
        zIndex: 30,
      }}
    />
  );
}
