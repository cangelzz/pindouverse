import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { MARD_COLORS } from "../../data/mard221";
import { useEditorStore } from "../../store/editorStore";
import { getEffectiveRgb } from "../../utils/colorHelper";
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
  /** Re-run importBlueprint with new dims and replace the displayed result
   *  in place. Wired from App.tsx, which closes over the file path + bbox
   *  used for the original import. Omit to hide the in-dialog reimport UI. */
  onReimport?: (gridWidth: number, gridHeight: number) => Promise<BlueprintImportResult>;
}

export function BlueprintImportDialog({
  result: initialResult,
  onClose,
  onConfirm,
  onReimport,
}: BlueprintImportDialogProps) {
  // Display the most recent result — starts as the prop, updates after a
  // successful in-dialog reimport. Resets when the prop reference changes
  // (e.g., user closes + reopens with a different image).
  const [currentResult, setCurrentResult] = useState(initialResult);
  useEffect(() => { setCurrentResult(initialResult); }, [initialResult]);
  const result = currentResult;

  // Editable W/H — the inputs next to 「重新导入」. Kept in sync with
  // currentResult whenever the result changes (initial mount, after each
  // successful reimport, or when the prop swaps to a fresh image).
  const [editW, setEditW] = useState(initialResult.width);
  const [editH, setEditH] = useState(initialResult.height);
  useEffect(() => { setEditW(currentResult.width); setEditH(currentResult.height); }, [currentResult]);

  // Reimport busy state — distinct from the App.tsx-level blueprintImporting
  // overlay because we want a smaller inline spinner in the dialog header,
  // not a fullscreen blocker.
  const [reimportBusy, setReimportBusy] = useState(false);
  const [reimportError, setReimportError] = useState<string | null>(null);

  const handleReimport = useCallback(async () => {
    if (!onReimport) return;
    if (editW === currentResult.width && editH === currentResult.height) return;
    if (editW < 1 || editH < 1 || editW > 4096 || editH > 4096) {
      setReimportError("尺寸需在 1-4096 之间");
      return;
    }
    setReimportError(null);
    setReimportBusy(true);
    try {
      const r = await onReimport(editW, editH);
      setCurrentResult(r);
    } catch (e) {
      setReimportError(e instanceof Error ? e.message : String(e));
    } finally {
      setReimportBusy(false);
    }
  }, [onReimport, editW, editH, currentResult.width, currentResult.height]);

  const dimsDirty = editW !== currentResult.width || editH !== currentResult.height;

  const [selectedCell, setSelectedCell] = useState<[number, number] | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const gridRef = useRef<HTMLDivElement>(null);
  const colorOverrides = useEditorStore((s) => s.colorOverrides);

  // Drag-to-pan state
  const isDragging = useRef(false);
  const didDrag = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  // Color lookup from MARD palette (using user color overrides if any)
  const codeToColor = useMemo(() => {
    const map = new Map<string, { r: number; g: number; b: number; name: string }>();
    MARD_COLORS.forEach((c, i) => {
      if (c.rgb) {
        const [r, g, b] = getEffectiveRgb(i, colorOverrides);
        map.set(c.code, { r, g, b, name: c.name });
      }
    });
    return map;
  }, [colorOverrides]);

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
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-base font-semibold shrink-0">图纸导入预览</h2>
            <span className="text-xs text-gray-500 truncate">
              格子 {result.cell_size_detected}px · 置信度 {Math.round(result.confidence * 100)}%
            </span>
          </div>

          {/* In-place reimport: edit dims and re-run import without leaving
              the preview. Hidden when caller didn't wire onReimport. */}
          {onReimport && (
            <div className="flex items-center gap-1.5 text-xs shrink-0">
              <span className="text-gray-500">尺寸</span>
              <input
                type="number"
                min={1}
                max={4096}
                value={editW}
                disabled={reimportBusy}
                onChange={(e) => setEditW(parseInt(e.target.value) || 0)}
                className="w-16 px-1.5 py-0.5 border rounded text-center"
                aria-label="宽"
              />
              <span className="text-gray-400">×</span>
              <input
                type="number"
                min={1}
                max={4096}
                value={editH}
                disabled={reimportBusy}
                onChange={(e) => setEditH(parseInt(e.target.value) || 0)}
                className="w-16 px-1.5 py-0.5 border rounded text-center"
                aria-label="高"
              />
              <button
                onClick={handleReimport}
                disabled={!dimsDirty || reimportBusy}
                className={`px-2 py-0.5 rounded border ${
                  dimsDirty && !reimportBusy
                    ? "border-blue-400 text-blue-700 hover:bg-blue-50"
                    : "border-gray-300 text-gray-400 cursor-not-allowed"
                }`}
                title={dimsDirty ? "用新尺寸重新导入" : "尺寸未改动"}
              >
                {reimportBusy ? "重新导入中..." : "重新导入"}
              </button>
              {reimportError && (
                <span className="text-[10px] text-red-600 max-w-[16em] truncate" title={reimportError}>{reimportError}</span>
              )}
            </div>
          )}

          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none shrink-0">×</button>
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
