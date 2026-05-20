import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { useEditorStore } from "../../store/editorStore";
import { getEffectiveHex } from "../../utils/colorHelper";
import type { CanvasData, CanvasSize } from "../../types";
import type { ColorOverrideMap } from "../../utils/colorHelper";
import { computeChangeStats } from "./changeStats";
export type { ChangeStats } from "./changeStats";
export { computeChangeStats } from "./changeStats";

const MIN_CANVAS = 200;
const MAX_CANVAS = 600;

function renderView(
  canvas: HTMLCanvasElement,
  data: CanvasData,
  gridW: number,
  gridH: number,
  zoom: number,
  panX: number,
  panY: number,
  colorOverrides: ColorOverrideMap,
  viewSize: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = viewSize;
  canvas.height = viewSize;

  ctx.fillStyle = "#e5e5e5";
  ctx.fillRect(0, 0, viewSize, viewSize);

  const cellSize = zoom;
  const startCol = Math.max(0, Math.floor(-panX / cellSize));
  const startRow = Math.max(0, Math.floor(-panY / cellSize));
  const endCol = Math.min(gridW, Math.ceil((viewSize - panX) / cellSize));
  const endRow = Math.min(gridH, Math.ceil((viewSize - panY) / cellSize));

  for (let r = startRow; r < endRow; r++) {
    for (let c = startCol; c < endCol; c++) {
      const cell = data[r]?.[c];
      if (cell?.colorIndex != null) {
        ctx.fillStyle = getEffectiveHex(cell.colorIndex, colorOverrides);
        ctx.fillRect(c * cellSize + panX, r * cellSize + panY, cellSize, cellSize);
      }
    }
  }

  if (cellSize >= 8) {
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 0.5;
    for (let c = startCol; c <= endCol; c++) {
      const x = c * cellSize + panX;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, viewSize); ctx.stroke();
    }
    for (let r = startRow; r <= endRow; r++) {
      const y = r * cellSize + panY;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(viewSize, y); ctx.stroke();
    }
  }
}

export interface ChangesCompareDialogProps {
  onClose: () => void;
  /** Override baseline. When omitted, reads store.baselineCanvasData. */
  baselineData?: CanvasData;
  /** Canvas size of the baseline. When omitted, assumes the same size as the current canvas. */
  baselineSize?: CanvasSize;
  /** Override label above the baseline view. Default: "基准版本". */
  baselineLabel?: string;
  /** Override label above the current view. Default: "当前版本". */
  currentLabel?: string;
  /** Dialog title. Default: "变更对比". */
  title?: string;
}

