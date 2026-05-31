import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImagePreview } from "../../adapters";

interface BBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Props {
  filePath: string;
  detectedWidth: number;
  detectedHeight: number;
  detectedBBox: BBox;
  hasMetadata: boolean;
  preview: ImagePreview;
  /** Re-run quick detection with a user-provided bbox. Returns updated dims
   * + the actual bbox the backend used (may be lightly snapped). */
  onRedetect: (
    bbox: BBox,
    opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal },
  ) => Promise<{
    width: number;
    height: number;
    cellSize: number;
    bbox: BBox;
    hasMetadata: boolean;
  }>;
  onConfirm: (width: number, height: number, bbox: BBox) => void;
  onCancel: () => void;
}

type Drag =
  | { kind: "move"; startX: number; startY: number; orig: BBox }
  | { kind: "resize"; corner: "tl" | "tr" | "bl" | "br"; startX: number; startY: number; orig: BBox };

const HANDLE_SIZE = 10;

/**
 * Pre-import confirmation step for blueprint import.
 *
 * Left: source thumbnail with a draggable rectangle overlay showing the
 * detected grid bbox. The user can move/resize the rectangle to refine the
 * detection region and click "用此范围重新识别" to re-run the fast detector.
 *
 * Right: editable width/height inputs prefilled with the detected dims, plus
 * status messages (✓ metadata or ⚠ BETA warning).
 */
