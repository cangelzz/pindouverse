import { useRef, useEffect, useState, useCallback } from 'react';
import type { CanvasData, GridConfig } from '@pindou/core';
import { renderPixels } from '@pindou/core';

interface Props {
  canvasData: CanvasData;
  gridConfig?: GridConfig;
  blueprintMode?: boolean;
  className?: string;
}

const DEFAULT_GRID: GridConfig = {
  groupSize: 5,
  edgePadding: 0,
  startX: 0,
  startY: 0,
  visible: true,
  lineColor: '#ccc',
  lineWidth: 0.5,
  groupLineColor: '#666',
  groupLineWidth: 1.5,
};

export default function BeadCanvas({ canvasData, gridConfig, blueprintMode = false, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const touchRef = useRef<{ startX: number; startY: number; startDist: number; startScale: number; tx: number; ty: number }>({
    startX: 0, startY: 0, startDist: 0, startScale: 1, tx: 0, ty: 0,
  });

  const rows = canvasData.length;
  const cols = rows > 0 ? canvasData[0].length : 0;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || rows === 0) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const baseCellSize = Math.min(cw / cols, ch / rows);
    const cellSize = baseCellSize * transform.scale;
    const totalW = cols * cellSize;
    const totalH = rows * cellSize;
    const ox = (cw - totalW) / 2 + transform.x;
    const oy = (ch - totalH) / 2 + transform.y;

    renderPixels(ctx, {
      canvasData,
      cellSize,
      offsetX: ox,
      offsetY: oy,
      viewWidth: cw,
      viewHeight: ch,
      blueprintMode,
    });

    // Draw grid
    const grid = gridConfig || DEFAULT_GRID;
    if (grid.visible) {
      ctx.save();
      for (let r = 0; r <= rows; r++) {
        const isGroup = r % grid.groupSize === 0;
        ctx.strokeStyle = isGroup ? grid.groupLineColor : grid.lineColor;
        ctx.lineWidth = isGroup ? grid.groupLineWidth : grid.lineWidth;
        ctx.beginPath();
        ctx.moveTo(ox, oy + r * cellSize);
        ctx.lineTo(ox + totalW, oy + r * cellSize);
        ctx.stroke();
      }
      for (let c = 0; c <= cols; c++) {
        const isGroup = c % grid.groupSize === 0;
        ctx.strokeStyle = isGroup ? grid.groupLineColor : grid.lineColor;
        ctx.lineWidth = isGroup ? grid.groupLineWidth : grid.lineWidth;
        ctx.beginPath();
        ctx.moveTo(ox + c * cellSize, oy);
        ctx.lineTo(ox + c * cellSize, oy + totalH);
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [canvasData, transform, blueprintMode, gridConfig, rows, cols]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  // Touch handlers
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchRef.current.startX = e.touches[0].clientX;
      touchRef.current.startY = e.touches[0].clientY;
      touchRef.current.tx = transform.x;
      touchRef.current.ty = transform.y;
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      touchRef.current.startDist = Math.hypot(dx, dy);
      touchRef.current.startScale = transform.scale;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - touchRef.current.startX;
      const dy = e.touches[0].clientY - touchRef.current.startY;
      setTransform(t => ({ ...t, x: touchRef.current.tx + dx, y: touchRef.current.ty + dy }));
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.hypot(dx, dy);
      const newScale = Math.max(0.5, Math.min(10, touchRef.current.startScale * (dist / touchRef.current.startDist)));
      setTransform(t => ({ ...t, scale: newScale }));
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full h-full overflow-hidden touch-none ${className}`}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove}>
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