export function ChangesCompareDialog({
  onClose,
  baselineData: baselineDataProp,
  baselineSize: baselineSizeProp,
  baselineLabel = "基准版本",
  currentLabel = "当前版本",
  title = "变更对比",
}: ChangesCompareDialogProps) {
  const canvasData = useEditorStore((s) => s.canvasData);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const storeBaselineCanvasData = useEditorStore((s) => s.baselineCanvasData);
  const colorOverrides = useEditorStore((s) => s.colorOverrides);

  const baselineData = baselineDataProp ?? storeBaselineCanvasData;
  const baselineSize: CanvasSize = baselineSizeProp ?? canvasSize;

  // Union size — both views render against the same axes
  const viewW = Math.max(canvasSize.width, baselineSize.width);
  const viewH = Math.max(canvasSize.height, baselineSize.height);
  const sizesDiffer =
    canvasSize.width !== baselineSize.width ||
    canvasSize.height !== baselineSize.height;

  const baselineRef = useRef<HTMLCanvasElement>(null);
  const currentRef = useRef<HTMLCanvasElement>(null);

  const [viewSize, setViewSize] = useState(320);

  const fitZoom = Math.min(viewSize / viewW, viewSize / viewH);
  const [zoom, setZoom] = useState(fitZoom);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });

  useEffect(() => {
    const z = Math.min(viewSize / viewW, viewSize / viewH);
    setZoom(z);
    setPanX((viewSize - viewW * z) / 2);
    setPanY((viewSize - viewH * z) / 2);
  }, [viewW, viewH, viewSize]);

  const stats = useMemo(
    () => computeChangeStats(canvasData, baselineData, viewW, viewH),
    [canvasData, baselineData, viewW, viewH],
  );

  useEffect(() => {
    if (baselineRef.current && baselineData) {
      renderView(baselineRef.current, baselineData, viewW, viewH, zoom, panX, panY, colorOverrides, viewSize);
    }
    if (currentRef.current) {
      renderView(currentRef.current, canvasData, viewW, viewH, zoom, panX, panY, colorOverrides, viewSize);
    }
  }, [canvasData, baselineData, viewW, viewH, colorOverrides, zoom, panX, panY, viewSize]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
  }, [panX, panY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setPanX(dragStart.current.px + (e.clientX - dragStart.current.x));
    setPanY(dragStart.current.py + (e.clientY - dragStart.current.y));
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.5, Math.min(50, zoom * factor));
    setPanX(mx - (mx - panX) * (newZoom / zoom));
    setPanY(my - (my - panY) * (newZoom / zoom));
    setZoom(newZoom);
  }, [zoom, panX, panY]);

  const total = stats.added + stats.removed + stats.modified;
  const zoomPct = Math.round((zoom / fitZoom) * 100);

  const canvasProps = {
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
    onMouseLeave: handleMouseUp,
    onWheel: handleWheel,
    style: { width: viewSize, height: viewSize, cursor: isDragging.current ? "grabbing" : "grab" } as React.CSSProperties,
    className: "border rounded",
  };

  const isResizing = useRef(false);
  const resizeStart = useRef({ x: 0, size: 0 });
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    resizeStart.current = { x: e.clientX, size: viewSize };
    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = ev.clientX - resizeStart.current.x;
      setViewSize(Math.max(MIN_CANVAS, Math.min(MAX_CANVAS, resizeStart.current.size + delta / 2)));
    };
    const onUp = () => {
      isResizing.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [viewSize]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl relative" style={{ width: viewSize * 2 + 80 }}>
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-sm">{title}</h2>
            {sizesDiffer && (
              <span className="text-[10px] text-gray-400">
                尺寸 {baselineSize.width}×{baselineSize.height} → {canvasSize.width}×{canvasSize.height}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{zoomPct}%</span>
            <button
              onClick={() => {
                const z = fitZoom;
                setZoom(z);
                setPanX((viewSize - viewW * z) / 2);
                setPanY((viewSize - viewH * z) / 2);
              }}
              className="px-1.5 py-0.5 rounded border hover:bg-gray-100 text-[10px]"
            >
              适应
            </button>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <div className="flex gap-4 p-4 justify-center">
          <div className="text-center">
            <div className="text-[10px] text-gray-500 mb-1">{baselineLabel}</div>
            <canvas ref={baselineRef} {...canvasProps} />
          </div>
          <div className="text-center">
            <div className="text-[10px] text-gray-500 mb-1">{currentLabel}</div>
            <canvas ref={currentRef} {...canvasProps} />
          </div>
        </div>
        <div className="px-4 pb-3 flex items-center justify-between">
          <div className="flex gap-3 text-xs">
            {total === 0 ? (
              <span className="text-gray-400">无变更</span>
            ) : (
              <>
                {stats.added > 0 && <span className="text-green-600">+{stats.added} 新增</span>}
                {stats.removed > 0 && <span className="text-red-500">-{stats.removed} 删除</span>}
                {stats.modified > 0 && <span className="text-orange-500">~{stats.modified} 修改</span>}
                <span className="text-gray-400">共 {total} 处变更</span>
              </>
            )}
          </div>
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100">关闭</button>
        </div>
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          style={{ background: "linear-gradient(135deg, transparent 50%, #ccc 50%)" }}
        />
      </div>
    </div>
  );
}
