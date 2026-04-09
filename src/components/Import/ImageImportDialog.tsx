import { useState, useRef, useCallback, useEffect } from "react";
import { useEditorStore } from "../../store/editorStore";
import { matchImageToMard } from "../../utils/colorMatching";
import { MARD_COLORS, COLOR_GROUPS } from "../../data/mard221";
import { detectPixelGrid } from "../../utils/gridDetect";
import type { ColorMatchAlgorithm, CanvasCell } from "../../types";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface PixelData {
  width: number;
  height: number;
  pixels: number[];
}

interface ImagePreview {
  original_width: number;
  original_height: number;
  preview_width: number;
  preview_height: number;
  pixels: number[];
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function ImageImportDialog({ onClose }: { onClose: () => void }) {
  const loadCanvasData = useEditorStore((s) => s.loadCanvasData);
  const placeImageOnCanvas = useEditorStore((s) => s.placeImageOnCanvas);
  const setRefImage = useEditorStore((s) => s.setRefImage);
  const setImportedFileName = useEditorStore((s) => s.setImportedFileName);
  const currentCanvasSize = useEditorStore((s) => s.canvasSize);

  const [filePath, setFilePath] = useState<string | null>(null);
  const [maxDimension, setMaxDimension] = useState(52);
  const [algorithm, setAlgorithm] = useState<ColorMatchAlgorithm>("euclidean");
  const [colorGroupId, setColorGroupId] = useState("mard221");
  const [isProcessing, setIsProcessing] = useState(false);

  // Resize filter: sharp (nearest) vs smooth (lanczos)
  const [sharpEdge, setSharpEdge] = useState(false);

  // Canvas size (independent from image size)
  const [canvasW, setCanvasW] = useState(currentCanvasSize.width);
  const [canvasH, setCanvasH] = useState(currentCanvasSize.height);
  const [useCustomCanvas, setUseCustomCanvas] = useState(false);
  const [placement, setPlacement] = useState<"center" | "top-left">("center");

  // Image preview for crop selection
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);

  // Color-matched result
  const [matchedPreview, setMatchedPreview] = useState<number[] | null>(null);
  const [rawPixels, setRawPixels] = useState<number[] | null>(null);
  const [actualSize, setActualSize] = useState<{ width: number; height: number } | null>(null);