export function BlueprintDimsConfirmDialog({
  filePath,
  detectedWidth,
  detectedHeight,
  detectedBBox,
  hasMetadata,
  preview,
  onRedetect,
  onConfirm,
  onCancel,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(detectedWidth);
  const [h, setH] = useState(detectedHeight);
  const [bbox, setBBox] = useState<BBox>(detectedBBox);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busyStage, setBusyStage] = useState("");
  const [busyFraction, setBusyFraction] = useState(0);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const busy = abortController !== null;
  const [redetectError, setRedetectError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState(hasMetadata);

  // Scale factor between original-image pixels and preview-display pixels.
  const scale = useMemo(() => {
    return preview.preview_width / preview.original_width;
  }, [preview]);

  // Render the original image preview onto a canvas. The adapter's
  // previewImage returns pixels as a flat RGB Uint8 array (3 bytes per
  // pixel, no alpha), so we expand to RGBA on the fly.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { preview_width: pw, preview_height: ph, pixels } = preview;
    canvas.width = pw;
    canvas.height = ph;
    const id = ctx.createImageData(pw, ph);
    for (let i = 0; i < pw * ph; i++) {
      id.data[i * 4]     = pixels[i * 3];
      id.data[i * 4 + 1] = pixels[i * 3 + 1];
      id.data[i * 4 + 2] = pixels[i * 3 + 2];
      id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
  }, [preview]);

  // Mouse handlers operate in preview-pixel coords; we convert to original-
  // image pixel coords when storing in `bbox`.
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / scale;
    const dy = (e.clientY - drag.startY) / scale;
    if (drag.kind === "move") {
      const widthOrig = preview.original_width;
      const heightOrig = preview.original_height;
      const w0 = drag.orig.right - drag.orig.left;
      const h0 = drag.orig.bottom - drag.orig.top;
      let newLeft = Math.round(drag.orig.left + dx);
      let newTop = Math.round(drag.orig.top + dy);
      newLeft = Math.max(0, Math.min(newLeft, widthOrig - w0));
      newTop = Math.max(0, Math.min(newTop, heightOrig - h0));
      setBBox({ left: newLeft, top: newTop, right: newLeft + w0, bottom: newTop + h0 });
    } else {
      let { left, top, right, bottom } = drag.orig;
      if (drag.corner === "tl") { left = Math.round(drag.orig.left + dx); top = Math.round(drag.orig.top + dy); }
      if (drag.corner === "tr") { right = Math.round(drag.orig.right + dx); top = Math.round(drag.orig.top + dy); }
      if (drag.corner === "bl") { left = Math.round(drag.orig.left + dx); bottom = Math.round(drag.orig.bottom + dy); }
      if (drag.corner === "br") { right = Math.round(drag.orig.right + dx); bottom = Math.round(drag.orig.bottom + dy); }
      // Keep a minimum 20-px box and stay inside the image.
      left = Math.max(0, Math.min(left, right - 20));
      top = Math.max(0, Math.min(top, bottom - 20));
      right = Math.max(left + 20, Math.min(right, preview.original_width));
      bottom = Math.max(top + 20, Math.min(bottom, preview.original_height));
      setBBox({ left, top, right, bottom });
    }
  }, [drag, scale, preview.original_width, preview.original_height]);

  const onMouseUp = useCallback(() => setDrag(null), []);

  useEffect(() => {
    if (!drag) return;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [drag, onMouseMove, onMouseUp]);

  const startMove = (e: React.MouseEvent) => {
    e.preventDefault();
    setDrag({ kind: "move", startX: e.clientX, startY: e.clientY, orig: bbox });
  };
  const startResize = (corner: "tl" | "tr" | "bl" | "br") => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag({ kind: "resize", corner, startX: e.clientX, startY: e.clientY, orig: bbox });
  };

  const bboxDirty =
    bbox.left !== detectedBBox.left ||
    bbox.top !== detectedBBox.top ||
    bbox.right !== detectedBBox.right ||
    bbox.bottom !== detectedBBox.bottom;

  const handleRedetect = async () => {
    const controller = new AbortController();
    setAbortController(controller);
    setBusyStage("");
    setBusyFraction(0);
    setRedetectError(null);
    try {
      const r = await onRedetect(bbox, {
        onProgress: (stage, frac) => {
          setBusyStage(stage);
          setBusyFraction(frac);
        },
        signal: controller.signal,
      });
      setW(r.width);
      setH(r.height);
      setBBox(r.bbox);
      setMetadata(r.hasMetadata);
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setRedetectError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setAbortController(null);
    }
  };

  const valid = w > 0 && h > 0 && w <= 4096 && h <= 4096;
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;

  // Overlay rectangle position in preview-pixel coords.
  const ovStyle = {
    left: bbox.left * scale,
    top: bbox.top * scale,
    width: (bbox.right - bbox.left) * scale,
    height: (bbox.bottom - bbox.top) * scale,
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-[55]"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bg-white rounded-lg shadow-xl w-[760px] max-w-[94vw] max-h-[92vh] flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold">确认图纸尺寸</h2>
          <span
            className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold tracking-wider"
            title="自动识别尚在实验阶段，请核对网格尺寸是否准确"
          >
            BETA
          </span>
        </div>

        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          <div className="flex gap-4">
            {/* Thumbnail + bbox overlay */}
            <div className="shrink-0 flex flex-col gap-2">
              <div
                ref={overlayRef}
                className="relative border border-gray-300 rounded bg-gray-50 overflow-hidden"
                style={{ width: preview.preview_width, height: preview.preview_height }}
              >
                <canvas ref={canvasRef} className="block" />
                {/* BBox rectangle */}
                <div
                  className="absolute border-2 border-blue-500 bg-blue-500/10 cursor-move"
                  style={ovStyle}
                  onMouseDown={startMove}
                >
                  {/* 4 corner handles */}
                  {(["tl", "tr", "bl", "br"] as const).map((corner) => {
                    const off = -HANDLE_SIZE / 2;
                    const pos: React.CSSProperties = { width: HANDLE_SIZE, height: HANDLE_SIZE };
                    if (corner === "tl") { pos.left = off; pos.top = off; pos.cursor = "nwse-resize"; }
                    if (corner === "tr") { pos.right = off; pos.top = off; pos.cursor = "nesw-resize"; }
                    if (corner === "bl") { pos.left = off; pos.bottom = off; pos.cursor = "nesw-resize"; }
                    if (corner === "br") { pos.right = off; pos.bottom = off; pos.cursor = "nwse-resize"; }
                    return (
                      <div
                        key={corner}
                        onMouseDown={startResize(corner)}
                        className="absolute bg-white border-2 border-blue-500 rounded-sm"
                        style={pos}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="text-[10px] text-gray-400 leading-tight">
                拖动蓝框移动 / 拖角点调整。<br />
                bbox: {bbox.left}, {bbox.top} → {bbox.right}, {bbox.bottom}
                {" "}({bbox.right - bbox.left}×{bbox.bottom - bbox.top} px)
              </div>
            </div>

            {/* Right column */}
            <div className="flex-1 flex flex-col gap-3 min-w-0">
              <div className="text-[11px] text-gray-500 truncate" title={filePath}>
                {fileName}
              </div>
              <div className="text-[10px] text-gray-400">
                原图 {preview.original_width} × {preview.original_height} px
              </div>

              {metadata && (
                <div className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1.5 flex items-center gap-1">
                  <span>✓</span>
                  <span>检测到本软件生成的精确元数据 · 导入将 100% 还原</span>
                </div>
              )}

              <div>
                <div className="text-[11px] text-gray-500 mb-1">
                  自动识别尺寸{metadata ? "（来自元数据）" : "（来自图像检测）"}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={4096}
                    value={w}
                    onChange={(e) => setW(parseInt(e.target.value) || 0)}
                    className="w-20 px-2 py-1 text-sm border rounded text-center"
                    aria-label="网格宽度"
                  />
                  <span className="text-gray-400 text-sm">×</span>
                  <input
                    type="number"
                    min={1}
                    max={4096}
                    value={h}
                    onChange={(e) => setH(parseInt(e.target.value) || 0)}
                    className="w-20 px-2 py-1 text-sm border rounded text-center"
                    aria-label="网格高度"
                  />
                  <span className="text-[10px] text-gray-400 ml-1">格 (宽 × 高)</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <button
                  onClick={handleRedetect}
                  disabled={busy}
                  className={`self-start px-3 py-1 text-xs border rounded ${
                    bboxDirty && !busy
                      ? "border-blue-400 text-blue-700 hover:bg-blue-50"
                      : "border-gray-300 text-gray-500"
                  } ${busy ? "opacity-60 cursor-wait" : ""}`}
                  title={bboxDirty ? "用蓝框范围重新识别" : "蓝框未改动"}
                >
                  {busy ? "正在重新识别..." : "用此范围重新识别"}
                </button>
                {busy && (
                  <div className="flex items-center gap-2 text-[11px] mt-1">
                    <div className="flex-1 h-1.5 bg-gray-200 rounded overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round(busyFraction * 100)}%` }} />
                    </div>
                    <span className="text-gray-500 shrink-0 min-w-[8em] truncate" title={busyStage}>{busyStage}</span>
                    <button
                      onClick={() => abortController?.abort()}
                      className="px-2 py-0.5 border border-red-300 text-red-600 rounded text-[11px] hover:bg-red-50"
                    >取消</button>
                  </div>
                )}
                {redetectError && (
                  <div className="text-[10px] text-red-600">{redetectError}</div>
                )}
              </div>

              {!metadata && (
                <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  ⚠ 自动识别对于非本软件导出的图纸（特别是 JPEG 压缩 / 第三方拼豆软件）
                  可能不准。可拖拽缩略图上的蓝框圈选实际网格区域，再点「用此范围重新识别」。
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1 rounded border text-sm hover:bg-gray-100"
          >
            取消
          </button>
          <button
            onClick={() => { if (valid) onConfirm(w, h, bbox); }}
            disabled={!valid || busy}
            className={`px-3 py-1 rounded text-sm text-white ${
              valid && !busy ? "bg-blue-500 hover:bg-blue-600" : "bg-blue-300 cursor-not-allowed"
            }`}
          >
            导入 {w}×{h}
          </button>
        </div>
      </div>
    </div>
  );
}
