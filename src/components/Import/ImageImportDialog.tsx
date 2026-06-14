import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useEditorStore } from "../../store/editorStore";
import { matchImageToMard } from "../../utils/colorMatching";
import { COLOR_GROUPS, MARD_COLORS, getGroupIndices, groupIndicesByLetter } from "../../data/mard221";
import { getEffectiveHex } from "../../utils/colorHelper";
import { detectPixelGrid } from "../../utils/gridDetect";
import type { ColorMatchAlgorithm, CanvasCell } from "../../types";
import { getAdapter } from "../../adapters";
import type { ImagePreview, CropRect } from "../../adapters";
import { appAlert } from "../Dialog/AppDialog";
import {
  DEFAULT_CALIBRATION_SETTINGS,
  computeCoefficients,
  applyCalibration,
  sampleRegionMean,
  IDENTITY_COEFFICIENTS,
  type CalibrationSettings,
  type CalibrationCoefficients,
} from "../../utils/colorCalibration";

// Discrete zoom levels for the import preview canvas (crop mode only)
const ZOOM_LEVELS = [1, 2, 3, 4, 6];

export function ImageImportDialog({ onClose }: { onClose: () => void }) {
  const loadCanvasData = useEditorStore((s) => s.loadCanvasData);
  const placeImageOnCanvas = useEditorStore((s) => s.placeImageOnCanvas);
  const setRefImage = useEditorStore((s) => s.setRefImage);
  const setImportedFileName = useEditorStore((s) => s.setImportedFileName);
  const currentCanvasSize = useEditorStore((s) => s.canvasSize);
  const colorOverrides = useEditorStore((s) => s.colorOverrides);

  const [filePath, setFilePath] = useState<string | null>(null);
  const [maxDimension, setMaxDimension] = useState(52);
  const [algorithm, setAlgorithm] = useState<ColorMatchAlgorithm>("euclidean");
  const [colorGroupId, setColorGroupId] = useState("mard221");
  const [isProcessing, setIsProcessing] = useState(false);

  // Resize filter: sharp (nearest) vs smooth (lanczos)
  const [sharpEdge, setSharpEdge] = useState(false);

  // Width compensation: < 1.0 makes result narrower
  const [widthRatio, setWidthRatio] = useState(1.0);
  const [widthExpand, setWidthExpand] = useState<"center" | "left" | "right">("center");

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

  // Color calibration
  const [calibration, setCalibration] = useState<CalibrationSettings>(
    DEFAULT_CALIBRATION_SETTINGS,
  );

  const calibrationCoef: CalibrationCoefficients = useMemo(() => {
    if (!calibration.enabled || calibration.points.length === 0) {
      return IDENTITY_COEFFICIENTS;
    }
    const pairs = calibration.points.map((p) => {
      const mc = MARD_COLORS[p.targetColorIndex];
      const target: [number, number, number] = mc?.rgb ?? [0, 0, 0];
      return { sample: p.sampledRgb, target };
    });
    return computeCoefficients(pairs);
  }, [calibration]);

  const [pendingCalPoint, setPendingCalPoint] = useState<{
    region: { x: number; y: number; w: number; h: number };
    sampledRgb: [number, number, number];
    editingId?: string;
  } | null>(null);

  const [calibrationPanelOpen, setCalibrationPanelOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<"crop" | "sample">("crop");

  // Denoise & comparison
  const [showComparison, setShowComparison] = useState(false);
  interface CompareItem {
    label: string;
    algo: ColorMatchAlgorithm;
    indices: number[];
  }
  const [compareResults, setCompareResults] = useState<CompareItem[]>([]);
  const [selectedCompareIdx, setSelectedCompareIdx] = useState<number | null>(null);
  const [previewScale, setPreviewScale] = useState(4);

  // Display zoom for the top preview canvas (crop mode only)
  const [previewZoom, setPreviewZoom] = useState(1);

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
  const [cropCursor, setCropCursor] = useState("crosshair");

  // Crop drag state
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingCrop = useRef(false);
  const cropStart = useRef({ x: 0, y: 0 });
  const cropDragMode = useRef<"new" | "move" | "edge">("new");
  const cropEdge = useRef<"top" | "bottom" | "left" | "right" | "tl" | "tr" | "bl" | "br">("top");
  const cropOrigRect = useRef<CropRect | null>(null);

  // Sample drag state (calibration sample mode)
  const isDraggingSample = useRef(false);
  const sampleStart = useRef({ x: 0, y: 0 });
  const [sampleDragRect, setSampleDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Synced scroll refs for comparison
  const compareScrollRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isSyncingScroll = useRef(false);
  const handleCompareScroll = useCallback((sourceIdx: number) => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    const source = compareScrollRefs.current[sourceIdx];
    if (source) {
      compareScrollRefs.current.forEach((el, i) => {
        if (el && i !== sourceIdx) {
          el.scrollTop = source.scrollTop;
          el.scrollLeft = source.scrollLeft;
        }
      });
    }
    requestAnimationFrame(() => { isSyncingScroll.current = false; });
  }, []);

  const handleSelectFile = async () => {
    const adapter = getAdapter();
    const selected = await adapter.showOpenDialog([
      {
        name: "Image",
        extensions: ["png", "jpg", "jpeg", "bmp", "gif", "webp"],
      },
    ]);
    if (selected) {
      setFilePath(selected as string);
      setImagePreview(null);
      setCropRect(null);
      setMatchedPreview(null);
      setActualSize(null);
      setLoupePos(null);
      setCalibration(DEFAULT_CALIBRATION_SETTINGS);
      setPendingCalPoint(null);
      setPreviewMode("crop");
      setPreviewZoom(1);

      try {
        const preview = await adapter.previewImage(selected as string);
        setImagePreview(preview);
      } catch (e) {
        await appAlert(`加载预览失败: ${e}`);
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

      // Draw corner/edge handles
      const hs = 6;
      ctx.fillStyle = "#3B82F6";
      for (const [hx, hy] of [
        [rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh],
        [rx + rw / 2, ry], [rx + rw / 2, ry + rh],
        [rx, ry + rh / 2], [rx + rw, ry + rh / 2],
      ] as [number, number][]) {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }
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

    // Draw persistent calibration markers (numbered 1, 2, 3, …)
    if (calibration.points.length > 0) {
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.font = "bold 11px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      calibration.points.forEach((p, i) => {
        const rx = p.region.x;
        const ry = p.region.y;
        const rw = Math.max(p.region.w, 1);
        const rh = Math.max(p.region.h, 1);
        ctx.strokeStyle = "rgba(255,200,0,0.95)";
        ctx.strokeRect(rx, ry, rw, rh);
        // Label badge in the top-left corner of the rect
        const badgeSize = 14;
        const bx = rx + (rw < badgeSize ? rw : 0);
        const by = ry - badgeSize - 1 < 0 ? ry + 1 : ry - badgeSize - 1;
        ctx.fillStyle = "rgba(255,200,0,0.95)";
        ctx.fillRect(bx, by, badgeSize, badgeSize);
        ctx.fillStyle = "#000";
        ctx.fillText(String(i + 1), bx + badgeSize / 2, by + badgeSize / 2 + 0.5);
      });
      ctx.restore();
    }

    // Draw live sample drag rectangle (dashed)
    if (sampleDragRect && sampleDragRect.w > 0 && sampleDragRect.h > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(59,130,246,0.95)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sampleDragRect.x, sampleDragRect.y, sampleDragRect.w, sampleDragRect.h);
      ctx.restore();
    }
  }, [imagePreview, cropRect, showGrid, getGridCellSize, loupePos, interactionMode, loupeZoom, gridOffsetX, gridOffsetY, calibration.points, sampleDragRect]);

  useEffect(() => {
    drawCropCanvas();
  }, [drawCropCanvas]);

  useEffect(() => {
    if (!rawPixels) return;
    const calibrated = applyCalibration(rawPixels, calibrationCoef);
    const matched = matchImageToMard(calibrated, algorithm, colorGroupId, colorOverrides);
    setMatchedPreview(matched);
  }, [rawPixels, algorithm, colorGroupId, colorOverrides, calibrationCoef]);

  useEffect(() => {
    if (previewMode !== "sample") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        isDraggingSample.current = false;
        setSampleDragRect(null);
        setPreviewMode("crop");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewMode]);

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
      if (previewMode === "sample") {
        const pos = mouseToPreview(e);
        if (!pos) return;
        isDraggingSample.current = true;
        sampleStart.current = pos;
        return;
      }
      if (interactionMode === "crop") {
        const pos = mouseToOriginal(e);
        if (!pos) return;

        // Check if clicking on existing selection edge/interior
        if (cropRect) {
          const EDGE = 8; // tolerance in original-image pixels
          const { x, y, width: w, height: h } = cropRect;
          const onLeft = Math.abs(pos.x - x) < EDGE && pos.y >= y - EDGE && pos.y <= y + h + EDGE;
          const onRight = Math.abs(pos.x - (x + w)) < EDGE && pos.y >= y - EDGE && pos.y <= y + h + EDGE;
          const onTop = Math.abs(pos.y - y) < EDGE && pos.x >= x - EDGE && pos.x <= x + w + EDGE;
          const onBottom = Math.abs(pos.y - (y + h)) < EDGE && pos.x >= x - EDGE && pos.x <= x + w + EDGE;
          const inside = pos.x > x + EDGE && pos.x < x + w - EDGE && pos.y > y + EDGE && pos.y < y + h - EDGE;

          if (onTop && onLeft) {
            cropDragMode.current = "edge"; cropEdge.current = "tl";
          } else if (onTop && onRight) {
            cropDragMode.current = "edge"; cropEdge.current = "tr";
          } else if (onBottom && onLeft) {
            cropDragMode.current = "edge"; cropEdge.current = "bl";
          } else if (onBottom && onRight) {
            cropDragMode.current = "edge"; cropEdge.current = "br";
          } else if (onTop) {
            cropDragMode.current = "edge"; cropEdge.current = "top";
          } else if (onBottom) {
            cropDragMode.current = "edge"; cropEdge.current = "bottom";
          } else if (onLeft) {
            cropDragMode.current = "edge"; cropEdge.current = "left";
          } else if (onRight) {
            cropDragMode.current = "edge"; cropEdge.current = "right";
          } else if (inside) {
            cropDragMode.current = "move";
          } else {
            cropDragMode.current = "new";
            setCropRect(null);
            setMatchedPreview(null);
            setActualSize(null);
          }

          if (cropDragMode.current !== "new") {
            isDraggingCrop.current = true;
            cropStart.current = pos;
            cropOrigRect.current = { ...cropRect };
            return;
          }
        }

        // New selection
        cropDragMode.current = "new";
        isDraggingCrop.current = true;
        cropStart.current = pos;
        cropOrigRect.current = null;
        setCropRect(null);
        setMatchedPreview(null);
        setActualSize(null);
      } else if (interactionMode === "loupe") {
        if (loupePinned) {
          isDraggingLoupe.current = true;
          const pos = mouseToPreview(e);
          if (pos) setLoupePos(pos);
        } else {
          const pos = mouseToPreview(e);
          if (pos) {
            setLoupePos(pos);
            setLoupePinned(true);
          }
        }
      }
    },
    [mouseToOriginal, mouseToPreview, interactionMode, loupePinned, cropRect, previewMode]
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (previewMode === "sample") {
        if (isDraggingSample.current) {
          const pos = mouseToPreview(e);
          if (pos) {
            const x = Math.min(sampleStart.current.x, pos.x);
            const y = Math.min(sampleStart.current.y, pos.y);
            const w = Math.abs(pos.x - sampleStart.current.x);
            const h = Math.abs(pos.y - sampleStart.current.y);
            setSampleDragRect({ x, y, w, h });
          }
        }
        return;
      }
      if (interactionMode === "crop") {
        const pos = mouseToOriginal(e);
        if (!pos || !imagePreview) return;

        // Update cursor based on hover position when not dragging
        if (!isDraggingCrop.current) {
          if (cropRect) {
            const EDGE = 8;
            const { x, y, width: w, height: h } = cropRect;
            const onLeft = Math.abs(pos.x - x) < EDGE && pos.y >= y - EDGE && pos.y <= y + h + EDGE;
            const onRight = Math.abs(pos.x - (x + w)) < EDGE && pos.y >= y - EDGE && pos.y <= y + h + EDGE;
            const onTop = Math.abs(pos.y - y) < EDGE && pos.x >= x - EDGE && pos.x <= x + w + EDGE;
            const onBottom = Math.abs(pos.y - (y + h)) < EDGE && pos.x >= x - EDGE && pos.x <= x + w + EDGE;
            const inside = pos.x > x + EDGE && pos.x < x + w - EDGE && pos.y > y + EDGE && pos.y < y + h - EDGE;

            if ((onTop && onLeft) || (onBottom && onRight)) setCropCursor("nwse-resize");
            else if ((onTop && onRight) || (onBottom && onLeft)) setCropCursor("nesw-resize");
            else if (onTop || onBottom) setCropCursor("ns-resize");
            else if (onLeft || onRight) setCropCursor("ew-resize");
            else if (inside) setCropCursor("move");
            else setCropCursor("crosshair");
          } else {
            setCropCursor("crosshair");
          }
          return;
        }

        const imgW = imagePreview.original_width;
        const imgH = imagePreview.original_height;

        if (cropDragMode.current === "new") {
          const x = Math.min(cropStart.current.x, pos.x);
          const y = Math.min(cropStart.current.y, pos.y);
          const w = Math.abs(pos.x - cropStart.current.x);
          const h = Math.abs(pos.y - cropStart.current.y);
          if (w > 2 && h > 2) {
            setCropRect({ x, y, width: w, height: h });
          }
        } else if (cropDragMode.current === "move" && cropOrigRect.current) {
          const dx = pos.x - cropStart.current.x;
          const dy = pos.y - cropStart.current.y;
          const orig = cropOrigRect.current;
          const nx = Math.max(0, Math.min(imgW - orig.width, orig.x + dx));
          const ny = Math.max(0, Math.min(imgH - orig.height, orig.y + dy));
          setCropRect({ x: nx, y: ny, width: orig.width, height: orig.height });
        } else if (cropDragMode.current === "edge" && cropOrigRect.current) {
          const orig = cropOrigRect.current;
          const dx = pos.x - cropStart.current.x;
          const dy = pos.y - cropStart.current.y;
          let { x, y, width: w, height: h } = orig;
          const edge = cropEdge.current;

          if (edge === "left" || edge === "tl" || edge === "bl") {
            const newX = Math.max(0, Math.min(x + w - 3, x + dx));
            w = w + (x - newX);
            x = newX;
          }
          if (edge === "right" || edge === "tr" || edge === "br") {
            w = Math.max(3, Math.min(imgW - x, w + dx));
          }
          if (edge === "top" || edge === "tl" || edge === "tr") {
            const newY = Math.max(0, Math.min(y + h - 3, y + dy));
            h = h + (y - newY);
            y = newY;
          }
          if (edge === "bottom" || edge === "bl" || edge === "br") {
            h = Math.max(3, Math.min(imgH - y, h + dy));
          }
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
    [mouseToOriginal, mouseToPreview, imagePreview, interactionMode, loupePinned, cropRect, previewMode]
  );

  const handleCanvasMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isDraggingSample.current && imagePreview) {
        isDraggingSample.current = false;
        const end = mouseToPreview(e);
        if (end) {
          const x = Math.min(sampleStart.current.x, end.x);
          const y = Math.min(sampleStart.current.y, end.y);
          const w = Math.abs(end.x - sampleStart.current.x);
          const h = Math.abs(end.y - sampleStart.current.y);
          const region = w >= 1 && h >= 1
            ? { x, y, w, h }
            : { x: Math.floor(end.x), y: Math.floor(end.y), w: 1, h: 1 };
          if (region.w > 0 && region.h > 0) {
            const mean = sampleRegionMean(
              imagePreview.pixels,
              imagePreview.preview_width,
              region,
            );
            setPendingCalPoint({ region, sampledRgb: mean });
          }
        }
        setSampleDragRect(null);
        setPreviewMode("crop");
        return;
      }
      isDraggingCrop.current = false;
      isDraggingLoupe.current = false;
    },
    [imagePreview, mouseToPreview]
  );

  const handleCanvasMouseLeave = useCallback(() => {
    isDraggingCrop.current = false;
    isDraggingLoupe.current = false;
    isDraggingSample.current = false;
    setSampleDragRect(null);
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
      const adapter = getAdapter();
      const data = await adapter.importImage(
        filePath,
        Math.max(imagePreview.original_width, imagePreview.original_height),
        cropRect ? { x: cropRect.x, y: cropRect.y, width: cropRect.width, height: cropRect.height } : null,
        true,
      );
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

  // Expand crop rect to compensate for width compression, so output stays target size
  const getCompensatedCrop = useCallback((): CropRect | null => {
    if (!imagePreview) return cropRect;
    const imgW = imagePreview.original_width;
    const base = cropRect || { x: 0, y: 0, width: imgW, height: imagePreview.original_height };
    if (widthRatio >= 1.0) return cropRect;

    const expandedW = Math.min(imgW, Math.round(base.width / widthRatio));
    const extra = expandedW - base.width;

    let newX: number;
    if (widthExpand === "left") {
      newX = Math.max(0, base.x - extra);
    } else if (widthExpand === "right") {
      newX = base.x;
      if (newX + expandedW > imgW) newX = Math.max(0, imgW - expandedW);
    } else {
      newX = Math.max(0, base.x - Math.floor(extra / 2));
      if (newX + expandedW > imgW) newX = Math.max(0, imgW - expandedW);
    }
    const actualW = Math.min(expandedW, imgW - newX);
    return { x: newX, y: base.y, width: actualW, height: base.height };
  }, [cropRect, widthRatio, widthExpand, imagePreview]);

  const handlePreview = async () => {
    if (!filePath) return;
    setIsProcessing(true);
    try {
      const crop = getCompensatedCrop();

      const adapter = getAdapter();
      const data = await adapter.importImage(filePath, maxDimension, crop, sharpEdge, widthRatio !== 1.0 ? widthRatio : undefined);

      const calibratedPixels = applyCalibration(data.pixels as number[], calibrationCoef);
      let matched = matchImageToMard(calibratedPixels, algorithm, colorGroupId, colorOverrides);
      setMatchedPreview(matched);
      setRawPixels(data.pixels as number[]);
      setActualSize({ width: data.width, height: data.height });
      setShowComparison(false);
    } catch (e) {
      await appAlert(`导入失败: ${e}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCompare = async () => {
    if (!filePath) return;
    setIsProcessing(true);
    try {
      const crop = getCompensatedCrop();

      const adapter = getAdapter();
      const data = await adapter.importImage(filePath, maxDimension, crop, sharpEdge, widthRatio !== 1.0 ? widthRatio : undefined);
      setRawPixels(data.pixels as number[]);
      setActualSize({ width: data.width, height: data.height });

      const algos: { algo: ColorMatchAlgorithm; label: string }[] = [
        { algo: "euclidean", label: "RGB" },
        { algo: "ciede2000", label: "CIELAB" },
      ];
      const results: CompareItem[] = [];

      const calibratedPixels = applyCalibration(data.pixels as number[], calibrationCoef);
      for (const { algo, label } of algos) {
        const matched = matchImageToMard(calibratedPixels, algo, colorGroupId, colorOverrides);
        results.push({ label, algo, indices: matched });
      }

      setCompareResults(results);
      setShowComparison(true);
      setSelectedCompareIdx(null);
    } catch (e) {
      await appAlert(`对比生成失败: ${e}`);
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

  // Preview canvas display sizing. Base = current 1x size; zoom only applies in crop mode.
  const loupeMode = interactionMode === "loupe";
  const baseCanvasW = imagePreview
    ? Math.min(loupeMode ? 340 : 520, imagePreview.preview_width)
    : 0;
  const baseCanvasH = imagePreview
    ? Math.min(loupeMode ? 340 : 520, imagePreview.preview_height)
    : 0;
  const zoomFactor = loupeMode ? 1 : previewZoom;

  return (
    <>
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className={`bg-white rounded-lg shadow-xl max-h-[90vh] flex flex-col transition-all ${showComparison ? "w-[90vw] max-w-[1200px]" : "w-[560px]"}`}>
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
                {interactionMode === "crop" && (
                  <>
                    <div className="border-l mx-1 h-4" />
                    <span className="text-[10px] text-gray-500">缩放:</span>
                    <button
                      data-testid="preview-zoom-out"
                      onClick={() =>
                        setPreviewZoom((z) =>
                          ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(z) - 1)]
                        )
                      }
                      className="w-5 h-5 text-[10px] border rounded hover:bg-gray-200 flex items-center justify-center"
                      title="缩小"
                    >
                      −
                    </button>
                    <button
                      data-testid="preview-zoom-reset"
                      onClick={() => setPreviewZoom(1)}
                      className="text-[10px] text-gray-500 w-7 text-center hover:text-gray-700"
                      title="重置缩放"
                    >
                      {previewZoom}x
                    </button>
                    <button
                      data-testid="preview-zoom-in"
                      onClick={() =>
                        setPreviewZoom((z) =>
                          ZOOM_LEVELS[
                            Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(z) + 1)
                          ]
                        )
                      }
                      className="w-5 h-5 text-[10px] border rounded hover:bg-gray-200 flex items-center justify-center"
                      title="放大"
                    >
                      +
                    </button>
                  </>
                )}
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
                  <div
                    style={{
                      maxWidth: baseCanvasW,
                      maxHeight: baseCanvasH,
                      overflow: loupeMode ? "visible" : "auto",
                    }}
                  >
                    <canvas
                      ref={cropCanvasRef}
                      data-testid="crop-canvas"
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={handleCanvasMouseUp}
                      onMouseLeave={handleCanvasMouseLeave}
                      className={
                        interactionMode === "loupe"
                          ? "cursor-crosshair"
                          : ""
                      }
                      style={{
                        cursor: previewMode === "sample"
                          ? "crosshair"
                          : interactionMode === "crop" ? cropCursor : undefined,
                        width: baseCanvasW * zoomFactor,
                        height: baseCanvasH * zoomFactor,
                      }}
                    />
                  </div>
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

          {/* Color calibration */}
          <div className="border rounded">
            <button
              type="button"
              onClick={() => setCalibrationPanelOpen((v) => !v)}
              className="w-full px-3 py-2 flex justify-between items-center text-xs hover:bg-gray-50"
            >
              <span>{calibrationPanelOpen ? "▼" : "▶"} 色彩校正</span>
              <label className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={calibration.enabled}
                  onChange={(e) =>
                    setCalibration((prev) => ({ ...prev, enabled: e.target.checked }))
                  }
                />
                <span>启用</span>
              </label>
            </button>

            {calibrationPanelOpen && (
              <div className="p-3 border-t flex flex-col gap-3 text-xs">
                <div className="flex flex-col gap-1">
                  <span className="text-gray-500">参考点 (在预览图上拖矩形 → 选 MARD 色):</span>
                  {calibration.points.length === 0 ? (
                    <p className="text-gray-400 italic py-1">暂无参考点</p>
                  ) : (
                    calibration.points.map((p, idx) => {
                      const target = MARD_COLORS[p.targetColorIndex];
                      const targetHex = getEffectiveHex(p.targetColorIndex, colorOverrides);
                      return (
                        <div key={p.id} className="flex items-center gap-2 p-1.5 bg-gray-50 rounded border">
                          <span className="text-[10px] text-gray-500 font-mono w-4 shrink-0 text-center">{idx + 1}</span>
                          <div
                            className="w-5 h-5 rounded border shrink-0"
                            style={{ background: `rgb(${p.sampledRgb.map((v) => Math.round(v)).join(",")})` }}
                            title={`采样 (${p.sampledRgb.map((v) => Math.round(v)).join(",")})`}
                          />
                          <span className="text-gray-400">→</span>
                          <button
                            onClick={() =>
                              setPendingCalPoint({
                                region: p.region,
                                sampledRgb: p.sampledRgb,
                                editingId: p.id,
                              })
                            }
                            className="flex items-center gap-1 flex-1 min-w-0 hover:bg-gray-100 rounded px-1 py-0.5 text-left"
                            title="点击更改目标色"
                          >
                            <div
                              className="w-5 h-5 rounded border shrink-0"
                              style={{ background: targetHex }}
                            />
                            <span className="flex-1 truncate text-gray-600">
                              {target?.code} {target?.name}
                            </span>
                          </button>
                          <button
                            onClick={() =>
                              setCalibration((prev) => ({
                                ...prev,
                                points: prev.points.filter((pt) => pt.id !== p.id),
                              }))
                            }
                            className="text-red-500 hover:bg-red-50 px-2 py-0.5 rounded"
                          >
                            删
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                <button
                  onClick={() => setPreviewMode("sample")}
                  disabled={!imagePreview || previewMode === "sample"}
                  className="self-start px-3 py-1 border border-blue-300 text-blue-600 rounded hover:bg-blue-50 disabled:opacity-50"
                >
                  {previewMode === "sample" ? "拖矩形选择采样区..." : "+ 添加参考点"}
                </button>

                <div className="text-[10px] text-gray-400">
                  系数: R {calibrationCoef.a[0].toFixed(2)} {calibrationCoef.b[0] >= 0 ? "+" : ""}{calibrationCoef.b[0].toFixed(1)},
                  G {calibrationCoef.a[1].toFixed(2)} {calibrationCoef.b[1] >= 0 ? "+" : ""}{calibrationCoef.b[1].toFixed(1)},
                  B {calibrationCoef.a[2].toFixed(2)} {calibrationCoef.b[2] >= 0 ? "+" : ""}{calibrationCoef.b[2].toFixed(1)}
                </div>
              </div>
            )}
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
            <label className="text-xs text-gray-600 mt-2 mb-1 block">
              宽度补偿 ({Math.round(widthRatio * 100)}%)
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="range"
                min={85}
                max={100}
                value={Math.round(widthRatio * 100)}
                onChange={(e) => {
                  setWidthRatio(Number(e.target.value) / 100);
                  setMatchedPreview(null);
                  setActualSize(null);
                }}
                className="flex-1"
              />
              <button
                onClick={() => { setWidthRatio(1.0); setMatchedPreview(null); setActualSize(null); }}
                className="text-[10px] text-blue-500 hover:text-blue-700 shrink-0"
              >
                重置
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">向左拖动可让画面变窄，补偿像素化后视觉变宽的效果</p>
            {widthRatio < 1.0 && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-gray-500">扩展方向:</span>
                {(["center", "left", "right"] as const).map((d) => (
                  <label key={d} className="flex items-center gap-0.5 text-[10px]">
                    <input
                      type="radio"
                      name="widthExpand"
                      checked={widthExpand === d}
                      onChange={() => { setWidthExpand(d); setMatchedPreview(null); setActualSize(null); }}
                      className="w-3 h-3"
                    />
                    {{ center: "两侧", left: "左侧", right: "右侧" }[d]}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Preview / Compare / Confirm */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handlePreview}
              disabled={!filePath || isProcessing}
              className="px-3 py-1.5 bg-gray-600 text-white text-xs rounded hover:bg-gray-700 disabled:opacity-40"
            >
              {isProcessing ? "处理中..." : "预览"}
            </button>
            <button
              onClick={handleCompare}
              disabled={!filePath || isProcessing}
              className="px-3 py-1.5 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 disabled:opacity-40"
            >
              {isProcessing ? "处理中..." : "对比多种组合"}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!matchedPreview}
              className="px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-40"
            >
              确认导入
            </button>
          </div>

          {/* Comparison side-by-side */}
          {showComparison && actualSize && compareResults.length > 0 && (
            <div className="border rounded p-2 bg-gray-50">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-[10px] text-gray-500">
                  点击选择 ({actualSize.width}×{actualSize.height}):
                </p>
                <div className="flex items-center gap-1 ml-auto">
                  <button
                    onClick={() => setPreviewScale(Math.max(1, previewScale - 1))}
                    className="w-5 h-5 text-[10px] border rounded hover:bg-gray-200 flex items-center justify-center"
                  >−</button>
                  <span className="text-[10px] text-gray-500 w-6 text-center">{previewScale}x</span>
                  <button
                    onClick={() => setPreviewScale(Math.min(12, previewScale + 1))}
                    className="w-5 h-5 text-[10px] border rounded hover:bg-gray-200 flex items-center justify-center"
                  >+</button>
                </div>
              </div>
              <div className="flex gap-2">
                {compareResults.map((item, idx) => (
                  <div key={idx} className="flex-1 min-w-0 flex flex-col">
                    <button
                      onClick={() => {
                        setSelectedCompareIdx(idx);
                        setMatchedPreview(item.indices);
                        setAlgorithm(item.algo);
                      }}
                      className={`w-full px-2 py-1 text-xs rounded-t border-2 border-b-0 ${
                        selectedCompareIdx === idx
                          ? "bg-blue-100 border-blue-500 text-blue-700 font-semibold"
                          : "border-gray-300 hover:bg-gray-100"
                      }`}
                    >
                      {item.label} {selectedCompareIdx === idx && "✓"}
                    </button>
                    <div
                      ref={(el) => { compareScrollRefs.current[idx] = el; }}
                      onScroll={() => handleCompareScroll(idx)}
                      className={`overflow-auto border-2 rounded-b ${
                        selectedCompareIdx === idx ? "border-blue-500" : "border-gray-300"
                      }`}
                      style={{ maxHeight: 400 }}
                    >
                      <canvas
                        ref={(canvas) => {
                          if (!canvas || !actualSize) return;
                          canvas.width = actualSize.width;
                          canvas.height = actualSize.height;
                          const ctx = canvas.getContext("2d");
                          if (!ctx) return;
                          for (let r = 0; r < actualSize.height; r++) {
                            for (let c = 0; c < actualSize.width; c++) {
                              const ci = item.indices[r * actualSize.width + c];
                              ctx.fillStyle = getEffectiveHex(ci, colorOverrides);
                              ctx.fillRect(c, r, 1, 1);
                            }
                          }
                        }}
                        style={{
                          width: actualSize.width * previewScale,
                          height: actualSize.height * previewScale,
                          imageRendering: "pixelated",
                          display: "block",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Single matched result preview */}
          {!showComparison && matchedPreview && actualSize && (
            <div className="border rounded p-2 bg-gray-50">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[10px] text-gray-500">
                  匹配结果 ({actualSize.width}×{actualSize.height}):
                </p>
                <div className="flex items-center gap-1 ml-auto">
                  <button
                    onClick={() => setPreviewScale(Math.max(1, previewScale - 1))}
                    className="w-5 h-5 text-[10px] border rounded hover:bg-gray-200 flex items-center justify-center"
                  >−</button>
                  <span className="text-[10px] text-gray-500 w-6 text-center">{previewScale}x</span>
                  <button
                    onClick={() => setPreviewScale(Math.min(12, previewScale + 1))}
                    className="w-5 h-5 text-[10px] border rounded hover:bg-gray-200 flex items-center justify-center"
                  >+</button>
                </div>
              </div>
              <div className="overflow-auto max-h-[400px]">
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
                        ctx.fillStyle = getEffectiveHex(idx, colorOverrides);
                        ctx.fillRect(col, row, 1, 1);
                      }
                    }
                  }}
                  style={{
                    width: actualSize.width * previewScale,
                    height: actualSize.height * previewScale,
                    imageRendering: "pixelated",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {pendingCalPoint && (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
        <div className="bg-white rounded-lg shadow-xl p-4 w-[480px] max-h-[70vh] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">
              {pendingCalPoint.editingId ? "更改目标 MARD 色" : "选择目标 MARD 色"}
            </h3>
            <button
              onClick={() => setPendingCalPoint(null)}
              aria-label="关闭"
              className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            >
              ×
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-500">采样色:</span>
            <div
              className="w-8 h-8 rounded border"
              style={{
                background: `rgb(${pendingCalPoint.sampledRgb.map((v) => Math.round(v)).join(",")})`,
              }}
            />
            <span className="text-gray-600">
              ({pendingCalPoint.sampledRgb.map((v) => Math.round(v)).join(", ")})
            </span>
          </div>

          <div className="overflow-y-auto flex flex-col gap-1.5">
            {groupIndicesByLetter(getGroupIndices(colorGroupId)).map(({ letter, indices }) => (
              <div key={letter} className="flex items-start gap-2">
                <span className="text-[11px] text-gray-500 font-mono w-5 shrink-0 pt-1">{letter}</span>
                <div className="flex flex-wrap gap-1 flex-1">
                  {indices.map((idx) => {
                    const c = MARD_COLORS[idx];
                    if (!c) return null;
                    const hex = getEffectiveHex(idx, colorOverrides);
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          const editingId = pendingCalPoint.editingId;
                          setCalibration((prev) => {
                            if (editingId) {
                              return {
                                ...prev,
                                enabled: true,
                                points: prev.points.map((pt) =>
                                  pt.id === editingId ? { ...pt, targetColorIndex: idx } : pt,
                                ),
                              };
                            }
                            const newPoint = {
                              id: crypto.randomUUID(),
                              region: pendingCalPoint.region,
                              sampledRgb: pendingCalPoint.sampledRgb,
                              targetColorIndex: idx,
                            };
                            return { ...prev, enabled: true, points: [...prev.points, newPoint] };
                          });
                          setPendingCalPoint(null);
                        }}
                        title={`${c.code} ${c.name}`}
                        className="w-6 h-6 rounded border hover:ring-2 hover:ring-blue-400"
                        style={{ background: hex }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