  // Grid overlay & magnifier
  const [showGrid, setShowGrid] = useState(true);
  const [loupePos, setLoupePos] = useState<{ x: number; y: number } | null>(null);
  const [loupePinned, setLoupePinned] = useState(false);
  const [loupeZoom] = useState(8);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);
  // Loupe is being dragged (while pinned)
  const isDraggingLoupe = useRef(false);

  // Manual grid width override (0 = auto from maxDimension)
  const [gridWidthOverride, setGridWidthOverride] = useState(0);

  // Grid origin offset in source pixels (for aligning grid to image content)
  const [gridOffsetX, setGridOffsetX] = useState(0);
  const [gridOffsetY, setGridOffsetY] = useState(0);

  // Auto grid detection result
  const [autoDetectResult, setAutoDetectResult] = useState<string | null>(null);

  // Interaction mode
  const [interactionMode, setInteractionMode] = useState<"crop" | "loupe">("crop");

  // Crop drag state
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingCrop = useRef(false);
  const cropStart = useRef({ x: 0, y: 0 });

  const handleSelectFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Image",
          extensions: ["png", "jpg", "jpeg", "bmp", "gif", "webp"],
        },
      ],
    });
    if (selected) {
      setFilePath(selected as string);
      setImagePreview(null);
      setCropRect(null);
      setMatchedPreview(null);
      setActualSize(null);
      setLoupePos(null);

      try {
        const preview = await invoke<ImagePreview>("preview_image", {
          path: selected as string,
        });
        setImagePreview(preview);
      } catch (e) {
        alert(`加载预览失败: ${e}`);
      }
    }
  };

  // Compute the pixel grid cell size on the preview canvas
  const getGridCellSize = useCallback(() => {
    if (!imagePreview) return 0;
    const scaleX = imagePreview.preview_width / imagePreview.original_width;
    if (gridWidthOverride > 0) {
      // Manual: gridWidthOverride = source pixels per bead
      return gridWidthOverride * scaleX;
    }
    const srcW = cropRect ? cropRect.width : imagePreview.original_width;
    const srcH = cropRect ? cropRect.height : imagePreview.original_height;
    const longerSide = Math.max(srcW, srcH);
    const pixelsPerBead = longerSide / maxDimension;
    return pixelsPerBead * scaleX;
  }, [imagePreview, maxDimension, cropRect, gridWidthOverride]);

  // Draw the preview image with crop overlay + pixel grid + loupe
  const drawCropCanvas = useCallback(() => {
    const canvas = cropCanvasRef.current;
    if (!canvas || !imagePreview) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { preview_width: pw, preview_height: ph, pixels } = imagePreview;
    canvas.width = pw;
    canvas.height = ph;

    // Draw image pixels
    const imgData = ctx.createImageData(pw, ph);
    for (let i = 0; i < pw * ph; i++) {
      imgData.data[i * 4] = pixels[i * 3];
      imgData.data[i * 4 + 1] = pixels[i * 3 + 1];
      imgData.data[i * 4 + 2] = pixels[i * 3 + 2];
      imgData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    const scaleX = pw / imagePreview.original_width;
    const scaleY = ph / imagePreview.original_height;

    // Grid origin with offset
    const gridOriginX = (cropRect ? cropRect.x * scaleX : 0) + gridOffsetX * scaleX;
    const gridOriginY = (cropRect ? cropRect.y * scaleY : 0) + gridOffsetY * scaleY;

    // Draw pixel grid overlay
    if (showGrid) {
      const cellSize = getGridCellSize();
      if (cellSize > 2) {
        const gx = gridOriginX;
        const gy = gridOriginY;
        const gw = (cropRect ? cropRect.width * scaleX : pw) - gridOffsetX * scaleX;
        const gh = (cropRect ? cropRect.height * scaleY : ph) - gridOffsetY * scaleY;

        ctx.strokeStyle = "rgba(255,255,0,0.35)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let x = gx; x <= gx + gw + 0.1; x += cellSize) {
          ctx.moveTo(x, gy);
          ctx.lineTo(x, gy + gh);
        }
        for (let y = gy; y <= gy + gh + 0.1; y += cellSize) {
          ctx.moveTo(gx, y);
          ctx.lineTo(gx + gw, y);
        }
        ctx.stroke();
      }
    }

    // Draw crop overlay
    if (cropRect) {
      const rx = cropRect.x * scaleX;
      const ry = cropRect.y * scaleY;
      const rw = cropRect.width * scaleX;
      const rh = cropRect.height * scaleY;

      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, pw, ry);
      ctx.fillRect(0, ry, rx, rh);
      ctx.fillRect(rx + rw, ry, pw - rx - rw, rh);
      ctx.fillRect(0, ry + rh, pw, ph - ry - rh);

      ctx.strokeStyle = "#3B82F6";
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);
    }

    // Draw magnifier loupe — grid-aligned rendering
    if (loupePos && interactionMode === "loupe") {
      const cellSize = getGridCellSize();
      if (cellSize > 1) {
        const gx = gridOriginX;
        const gy = gridOriginY;

        // Snap loupe center to grid cell
        const cellCol = Math.floor((loupePos.x - gx) / cellSize);
        const cellRow = Math.floor((loupePos.y - gy) / cellSize);
        const cellX = gx + cellCol * cellSize;
        const cellY = gy + cellRow * cellSize;

        // Draw indicator rectangle on main canvas
        const LOUPE_CELLS = 7;
        const halfCells = Math.floor(LOUPE_CELLS / 2);
        const regionX = gx + (cellCol - halfCells) * cellSize;
        const regionY = gy + (cellRow - halfCells) * cellSize;
        const regionSize = LOUPE_CELLS * cellSize;
        ctx.strokeStyle = "rgba(59,130,246,0.7)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(regionX, regionY, regionSize, regionSize);

        // Highlight center cell
        ctx.strokeStyle = "rgba(255,50,50,0.9)";
        ctx.lineWidth = 2;
        ctx.strokeRect(cellX, cellY, cellSize, cellSize);

        // Draw zoomed loupe on separate canvas
        const loupeCanvas = loupeCanvasRef.current;
        if (loupeCanvas) {
          const LOUPE_PX = 210;
          const zoomedCellSize = LOUPE_PX / LOUPE_CELLS;
          loupeCanvas.width = LOUPE_PX;
          loupeCanvas.height = LOUPE_PX;
          const lctx = loupeCanvas.getContext("2d");
          if (lctx) {
            // Source region: exact grid cells
            const srcX = regionX;
            const srcY = regionY;
            const srcW = regionSize;
            const srcH = regionSize;

            lctx.imageSmoothingEnabled = false;
            lctx.drawImage(
              canvas,
              srcX, srcY, srcW, srcH,
              0, 0, LOUPE_PX, LOUPE_PX
            );

            // Draw grid lines exactly on cell boundaries
            lctx.strokeStyle = "rgba(255,255,0,0.6)";
            lctx.lineWidth = 1;
            lctx.beginPath();
            for (let i = 0; i <= LOUPE_CELLS; i++) {
              const p = i * zoomedCellSize;
              lctx.moveTo(p, 0);
              lctx.lineTo(p, LOUPE_PX);
              lctx.moveTo(0, p);
              lctx.lineTo(LOUPE_PX, p);
            }
            lctx.stroke();

            // Highlight center cell
            const cx = halfCells * zoomedCellSize;
            const cy = halfCells * zoomedCellSize;
            lctx.strokeStyle = "rgba(255,50,50,0.9)";
            lctx.lineWidth = 2;
            lctx.strokeRect(cx, cy, zoomedCellSize, zoomedCellSize);
          }
        }
      }
    }
  }, [imagePreview, cropRect, showGrid, getGridCellSize, loupePos, interactionMode, loupeZoom, gridOffsetX, gridOffsetY]);

  useEffect(() => {
    drawCropCanvas();
  }, [drawCropCanvas]);

  // Convert mouse position to preview pixel coordinates
  const mouseToPreview = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = cropCanvasRef.current;
      if (!canvas || !imagePreview) return null;
      const rect = canvas.getBoundingClientRect();
      const displayScale = canvas.width / rect.width;
      return {
        x: (e.clientX - rect.left) * displayScale,
        y: (e.clientY - rect.top) * displayScale,
      };
    },
    [imagePreview]
  );

  // Convert mouse position to original image coordinates
  const mouseToOriginal = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = cropCanvasRef.current;
      if (!canvas || !imagePreview) return null;
      const rect = canvas.getBoundingClientRect();
      const displayScale = canvas.width / rect.width;
      const px = (e.clientX - rect.left) * displayScale;
      const py = (e.clientY - rect.top) * displayScale;
      return {
        x: Math.max(
          0,
          Math.min(
            imagePreview.original_width,
            Math.round(
              (px / imagePreview.preview_width) * imagePreview.original_width
            )
          )
        ),
        y: Math.max(
          0,
          Math.min(
            imagePreview.original_height,
            Math.round(
              (py / imagePreview.preview_height) * imagePreview.original_height
            )
          )
        ),
      };
    },
    [imagePreview]
  );

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (interactionMode === "crop") {
        const pos = mouseToOriginal(e);
        if (!pos) return;
        isDraggingCrop.current = true;
        cropStart.current = pos;
        setCropRect(null);
        setMatchedPreview(null);
        setActualSize(null);
      } else if (interactionMode === "loupe") {
        if (loupePinned) {
          // Start dragging pinned loupe
          isDraggingLoupe.current = true;
          const pos = mouseToPreview(e);
          if (pos) setLoupePos(pos);
        } else {
          // Pin at current position
          const pos = mouseToPreview(e);
          if (pos) {
            setLoupePos(pos);
            setLoupePinned(true);
          }
        }
      }
    },
    [mouseToOriginal, mouseToPreview, interactionMode, loupePinned]
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (interactionMode === "crop") {
        if (!isDraggingCrop.current || !imagePreview) return;
        const pos = mouseToOriginal(e);
        if (!pos) return;

        const x = Math.min(cropStart.current.x, pos.x);
        const y = Math.min(cropStart.current.y, pos.y);
        const w = Math.abs(pos.x - cropStart.current.x);
        const h = Math.abs(pos.y - cropStart.current.y);

        if (w > 2 && h > 2) {
          setCropRect({ x, y, width: w, height: h });
        }
      } else if (interactionMode === "loupe") {
        if (isDraggingLoupe.current) {
          const pos = mouseToPreview(e);
          if (pos) setLoupePos(pos);
        } else if (!loupePinned) {
          const pos = mouseToPreview(e);
          if (pos) setLoupePos(pos);
        }
      }
    },
    [mouseToOriginal, mouseToPreview, imagePreview, interactionMode, loupePinned]
  );

  const handleCanvasMouseUp = useCallback(() => {
    isDraggingCrop.current = false;
    isDraggingLoupe.current = false;
  }, []);

  const handleCanvasMouseLeave = useCallback(() => {
    isDraggingCrop.current = false;
    isDraggingLoupe.current = false;
    if (interactionMode === "loupe" && !loupePinned) setLoupePos(null);
  }, [interactionMode, loupePinned]);

  const handleClearCrop = () => {
    setCropRect(null);
    setMatchedPreview(null);
    setActualSize(null);
  };

  const handleAutoDetect = async () => {
    if (!filePath || !imagePreview) return;
    try {
      // Get full-resolution pixels for detection
      const data = await invoke<PixelData>("import_image", {
        path: filePath,
        maxDimension: Math.max(imagePreview.original_width, imagePreview.original_height),
        crop: cropRect ? { x: cropRect.x, y: cropRect.y, width: cropRect.width, height: cropRect.height } : null,
        sharp: true,
      });
      const result = detectPixelGrid(data.pixels as number[], data.width, data.height);
      setMaxDimension(result.recommendedMaxDimension);
      setMatchedPreview(null);
      setActualSize(null);
      setAutoDetectResult(
        `检测到网格: ${result.gridCols}×${result.gridRows} (cell≈${result.cellSize}px, 置信度 ${Math.round(result.confidence * 100)}%)`
      );
    } catch (e) {
      setAutoDetectResult(`检测失败: ${e}`);
    }
  };

  const handlePreview = async () => {
    if (!filePath) return;
    setIsProcessing(true);
    try {
      const crop = cropRect
        ? {
            x: cropRect.x,
            y: cropRect.y,
            width: cropRect.width,
            height: cropRect.height,
          }
        : null;

      const data = await invoke<PixelData>("import_image", {
        path: filePath,
        maxDimension,
        crop,
        sharp: sharpEdge,
      });
      const matched = matchImageToMard(data.pixels, algorithm, colorGroupId);
      setMatchedPreview(matched);
      setRawPixels(data.pixels as number[]);
      setActualSize({ width: data.width, height: data.height });
    } catch (e) {
      alert(`导入失败: ${e}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirm = () => {
    if (!matchedPreview || !actualSize) return;

    const { width: imgW, height: imgH } = actualSize;
    const imageData: CanvasCell[][] = [];
    for (let row = 0; row < imgH; row++) {
      const rowData: CanvasCell[] = [];
      for (let col = 0; col < imgW; col++) {
        const idx = row * imgW + col;
        rowData.push({ colorIndex: matchedPreview[idx] });
      }
      imageData.push(rowData);
    }

    if (useCustomCanvas) {
      const cw = Math.max(canvasW, 4);
      const ch = Math.max(canvasH, 4);
      let startRow = 0;
      let startCol = 0;
      if (placement === "center") {
        startRow = Math.floor((ch - imgH) / 2);
        startCol = Math.floor((cw - imgW) / 2);
      }
      placeImageOnCanvas(imageData, imgW, imgH, cw, ch, startRow, startCol);

      // Reference image also placed on canvas-sized buffer
      if (rawPixels) {
        const refBuf: number[] = new Array(cw * ch * 3).fill(255);
        for (let r = 0; r < imgH; r++) {
          for (let c = 0; c < imgW; c++) {
            const tr = startRow + r;
            const tc = startCol + c;
            if (tr >= 0 && tr < ch && tc >= 0 && tc < cw) {
              const srcIdx = (r * imgW + c) * 3;
              const dstIdx = (tr * cw + tc) * 3;
              refBuf[dstIdx] = rawPixels[srcIdx];
              refBuf[dstIdx + 1] = rawPixels[srcIdx + 1];
              refBuf[dstIdx + 2] = rawPixels[srcIdx + 2];
            }
          }
        }
        setRefImage(refBuf, cw, ch);
      }
    } else {
      loadCanvasData(imageData, { width: imgW, height: imgH });
      if (rawPixels) {
        setRefImage(rawPixels, imgW, imgH);
      }
    }

    // Store original filename for export
    if (filePath) {
      const name = filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") ?? "pindou";
      setImportedFileName(name);
    }

    onClose();
  };

  const gridCellSize = getGridCellSize();
  const srcPixelsPerBead = imagePreview
    ? Math.max(
        cropRect?.width ?? imagePreview.original_width,
        cropRect?.height ?? imagePreview.original_height
      ) / maxDimension
    : 0;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[560px] max-h-[85vh] flex flex-col">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-sm">导入图片</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          {/* File selection */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">
              图片文件
            </label>
            <div className="flex gap-2">
              <button
                onClick={handleSelectFile}
                className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
              >
                选择文件
              </button>
              <span className="text-xs text-gray-500 self-center truncate flex-1">
                {filePath || "未选择"}
              </span>
            </div>
          </div>

          {/* Image preview with crop + grid + loupe */}
          {imagePreview && (
            <div>
              {/* Mode & grid toggles */}
              <div className="flex items-center gap-2 mb-1">
                <label className="text-xs text-gray-600">工具:</label>
                <button
                  onClick={() => setInteractionMode("crop")}
                  className={`px-2 py-0.5 text-xs rounded border ${
                    interactionMode === "crop"
                      ? "bg-blue-100 border-blue-400 text-blue-700"
                      : "hover:bg-gray-100"
                  }`}
                  title="拖拽选择裁剪区域"
                >
                  ✂️ 裁剪
                </button>
                <button
                  onClick={() => setInteractionMode("loupe")}
                  className={`px-2 py-0.5 text-xs rounded border ${
                    interactionMode === "loupe"
                      ? "bg-blue-100 border-blue-400 text-blue-700"
                      : "hover:bg-gray-100"
                  }`}
                  title="移动鼠标查看像素网格对应"
                >
                  🔍 放大镜
                </button>
                <div className="border-l mx-1 h-4" />
                <label className="flex items-center gap-1 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => setShowGrid(e.target.checked)}
                    className="w-3 h-3"
                  />
                  像素网格
                </label>
              </div>

              {/* Grid width adjuster */}
              {showGrid && imagePreview && (
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-[10px] text-gray-500 whitespace-nowrap">
                    网格宽度:
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(80, Math.round(imagePreview.original_width / 4))}
                    value={gridWidthOverride}
                    onChange={(e) => setGridWidthOverride(Number(e.target.value))}
                    className="flex-1 h-3"
                  />
                  <span className="text-[10px] text-gray-500 w-14 text-right">
                    {gridWidthOverride === 0
                      ? "自动"
                      : `${gridWidthOverride}px`}
                  </span>
                  {gridWidthOverride > 0 && (
                    <button
                      onClick={() => setGridWidthOverride(0)}
                      className="text-[10px] text-blue-500 hover:text-blue-700 underline"
                    >
                      自动
                    </button>
                  )}
                </div>
              )}

              {/* Grid offset adjusters */}
              {showGrid && imagePreview && (
                <div className="flex flex-col gap-1 mb-1">
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-gray-500 w-16 whitespace-nowrap">
                      水平偏移:
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(1, Math.round(getGridCellSize() / (imagePreview.preview_width / imagePreview.original_width)))}
                      step={0.1}
                      value={gridOffsetX}
                      onChange={(e) => setGridOffsetX(Number(e.target.value))}
                      className="flex-1 h-3"
                    />
                    <span className="text-[10px] text-gray-500 w-12 text-right">
                      {gridOffsetX.toFixed(1)}px
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-gray-500 w-16 whitespace-nowrap">
                      垂直偏移:
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(1, Math.round(getGridCellSize() / (imagePreview.preview_height / imagePreview.original_height)))}
                      step={0.1}
                      value={gridOffsetY}
                      onChange={(e) => setGridOffsetY(Number(e.target.value))}
                      className="flex-1 h-3"
                    />
                    <span className="text-[10px] text-gray-500 w-12 text-right">
                      {gridOffsetY.toFixed(1)}px
                    </span>
                  </div>
                  {(gridOffsetX > 0 || gridOffsetY > 0) && (
                    <button
                      onClick={() => { setGridOffsetX(0); setGridOffsetY(0); }}
                      className="text-[10px] text-blue-500 hover:text-blue-700 underline self-end"
                    >
                      重置偏移
                    </button>
                  )}
                </div>
              )}

              <div className="border rounded p-2 bg-gray-50">
                <div className="flex gap-2">
                  <canvas
                    ref={cropCanvasRef}
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onMouseLeave={handleCanvasMouseLeave}
                    className={
                      interactionMode === "crop"
                        ? "cursor-crosshair"
                        : "cursor-crosshair"
                    }
                    style={{
                      width: Math.min(
                        interactionMode === "loupe" ? 340 : 520,
                        imagePreview.preview_width
                      ),
                      height: Math.min(
                        interactionMode === "loupe" ? 340 : 520,
                        imagePreview.preview_height
                      ),
                    }}
                  />
                  {/* Zoomed loupe panel */}
                  {interactionMode === "loupe" && (
                    <div className="flex flex-col items-center gap-1 min-w-[210px]">
                      <canvas
                        ref={loupeCanvasRef}
                        className="border border-gray-300 bg-gray-200"
                        style={{
                          width: 210,
                          height: 210,
                          imageRendering: "pixelated",
                        }}
                      />
                      <span className="text-[10px] text-gray-400">
                        {loupePinned
                          ? "拖拽图片移动位置"
                          : loupePos
                            ? "点击图片固定"
                            : "移动鼠标到图片上"}
                      </span>
                      {loupePinned && (
                        <button
                          onClick={() => setLoupePinned(false)}
                          className="text-[10px] text-blue-500 hover:text-blue-700 underline"
                        >
                          取消固定
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-[10px] text-gray-400">
                    原图: {imagePreview.original_width}×
                    {imagePreview.original_height}
                  </span>
                  {gridCellSize > 0 && (
                    <span className="text-[10px] text-yellow-600">
                      每颗珠≈{srcPixelsPerBead.toFixed(1)}×
                      {srcPixelsPerBead.toFixed(1)}px
                    </span>
                  )}
                  {cropRect && (
                    <>
                      <span className="text-[10px] text-blue-500">
                        选区: {cropRect.width}×{cropRect.height}
                      </span>
                      <button
                        onClick={handleClearCrop}
                        className="text-[10px] text-red-400 hover:text-red-600 underline"
                      >
                        清除选区
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Max dimension with slider */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">
              最大边长 (保持比例)
            </label>
            <div className="flex gap-2 mb-1">
              {imagePreview && (
                <button
                  onClick={handleAutoDetect}
                  className="px-2 py-1 text-xs rounded border bg-amber-50 border-amber-400 text-amber-700 hover:bg-amber-100"
                  title="自动检测像素画网格大小"
                >
                  🔍 自动检测
                </button>
              )}
              {[
                { label: "26", v: 26 },
                { label: "52 (中板)", v: 52 },
                { label: "78", v: 78 },
                { label: "104 (大板)", v: 104 },
              ].map((p) => (
                <button
                  key={p.v}
                  onClick={() => {
                    setMaxDimension(p.v);
                    setMatchedPreview(null);
                    setActualSize(null);
                  }}
                  className={`px-2 py-1 text-xs rounded border ${
                    maxDimension === p.v
                      ? "bg-blue-100 border-blue-400"
                      : "hover:bg-gray-100"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="range"
                min={8}
                max={104}
                value={maxDimension}
                onChange={(e) => {
                  setMaxDimension(Number(e.target.value));
                  setMatchedPreview(null);
                  setActualSize(null);
                }}
                className="flex-1"
              />
              <input
                type="number"
                min={4}
                max={104}
                value={maxDimension}
                onChange={(e) => {
                  setMaxDimension(
                    Math.min(104, Math.max(4, Number(e.target.value)))
                  );
                  setMatchedPreview(null);
                  setActualSize(null);
                }}
                className="w-14 px-2 py-1 text-xs border rounded text-center"
              />
            </div>
            {actualSize && (
              <p className="text-xs text-green-600 mt-1">
                图片尺寸: {actualSize.width}×{actualSize.height}
              </p>
            )}
            {autoDetectResult && (
              <p className="text-xs text-amber-600 mt-1">
                {autoDetectResult}
              </p>
            )}
          </div>

          {/* Canvas size (independent) */}
          <div>
            <label className="flex items-center gap-1 text-xs text-gray-600 mb-1 cursor-pointer">
              <input
                type="checkbox"
                checked={useCustomCanvas}
                onChange={(e) => setUseCustomCanvas(e.target.checked)}
                className="w-3 h-3"
              />
              自定义画布尺寸（图片可小于画布）
            </label>
            {useCustomCanvas && (
              <div className="flex flex-col gap-1.5 ml-4">
                <div className="flex gap-2 mb-1">
                  {[
                    { l: "52×52", w: 52, h: 52 },
                    { l: "104×104", w: 104, h: 104 },
                  ].map((p) => (
                    <button
                      key={p.l}
                      onClick={() => { setCanvasW(p.w); setCanvasH(p.h); }}
                      className={`px-2 py-0.5 text-xs rounded border ${
                        canvasW === p.w && canvasH === p.h
                          ? "bg-blue-100 border-blue-400"
                          : "hover:bg-gray-100"
                      }`}
                    >
                      {p.l}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 items-center text-xs">
                  <span>宽</span>
                  <input
                    type="number"
                    min={4}
                    max={256}
                    value={canvasW}
                    onChange={(e) => setCanvasW(Number(e.target.value))}
                    className="w-14 px-1 py-0.5 border rounded text-center"
                  />
                  <span>高</span>
                  <input
                    type="number"
                    min={4}
                    max={256}
                    value={canvasH}
                    onChange={(e) => setCanvasH(Number(e.target.value))}
                    className="w-14 px-1 py-0.5 border rounded text-center"
                  />
                </div>
                <div className="flex gap-2 items-center text-xs">
                  <span className="text-gray-500">放置位置:</span>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="placement"
                      checked={placement === "center"}
                      onChange={() => setPlacement("center")}
                    />
                    居中
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="placement"
                      checked={placement === "top-left"}
                      onChange={() => setPlacement("top-left")}
                    />
                    左上角
                  </label>
                </div>
                {actualSize && (
                  <p className={`text-xs ${
                    actualSize.width > canvasW || actualSize.height > canvasH
                      ? "text-red-500"
                      : "text-green-600"
                  }`}>
                    {actualSize.width > canvasW || actualSize.height > canvasH
                      ? `⚠ 图片(${actualSize.width}×${actualSize.height})超出画布(${canvasW}×${canvasH})，会被裁剪`
                      : `画布 ${canvasW}×${canvasH}，图片 ${actualSize.width}×${actualSize.height}`}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Color group selector */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">
              色组范围
            </label>
            <select
              value={colorGroupId}
              onChange={(e) => { setColorGroupId(e.target.value); setMatchedPreview(null); setActualSize(null); }}
              className="w-full px-2 py-1 text-xs border rounded"
            >
              {COLOR_GROUPS.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          {/* Algorithm & resize mode */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">
              颜色匹配算法
            </label>
            <div className="flex gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="algo"
                  checked={algorithm === "ciede2000"}
                  onChange={() => setAlgorithm("ciede2000")}
                />
                CIELAB ΔE (推荐)
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="algo"
                  checked={algorithm === "euclidean"}
                  onChange={() => setAlgorithm("euclidean")}
                />
                Euclidean (RGB)
              </label>
            </div>
            <label className="text-xs text-gray-600 mt-2 mb-1 block">
              缩放模式
            </label>
            <div className="flex gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="filter"
                  checked={sharpEdge}
                  onChange={() => setSharpEdge(true)}
                />
                锐利边缘 (推荐线条图)
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="filter"
                  checked={!sharpEdge}
                  onChange={() => setSharpEdge(false)}
                />
                平滑过渡 (照片)
              </label>
            </div>
          </div>

          {/* Preview / Confirm */}
          <div className="flex gap-2">
            <button
              onClick={handlePreview}
              disabled={!filePath || isProcessing}
              className="px-3 py-1.5 bg-gray-600 text-white text-xs rounded hover:bg-gray-700 disabled:opacity-40"
            >
              {isProcessing ? "处理中..." : "预览匹配结果"}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!matchedPreview}
              className="px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-40"
            >
              确认导入
            </button>
          </div>

          {/* Matched result preview */}
          {matchedPreview && actualSize && (
            <div className="border rounded p-2 bg-gray-50">
              <p className="text-[10px] text-gray-500 mb-1">
                匹配结果 ({actualSize.width}×{actualSize.height}):
              </p>
              <canvas
                ref={(canvas) => {
                  if (!canvas || !matchedPreview || !actualSize) return;
                  canvas.width = actualSize.width;
                  canvas.height = actualSize.height;
                  const ctx = canvas.getContext("2d");
                  if (!ctx) return;

                  for (let row = 0; row < actualSize.height; row++) {
                    for (let col = 0; col < actualSize.width; col++) {
                      const idx =
                        matchedPreview[row * actualSize.width + col];
                      const color = MARD_COLORS[idx];
                      ctx.fillStyle = color?.hex || "#FFF";
                      ctx.fillRect(col, row, 1, 1);
                    }
                  }
                }}
                style={{
                  width: Math.min(400, actualSize.width * 4),
                  height: Math.min(400, actualSize.height * 4),
                  imageRendering: "pixelated",
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
