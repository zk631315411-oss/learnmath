import { Eraser, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Props = { disabled?: boolean; onRecognize: (dataUrl: string) => Promise<void> };
type Point = { x: number; y: number };

export default function HandwritingCanvas({ disabled, onRecognize }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Point[][]>([]);
  const [drawing, setDrawing] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const redraw = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    ctx.strokeStyle = '#111827'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const stroke of strokesRef.current) {
      if (!stroke.length) continue;
      if (stroke.length === 1) { ctx.beginPath(); ctx.arc(stroke[0].x, stroke[0].y, 1.5, 0, Math.PI * 2); ctx.fillStyle = '#111827'; ctx.fill(); continue; }
      ctx.beginPath(); ctx.moveTo(stroke[0].x, stroke[0].y);
      for (const point of stroke.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    void rect;
  };
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); redraw(); };
    resize(); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  const point = (event: React.PointerEvent<HTMLCanvasElement>): Point => { const rect = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => { if (disabled || recognizing) return; try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic/test pointers may not be active */ } strokesRef.current.push([point(event)]); setStrokeCount(strokesRef.current.length); setDrawing(true); redraw(); };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const stroke = strokesRef.current[strokesRef.current.length - 1]; if (!stroke) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const coalesced = event.nativeEvent.getCoalescedEvents?.() || [event.nativeEvent];
    coalesced.forEach(sample => stroke.push({ x: sample.clientX - rect.left, y: sample.clientY - rect.top }));
    redraw();
  };
  const end = () => setDrawing(false);
  const clear = () => { strokesRef.current = []; setStrokeCount(0); redraw(); };
  const undo = () => { strokesRef.current.pop(); setStrokeCount(strokesRef.current.length); redraw(); };
  const exportCrop = (): string | null => {
    const canvas = canvasRef.current; if (!canvas || !strokesRef.current.length) return null;
    const dpr = window.devicePixelRatio || 1; const ctx = canvas.getContext('2d'); if (!ctx) return null;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height); let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
    for (let y = 0; y < canvas.height; y += 2) for (let x = 0; x < canvas.width; x += 2) { const i = (y * canvas.width + x) * 4; if (image.data[i] < 245 || image.data[i + 1] < 245 || image.data[i + 2] < 245) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); } }
    if (maxX <= minX || maxY <= minY) return null;
    const pad = Math.round(16 * dpr); minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(canvas.width, maxX + pad); maxY = Math.min(canvas.height, maxY + pad);
    const out = document.createElement('canvas'); out.width = maxX - minX; out.height = maxY - minY; const outCtx = out.getContext('2d'); if (!outCtx) return null; outCtx.fillStyle = '#fff'; outCtx.fillRect(0, 0, out.width, out.height); outCtx.drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height); return out.toDataURL('image/png');
  };
  const recognize = async () => { const data = exportCrop(); if (!data || recognizing) return; setRecognizing(true); try { await onRecognize(data); } finally { setRecognizing(false); } };
  return <div className="handwriting-canvas-panel">
    <canvas ref={canvasRef} className="handwriting-canvas" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-label="手写公式画板" />
    <div className="handwriting-actions">
      <button type="button" onClick={undo} disabled={!strokeCount || recognizing} title="撤销上一笔" aria-label="撤销上一笔"><RotateCcw size={14} />撤销</button>
      <button type="button" onClick={clear} disabled={!strokeCount || recognizing} title="清空画布" aria-label="清空画布"><Trash2 size={14} />清空</button>
      <button type="button" onClick={() => void recognize()} disabled={!strokeCount || recognizing} title="识别手写公式" aria-label="识别手写公式">{recognizing ? <LoaderCircle size={14} className="animate-spin" /> : <Eraser size={14} />}识别</button>
    </div>
  </div>;
}
