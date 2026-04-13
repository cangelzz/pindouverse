import { useState, useMemo, useRef, useCallback } from "react";
import { MARD_COLORS } from "../../data/mard221";
import type { BlueprintImportResult, CellResult } from "../../adapters";

// ─── Helper: text contrast color ────────────────────────────────

function contrastColor(r: number, g: number, b: number): string {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 128 ? "#000" : "#fff";
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.95 ? "bg-green-500" : value >= 0.85 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-1">
      <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-gray-500 w-7 text-right">{pct}%</span>
    </div>
  );
}

// ─── Main dialog ────────────────────────────────────────────────

interface BlueprintImportDialogProps {
  result: BlueprintImportResult;
  onClose: () => void;
  onConfirm: (result: BlueprintImportResult) => void;
}

export function BlueprintImportDialog({
  result,
  onClose,
  onConfirm,
}: BlueprintImportDialogProps) {
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const gridRef = useRef<HTMLDivElement>(null);

  // Drag-to-pan state
  const isDragging = useRef(false);
  const didDrag = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  // Color lookup from MARD palette
  const codeToColor = useMemo(() => {
    const map = new Map<string, { r: number; g: number; b: number; name: string }>();
    for (const c of MARD_COLORS) {
      if (c.rgb) {
        map.set(c.code, { r: c.rgb[0], g: c.rgb[1], b: c.rgb[2], name: c.name });
      }
    }
    return map;
  }, []);

  // Cell size for rendering — base size adjusted by zoom
  const baseCellPx = result.width > 60 ? 18 : result.width > 30 ? 22 : 28;
  const cellPx = Math.round(baseCellPx * zoom);

  // Fit to window: calculate zoom to fit grid in container
  const fitToWindow = useCallback(() => {
    const container = gridRef.current;
    if (!container) return;
    const containerW = container.clientWidth - 24;
    const containerH = container.clientHeight - 24;
    const gridW = result.width * (baseCellPx + 1);
    const gridH = result.height * (baseCellPx + 1);
    const fitZoom = Math.min(containerW / gridW, containerH / gridH, 3.0);
    setZoom(Math.max(0.3, Math.min(fitZoom, 3.0)));
  }, [result.width, result.height, baseCellPx]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl flex flex-col"
        style={{ width: "min(92vw, 1200px)", height: "min(88vh, 800px)" }}>

        {/* ─── Header ─── */}
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold">图纸导入预览</h2>
            <span className="text-xs text-gray-500">
              {result.width}×{result.height} · 格子 {result.cell_size_detected}px ·
              置信度 {Math.round(result.confidence * 100)}%
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* ─── Toolbar ─── */}
        <div className="px-5 py-2 border-b bg-gray-50 flex items-center shrink-0">
          <div className="ml-auto flex items-center gap-1.5 text-xs">
            <button
              onClick={() => setZoom((z) => Math.max(0.3, z - 0.2))}
              className="w-6 h-6 flex items-center justify-center rounded border hover:bg-gray-100"
              title="缩小"
            >
              -
            </button>
            <span className="w-10 text-center text-gray-500">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(3.0, z + 0.2))}
              className="w-6 h-6 flex items-center justify-center rounded border hover:bg-gray-100"
              title="放大"
            >
              +
            </button>
            <button
              onClick={fitToWindow}
              className="px-2 py-1 rounded border hover:bg-gray-100 ml-1"
              title="适应窗口"
            >
              适应窗口
            </button>
            <button
              onClick={() => setZoom(1.0)}
              className="px-2 py-1 rounded border hover:bg-gray-100"
              title="重置缩放"
            >
              1:1
            </button>
          </div>
        </div>

        {/* ─── Main content ─── */}
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* Grid area */}
          <div
            className="flex-1 overflow-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            ref={gridRef}
            style={{ cursor: isDragging.current ? "grabbing" : "grab" }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              const container = gridRef.current;
              if (!container) return;
              isDragging.current = true;
              didDrag.current = false;
              dragStart.current = {
                x: e.clientX,
                y: e.clientY,
                scrollLeft: container.scrollLeft,
                scrollTop: container.scrollTop,
              };
              e.preventDefault();
            }}
            onMouseMove={(e) => {
              if (!isDragging.current) return;
              const container = gridRef.current;
              if (!container) return;
              const dx = e.clientX - dragStart.current.x;
              const dy = e.clientY - dragStart.current.y;
              if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                didDrag.current = true;
              }
              container.scrollLeft = dragStart.current.scrollLeft - dx;
              container.scrollTop = dragStart.current.scrollTop - dy;
            }}
            onMouseUp={() => { isDragging.current = false; }}
            onMouseLeave={() => { isDragging.current = false; }}
            onWheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                setZoom((z) => Math.max(0.3, Math.min(3.0, z + (e.deltaY > 0 ? -0.1 : 0.1))));
              }
            }}
          >
            <div
              className="inline-grid gap-px bg-gray-300"
              style={{
                gridTemplateColumns: `repeat(${result.width}, ${cellPx}px)`,
                gridTemplateRows: `repeat(${result.height}, ${cellPx}px)`,
              }}
            >
              {result.cells.flatMap((row, ri) =>
                row.map((cell, ci) => {
                  const color = codeToColor.get(cell.final_code);
                  const isSelected =
                    selectedCell && selectedCell[0] === ri && selectedCell[1] === ci;

                  const bg = color
                    ? `rgb(${color.r},${color.g},${color.b})`
                    : "#fff";
                  const fg = color ? contrastColor(color.r, color.g, color.b) : "#ccc";

                  return (
                    <div
                      key={`${ri}-${ci}`}
                      onClick={() => { if (!didDrag.current) setSelectedCell([ri, ci]); }}
                      className={`
                        flex items-center justify-center cursor-pointer
                        text-[7px] font-mono leading-none select-none
                        ${isSelected ? "ring-2 ring-blue-500 z-10 scale-[1.3]" : ""}
                      `}
                      style={{
                        backgroundColor: bg,
                        color: fg,
                        width: cellPx,
                        height: cellPx,
                      }}
                      title={
                        cell.final_code
                          ? `${cell.final_code} (${Math.round(cell.color_confidence * 100)}%)`
                          : "空"
                      }
                    >
                      {cellPx >= 22 && cell.final_code ? cell.final_code : ""}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ─── Sidebar ──�� */}
          <div className="w-64 border-l flex flex-col shrink-0 overflow-hidden">
            {selectedCell ? (
              <CellDetailPanel
                cell={result.cells[selectedCell[0]][selectedCell[1]]}
                row={selectedCell[0]}
                col={selectedCell[1]}
                codeToColor={codeToColor}
              />
            ) : (
              <div className="p-4 text-center text-xs text-gray-400">
                点击格子查看颜色信息
              </div>
            )}
          </div>
        </div>

        {/* ─── Footer ─── */}
        <div className="px-5 py-3 border-t flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(result)}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            确认导入
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Cell detail panel ──────────────────────────────────────────

function CellDetailPanel({
  cell,
  row,
  col,
  codeToColor,
}: {
  cell: CellResult;
  row: number;
  col: number;
  codeToColor: Map<string, { r: number; g: number; b: number; name: string }>;
}) {
  if (!cell.final_code) {
    return (
      <div className="p-3 border-b bg-gray-50">
        <div className="text-xs text-gray-400">单元格 ({row + 1}, {col + 1}) — 空</div>
      </div>
    );
  }

  const colorInfo = codeToColor.get(cell.color_code);

  return (
    <div className="p-3 border-b bg-gray-50 space-y-2">
      <div className="text-xs font-medium text-gray-700">
        单元格 ({row + 1}, {col + 1})
      </div>
      <div className="flex items-center gap-2 text-xs">
        <div
          className="w-6 h-6 rounded border border-gray-300 shrink-0"
          style={{
            backgroundColor: colorInfo
              ? `rgb(${colorInfo.r},${colorInfo.g},${colorInfo.b})`
              : "#ccc",
          }}
        />
        <div className="min-w-0">
          <div className="font-medium">{cell.color_code}</div>
          <div className="text-gray-500 truncate">{colorInfo?.name || ""}</div>
          <ConfidenceBar value={cell.color_confidence} />
        </div>
      </div>
    </div>
  );
}
