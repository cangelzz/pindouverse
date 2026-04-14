import { useRef, useEffect, useCallback, useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import { renderPixels, renderGrid } from "../../utils/canvasRenderer";
import { MARD_COLORS } from "../../data/mard221";
import { useVoiceControl, type VoiceCommand } from "../../hooks/useVoiceControl";
import { playDone, playUnknown, playListenStart, speak, warmupAudio } from "../../utils/audioFeedback";
import { PreviewThumbnail } from "./PreviewThumbnail";
import { lineCells, rectCells, circleCells, constrainLine, constrainRect } from "../../utils/shapeDrawing";
import { renderMarchingAnts, renderResizeHandles, renderFloatingSelection } from "../../utils/selectionRenderer";

export function PixelCanvas() {
  const pixelCanvasRef = useRef<HTMLCanvasElement>(null);
  const refCanvasRef = useRef<HTMLCanvasElement>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const axisCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const canvasData = useEditorStore((s) => s.canvasData);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const cellSize = useEditorStore((s) => s.cellSize);
  const offsetX = useEditorStore((s) => s.offsetX);
  const offsetY = useEditorStore((s) => s.offsetY);
  const zoom = useEditorStore((s) => s.zoom);
  const gridConfig = useEditorStore((s) => s.gridConfig);
  const currentTool = useEditorStore((s) => s.currentTool);
  const selectedColorIndex = useEditorStore((s) => s.selectedColorIndex);
  const setCell = useEditorStore((s) => s.setCell);
  const setOffset = useEditorStore((s) => s.setOffset);
  const setSelectedColor = useEditorStore((s) => s.setSelectedColor);
  const setTool = useEditorStore((s) => s.setTool);

  // Reference image layer
  const refImagePixels = useEditorStore((s) => s.refImagePixels);
  const refImageWidth = useEditorStore((s) => s.refImageWidth);
  const refImageHeight = useEditorStore((s) => s.refImageHeight);
  const refImageVisible = useEditorStore((s) => s.refImageVisible);
  const refImageOpacity = useEditorStore((s) => s.refImageOpacity);

  // Layers
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const highlightColorIndex = useEditorStore((s) => s.highlightColorIndex);
  const blueprintMode = useEditorStore((s) => s.blueprintMode);
  const blueprintMirror = useEditorStore((s) => s.blueprintMirror);
  const gridFocusMode = useEditorStore((s) => s.gridFocusMode);
  const voiceControlEnabled = useEditorStore((s) => s.voiceControlEnabled);
  const setVoiceControlEnabled = useEditorStore((s) => s.setVoiceControlEnabled);
  const aiVoiceEnabled = useEditorStore((s) => s.aiVoiceEnabled);

  const selection = useEditorStore((s) => s.selection);
  const selectionBounds = useEditorStore((s) => s.selectionBounds);
  const floatingSelectionState = useEditorStore((s) => s.floatingSelection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const commitFloatingSelection = useEditorStore((s) => s.commitFloatingSelection);
  const moveSelectionCells = useEditorStore((s) => s.moveSelectionCells);

  // Track dragging state
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const isPanning = useRef(false);

  const selectionStart = useRef<{ row: number; col: number } | null>(null);
  const isDraggingSelection = useRef(false);
  const selectionDragStart = useRef<{ row: number; col: number; mouseX: number; mouseY: number } | null>(null);

  // Shape tool state: track start cell and current preview cells
  const shapeStart = useRef<{ row: number; col: number } | null>(null);
  const [shapePreview, setShapePreview] = useState<[number, number][] | null>(null);
  const shapeCanvasRef = useRef<HTMLCanvasElement>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null);

  // Resize counter to trigger re-renders after canvas resize
  const [resizeCount, setResizeCount] = useState(0);
  const [containerDims, setContainerDims] = useState({ w: 0, h: 0 });

  // Preview thumbnail
  const [showThumbnail, setShowThumbnail] = useState(false);

  // Blueprint mode: focused 5×5 grid group highlight
  const [focusGroup, setFocusGroup] = useState<{ groupCol: number; groupRow: number } | null>(null);
  const focusGroupRef = useRef(focusGroup);
  focusGroupRef.current = focusGroup;

  // Voice command feedback
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const voiceFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Voice control: move grid focus by voice
  const handleVoiceCommand = useCallback(
    (result: { command: VoiceCommand; raw: string; repeat?: number; gotoCol?: number; gotoRow?: number }) => {
      const state = useEditorStore.getState();
      const { groupSize, edgePadding, startX = 1, startY = 1 } = state.gridConfig;
      const innerW = state.canvasSize.width - edgePadding * 2;
      const innerH = state.canvasSize.height - edgePadding * 2;
      const maxGC = Math.ceil(innerW / groupSize) - 1;
      const maxGR = Math.ceil(innerH / groupSize) - 1;

      const repeat = result.repeat ?? 1;

      const LABELS: Record<string, string> = {
        up: "⬆ 上", down: "⬇ 下", left: "⬅ 左", right: "➡ 右",
        cancel: "❌ 取消", confirm: "✅ 确认", summary: "📊 总结",
        goto: "📍 定位", still_here: "👋 还在", unknown: `? ${result.raw}`,
      };

      // Handle "still here" — just confirm and reset timer
      if (result.command === "still_here") {
        playDone("A");
        setTimeout(() => speak("好的，继续", "zh-CN"), 250);
        setVoiceFeedback("👋 还在");
        if (voiceFeedbackTimer.current) clearTimeout(voiceFeedbackTimer.current);
        voiceFeedbackTimer.current = setTimeout(() => setVoiceFeedback(null), 1500);
        return;
      }

      // Handle summary command
      if (result.command === "summary") {
        const currentFocus = focusGroupRef.current;
        if (currentFocus) {
          const startR = edgePadding + currentFocus.groupRow * groupSize;
          const startC = edgePadding + currentFocus.groupCol * groupSize;
          const coordCol = currentFocus.groupCol * groupSize + startX;
          const coordRow = currentFocus.groupRow * groupSize + startY;
          const counts = new Map<number, number>();
          for (let r = startR; r < startR + groupSize && r < state.canvasSize.height; r++) {
            for (let c = startC; c < startC + groupSize && c < state.canvasSize.width; c++) {
              const ci = state.canvasData[r]?.[c]?.colorIndex;
              if (ci !== null && ci !== undefined) {
                counts.set(ci, (counts.get(ci) ?? 0) + 1);
              }
            }
          }
          const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
          if (sorted.length === 0) {
            playDone("A");
            setTimeout(() => speak("空格", "zh-CN"), 250);
          } else {
            const total = sorted.length;
            const allCodes = sorted.map(([ci]) => MARD_COLORS[ci].code).join("，");
            const top2 = sorted.slice(0, 2).map(([ci, cnt]) =>
              `${MARD_COLORS[ci].code} ${cnt}颗`
            );
            const text = `位于${coordCol}列${coordRow}行，共${total}种颜色，分别是${allCodes}，最多的${top2.length === 1 ? "是" : "两个是"}${top2.join("和")}`;
            playDone("A");
            setTimeout(() => speak(text, "zh-CN"), 250);
          }
        } else {
          playUnknown();
          setTimeout(() => speak("请先选择一个网格", "zh-CN"), 250);
        }
        setVoiceFeedback(LABELS.summary);
        if (voiceFeedbackTimer.current) clearTimeout(voiceFeedbackTimer.current);
        voiceFeedbackTimer.current = setTimeout(() => setVoiceFeedback(null), 3000);
        return;
      }

      // Handle goto command — jump to grid containing the target cell
      if (result.command === "goto" && result.gotoCol !== undefined && result.gotoRow !== undefined) {
        const targetCol = result.gotoCol - startX; // convert label to 0-based
        const targetRow = result.gotoRow - startY;
        const gc = Math.max(0, Math.min(maxGC, Math.floor(targetCol / groupSize)));
        const gr = Math.max(0, Math.min(maxGR, Math.floor(targetRow / groupSize)));
        setFocusGroup({ groupCol: gc, groupRow: gr });
        playDone("A");
        const label = `定位 ${result.gotoCol}列${result.gotoRow}行`;
        setVoiceFeedback(`📍 ${label}`);
        setTimeout(() => speak(label, "zh-CN"), 250);
        if (voiceFeedbackTimer.current) clearTimeout(voiceFeedbackTimer.current);
        voiceFeedbackTimer.current = setTimeout(() => setVoiceFeedback(null), 1500);
        return;
      }

      // Handle directional moves (with repeat)
      setFocusGroup((prev) => {
        let gc = prev ? prev.groupCol : 0;
        let gr = prev ? prev.groupRow : 0;
        for (let i = 0; i < repeat; i++) {
          switch (result.command) {
            case "up": gr = Math.max(0, gr - 1); break;
            case "down": gr = Math.min(maxGR, gr + 1); break;
            case "left": gc = Math.max(0, gc - 1); break;
            case "right": gc = Math.min(maxGC, gc + 1); break;
            case "cancel": return null;
            default: return prev;
          }
        }
        if (!prev) return { groupCol: 0, groupRow: 0 };
        return { groupCol: gc, groupRow: gr };
      });

      // Show feedback and play sound
      if (result.command !== "unknown") {
        playDone("A");
        const SPEAK: Record<string, string> = {
          up: "上", down: "下", left: "左", right: "右",
          cancel: "取消", confirm: "确认",
        };
        const word = SPEAK[result.command] ?? "";
        const isEdge = repeat >= 99;
        const spk = isEdge ? `最${word}` : (repeat > 1 ? `${word}${repeat}次` : word);
        setTimeout(() => speak(spk, "zh-CN"), 250);
      } else {
        playUnknown();
      }
      const isEdge = repeat >= 99;
      const label = isEdge ? `${LABELS[result.command] ?? ""} ⏩` : (repeat > 1 ? `${LABELS[result.command] ?? ""} ×${repeat}` : (LABELS[result.command] ?? result.raw));
      setVoiceFeedback(label);
      if (voiceFeedbackTimer.current) clearTimeout(voiceFeedbackTimer.current);
      voiceFeedbackTimer.current = setTimeout(() => setVoiceFeedback(null), 1200);
    },
    []
  );

  // Voice control: start/stop based on store toggle
  const voiceControl = useVoiceControl({ onCommand: handleVoiceCommand, useLLM: aiVoiceEnabled });

  // Sync store when voice auto-stops (idle timeout) — only if it was previously listening
  const wasListening = useRef(false);
  useEffect(() => {
    if (voiceControl.isListening) {
      wasListening.current = true;
    } else if (wasListening.current && voiceControlEnabled) {
      wasListening.current = false;
      setVoiceControlEnabled(false);
    }
  }, [voiceControl.isListening, voiceControlEnabled, setVoiceControlEnabled]);

  useEffect(() => {
    if (voiceControlEnabled && gridFocusMode && blueprintMode) {
      warmupAudio();
      voiceControl.start();
      playListenStart();
    } else {
      voiceControl.stop();
      if (voiceControlEnabled && (!gridFocusMode || !blueprintMode)) {
        setVoiceControlEnabled(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceControlEnabled, gridFocusMode, blueprintMode]);

  // Resize canvases to fill container
  const resize = useCallback(() => {
    const container = containerRef.current;
    const pc = pixelCanvasRef.current;
    const rc = refCanvasRef.current;
    const gc = gridCanvasRef.current;
    const ac = axisCanvasRef.current;
    const selc = selectionCanvasRef.current;
    if (!container || !pc || !rc || !gc || !ac || !selc) return;

    const w = container.clientWidth;
    const h = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    for (const c of [pc, rc, gc, ac, selc]) {
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.getContext("2d")?.scale(dpr, dpr);
    }
    setResizeCount((c) => c + 1);
    setContainerDims({ w, h });
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  // Clear focus group when leaving blueprint mode or grid focus mode
  useEffect(() => {
    if (!blueprintMode || !gridFocusMode) setFocusGroup(null);
  }, [blueprintMode, gridFocusMode]);

  // Render pixel layers
  const isMirror = blueprintMode && blueprintMirror;
  useEffect(() => {
    const ctx = pixelCanvasRef.current?.getContext("2d");
    if (!ctx || !containerRef.current) return;

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    ctx.clearRect(0, 0, w, h);

    // Render each visible layer from bottom to top (colors only, no blueprint text)
    for (const layer of layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      renderPixels(ctx, {
        canvasData: layer.data,
        cellSize,
        offsetX,
        offsetY,
        viewWidth: w,
        viewHeight: h,
        highlightColorIndex,
        blueprintMode: false, // text rendered separately below
        mirror: isMirror,
      });
    }
    ctx.globalAlpha = 1;

    // Blueprint text uses merged canvasData so codes match the visible top-layer color
    if (blueprintMode) {
      renderPixels(ctx, {
        canvasData,
        cellSize,
        offsetX,
        offsetY,
        viewWidth: w,
        viewHeight: h,
        highlightColorIndex,
        blueprintMode: true,
        textOnly: true,
        mirror: isMirror,
      });
    }
  }, [layers, canvasData, cellSize, offsetX, offsetY, highlightColorIndex, blueprintMode, isMirror, resizeCount]);

  // Render reference image layer
  useEffect(() => {
    const ctx = refCanvasRef.current?.getContext("2d");
    if (!ctx || !containerRef.current) return;

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    ctx.clearRect(0, 0, w, h);

    if (!refImagePixels || !refImageVisible || refImageOpacity <= 0) return;

    // Build an ImageData from the RGB pixels, map each pixel to one cell
    ctx.globalAlpha = refImageOpacity;
    for (let row = 0; row < refImageHeight; row++) {
      for (let col = 0; col < refImageWidth; col++) {
        const drawCol = isMirror ? (refImageWidth - 1 - col) : col;
        const x = drawCol * cellSize + offsetX;
        const y = row * cellSize + offsetY;

        // Cull off-screen
        if (x + cellSize < 0 || x > w || y + cellSize < 0 || y > h) continue;

        const idx = (row * refImageWidth + col) * 3;
        const r = refImagePixels[idx];
        const g = refImagePixels[idx + 1];
        const b = refImagePixels[idx + 2];
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, cellSize, cellSize);
      }
    }
    ctx.globalAlpha = 1;
  }, [refImagePixels, refImageWidth, refImageHeight, refImageVisible, refImageOpacity, cellSize, offsetX, offsetY, isMirror, resizeCount]);

  // Render grid layer
  useEffect(() => {
    const ctx = gridCanvasRef.current?.getContext("2d");
    if (!ctx || !containerRef.current) return;

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;

    renderGrid(
      ctx,
      canvasSize.width,
      canvasSize.height,
      cellSize,
      offsetX,
      offsetY,
      w,
      h,
      gridConfig
    );

    // Draw focused 5×5 group highlight in blueprint mode
    if (blueprintMode && gridFocusMode && focusGroup) {
      const { groupSize, edgePadding } = gridConfig;
      const gc = focusGroup.groupCol;
      const gr = focusGroup.groupRow;
      const startC = edgePadding + gc * groupSize;
      const startR = edgePadding + gr * groupSize;
      const x0 = startC * cellSize + offsetX;
      const y0 = startR * cellSize + offsetY;
      const gw = groupSize * cellSize;
      const gh = groupSize * cellSize;

      // Compute average color in the group to pick contrasting highlight
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let r = startR; r < startR + groupSize && r < canvasSize.height; r++) {
        for (let c = startC; c < startC + groupSize && c < canvasSize.width; c++) {
          const cell = canvasData[r]?.[c];
          if (cell?.colorIndex !== null && cell?.colorIndex !== undefined) {
            const hex = MARD_COLORS[cell.colorIndex]?.hex;
            if (hex) {
              rSum += parseInt(hex.slice(1, 3), 16);
              gSum += parseInt(hex.slice(3, 5), 16);
              bSum += parseInt(hex.slice(5, 7), 16);
              count++;
            }
          }
        }
      }
      let highlightColor: string;
      if (count > 0) {
        const avgLum = (0.299 * rSum + 0.587 * gSum + 0.114 * bSum) / count;
        // Light area → dark highlight, dark area → bright highlight
        highlightColor = avgLum > 128
          ? "rgba(220,38,38,0.85)"   // red for light backgrounds
          : "rgba(34,211,238,0.85)";  // cyan for dark backgrounds
      } else {
        highlightColor = "rgba(59,130,246,0.85)"; // blue for empty
      }

      ctx.strokeStyle = highlightColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(x0, y0, gw, gh);

      // Semi-transparent overlay outside the focused group
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(0, 0, w, y0);
      ctx.fillRect(0, y0 + gh, w, h - y0 - gh);
      ctx.fillRect(0, y0, x0, gh);
      ctx.fillRect(x0 + gw, y0, w - x0 - gw, gh);
    }
  }, [canvasSize, canvasData, cellSize, offsetX, offsetY, gridConfig, blueprintMode, gridFocusMode, focusGroup, resizeCount]);

  // Render selection overlay (marching ants + handles + floating)
  const [antOffset, setAntOffset] = useState(0);
  useEffect(() => {
    if (!selection && !floatingSelectionState) return;
    let animId: number;
    const animate = () => {
      setAntOffset((prev) => (prev + 0.5) % 16);
      animId = requestAnimationFrame(animate);
    };
    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [selection, floatingSelectionState]);

  useEffect(() => {
    const ctx = selectionCanvasRef.current?.getContext("2d");
    if (!ctx || !containerRef.current) return;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    ctx.clearRect(0, 0, w, h);

    if (floatingSelectionState) {
      renderFloatingSelection(
        ctx,
        floatingSelectionState.cells,
        floatingSelectionState.offsetRow,
        floatingSelectionState.offsetCol,
        cellSize, offsetX, offsetY,
      );
    }

    if (selection && selection.size > 0) {
      renderMarchingAnts(ctx, selection, cellSize, offsetX, offsetY, antOffset);
      if (selectionBounds) {
        renderResizeHandles(ctx, selectionBounds, cellSize, offsetX, offsetY);
      }
    }
  }, [selection, selectionBounds, floatingSelectionState, cellSize, offsetX, offsetY, antOffset, resizeCount]);

  // Render shape preview overlay
  useEffect(() => {
    const canvas = shapeCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !containerRef.current) return;

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    canvas!.width = w;
    canvas!.height = h;
    ctx.clearRect(0, 0, w, h);

    if (!shapePreview || shapePreview.length === 0) return;

    // Get selected color for preview
    const color = selectedColorIndex !== null ? MARD_COLORS[selectedColorIndex] : null;
    if (color?.rgb) {
      ctx.fillStyle = `rgba(${color.rgb[0]},${color.rgb[1]},${color.rgb[2]},0.5)`;
    } else {
      ctx.fillStyle = "rgba(100,100,255,0.3)";
    }

    for (const [r, c] of shapePreview) {
      if (r < 0 || r >= canvasSize.height || c < 0 || c >= canvasSize.width) continue;
      const displayCol = isMirror ? canvasSize.width - 1 - c : c;
      const x = displayCol * cellSize + offsetX;
      const y = r * cellSize + offsetY;
      ctx.fillRect(x, y, cellSize, cellSize);
    }

    // Draw outline
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    for (const [r, c] of shapePreview) {
      if (r < 0 || r >= canvasSize.height || c < 0 || c >= canvasSize.width) continue;
      const displayCol = isMirror ? canvasSize.width - 1 - c : c;
      const x = displayCol * cellSize + offsetX;
      const y = r * cellSize + offsetY;
      ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
    }
  }, [shapePreview, cellSize, offsetX, offsetY, canvasSize, selectedColorIndex, isMirror]);

  // Render floating axis labels in blueprint mode
  useEffect(() => {
    const ctx = axisCanvasRef.current?.getContext("2d");
    if (!ctx || !containerRef.current) return;

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    ctx.clearRect(0, 0, w, h);

    if (!blueprintMode) return;

    const { startX = 1, startY = 1, edgePadding = 0 } = gridConfig;
    const fontSize = Math.max(8, Math.min(cellSize * 0.4, 14));
    ctx.font = `bold ${fontSize}px monospace`;
    const labelH = fontSize + 4;

    // Column numbers along top edge (only for grid area, skip edge padding cells)
    const startCol = Math.max(edgePadding, Math.floor(-offsetX / cellSize));
    const endCol = Math.min(canvasSize.width - edgePadding, Math.ceil((w - offsetX) / cellSize));

    // Background bar for column labels
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(0, 0, w, labelH);
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(0, labelH - 1, w, 1);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(80,80,80,0.9)";

    for (let col = startCol; col < endCol; col++) {
      const x = col * cellSize + offsetX + cellSize / 2;
      if (x > 0 && x < w) {
        ctx.fillText(`${col - edgePadding + startX}`, x, labelH / 2);
      }
    }

    // Row numbers along left edge (only for grid area, skip edge padding cells)
    const startRow = Math.max(edgePadding, Math.floor(-offsetY / cellSize));
    const endRow = Math.min(canvasSize.height - edgePadding, Math.ceil((h - offsetY) / cellSize));
    const labelW = Math.max(fontSize * 2.5, 24);

    // Background bar for row labels
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(0, labelH, labelW, h - labelH);
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(labelW - 1, labelH, 1, h - labelH);

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(80,80,80,0.9)";

    for (let row = startRow; row < endRow; row++) {
      const y = row * cellSize + offsetY + cellSize / 2;
      if (y > labelH && y < h) {
        ctx.fillText(`${row - edgePadding + startY}`, labelW / 2, y);
      }
    }

    // Corner box
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(0, 0, labelW, labelH);
  }, [blueprintMode, canvasSize, cellSize, offsetX, offsetY, gridConfig, resizeCount]);

  // Convert screen position to cell coordinates
  const screenToCell = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;

      const x = clientX - rect.left;
      const y = clientY - rect.top;

      let col = Math.floor((x - offsetX) / cellSize);
      const row = Math.floor((y - offsetY) / cellSize);

      // In mirror mode, map visual column to the mirrored data column
      if (isMirror) {
        col = canvasSize.width - 1 - col;
      }

      if (row < 0 || row >= canvasSize.height || col < 0 || col >= canvasSize.width) {
        return null;
      }
      return { row, col };
    },
    [offsetX, offsetY, cellSize, canvasSize, isMirror]
  );

  const isShapeTool = currentTool === "line" || currentTool === "rect" || currentTool === "circle";

  // Compute shape cells from start to end, applying Shift constraint
  const computeShapeCells = useCallback(
    (startRow: number, startCol: number, endRow: number, endCol: number, shiftKey: boolean): [number, number][] => {
      switch (currentTool) {
        case "line": {
          let [er, ec] = [endRow, endCol];
          if (shiftKey) [er, ec] = constrainLine(startRow, startCol, endRow, endCol);
          return lineCells(startRow, startCol, er, ec);
        }
        case "rect": {
          let [er, ec] = [endRow, endCol];
          if (shiftKey) [er, ec] = constrainRect(startRow, startCol, endRow, endCol);
          return rectCells(startRow, startCol, er, ec, false);
        }
        case "circle": {
          const dr = Math.abs(endRow - startRow);
          const dc = Math.abs(endCol - startCol);
          const radius = Math.round(Math.sqrt(dr * dr + dc * dc));
          return circleCells(startRow, startCol, radius, false);
        }
        default:
          return [];
      }
    },
    [currentTool]
  );

  // Handle tool action on a cell
  const applyTool = useCallback(
    (row: number, col: number) => {
      switch (currentTool) {
        case "pen":
          setCell(row, col, selectedColorIndex);
          break;
        case "eraser":
          setCell(row, col, null);
          break;
        case "fill": {
          // Flood fill: fill connected cells of the same color
          const state = useEditorStore.getState();
          const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
          if (layerIdx === -1) break;
          const layerData = state.layers[layerIdx].data;
          const targetColor = layerData[row]?.[col]?.colorIndex ?? null;
          const fillColor = selectedColorIndex;
          if (targetColor === fillColor) break; // same color, no-op
          const w = state.canvasSize.width;
          const h = state.canvasSize.height;
          const visited = new Set<string>();
          const queue: [number, number][] = [[row, col]];
          const entries: { row: number; col: number; colorIndex: number | null }[] = [];
          while (queue.length > 0) {
            const [r, c] = queue.pop()!;
            const key = `${r},${c}`;
            if (visited.has(key)) continue;
            if (r < 0 || r >= h || c < 0 || c >= w) continue;
            const cellColor = layerData[r]?.[c]?.colorIndex ?? null;
            if (cellColor !== targetColor) continue;
            visited.add(key);
            entries.push({ row: r, col: c, colorIndex: fillColor });
            queue.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
          }
          if (entries.length > 0) {
            useEditorStore.getState().batchSetCells(entries);
          }
          break;
        }
        case "eyedropper": {
          const cell = canvasData[row]?.[col];
          if (cell?.colorIndex !== null && cell?.colorIndex !== undefined) {
            setSelectedColor(cell.colorIndex);
            setTool("pen");
          }
          break;
        }
      }
    },
    [currentTool, selectedColorIndex, canvasData, setCell, setSelectedColor, setTool]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Middle button or space+left = pan
      if (e.button === 1 || (e.button === 0 && currentTool === "pan")) {
        isPanning.current = true;
        dragStart.current = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY };
        e.preventDefault();
        return;
      }

      if (e.button === 0) {
        const cell = screenToCell(e.clientX, e.clientY);
        if (!cell) return;

        // Selection tool: start rectangle drag
        if (currentTool === "select") {
          const cell = screenToCell(e.clientX, e.clientY);
          if (!cell) return;
          const { row, col } = cell;
          if (selection && selection.has(`${row},${col}`)) {
            isDraggingSelection.current = true;
            selectionDragStart.current = { row, col, mouseX: e.clientX, mouseY: e.clientY };
            return;
          }
          if (floatingSelectionState) {
            commitFloatingSelection();
          }
          selectionStart.current = { row, col };
          setSelection(new Set([`${row},${col}`]));
          return;
        }

        // Magic wand tool: flood select on click
        if (currentTool === "wand") {
          const cell = screenToCell(e.clientX, e.clientY);
          if (!cell) return;
          const { row, col } = cell;
          const state = useEditorStore.getState();
          const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
          if (layerIdx === -1) return;
          const layerData = state.layers[layerIdx].data;
          const { width, height } = state.canvasSize;
          const targetColor = layerData[row]?.[col]?.colorIndex ?? null;
          const visited = new Set<string>();
          const queue: [number, number][] = [[row, col]];
          while (queue.length > 0) {
            const [r, c] = queue.pop()!;
            const key = `${r},${c}`;
            if (visited.has(key)) continue;
            if (r < 0 || r >= height || c < 0 || c >= width) continue;
            const cellColor = layerData[r]?.[c]?.colorIndex ?? null;
            if (cellColor !== targetColor) continue;
            visited.add(key);
            queue.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
          }
          if (e.shiftKey && selection) {
            const merged = new Set(selection);
            for (const k of visited) merged.add(k);
            setSelection(merged);
          } else {
            setSelection(visited);
          }
          return;
        }

        if (isShapeTool) {
          // Shape tools: record start point, begin preview
          shapeStart.current = cell;
          setShapePreview([]);
        } else {
          isDragging.current = true;
          applyTool(cell.row, cell.col);
        }
      }
    },
    [currentTool, offsetX, offsetY, screenToCell, applyTool, isShapeTool, selection, floatingSelectionState, commitFloatingSelection, setSelection]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning.current) {
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        setOffset(dragStart.current.ox + dx, dragStart.current.oy + dy);
        return;
      }

      // Selection rectangle drag
      if (currentTool === "select" && selectionStart.current && !isDraggingSelection.current) {
        const cell = screenToCell(e.clientX, e.clientY);
        if (!cell) return;
        const sr = selectionStart.current.row;
        const sc = selectionStart.current.col;
        const er = cell.row;
        const ec = cell.col;
        const r1 = Math.min(sr, er);
        const c1 = Math.min(sc, ec);
        const r2 = Math.max(sr, er);
        const c2 = Math.max(sc, ec);
        const cells = new Set<string>();
        for (let r = r1; r <= r2; r++) {
          for (let c = c1; c <= c2; c++) {
            cells.add(`${r},${c}`);
          }
        }
        setSelection(cells);
        return;
      }

      // Shape tool preview
      if (shapeStart.current && isShapeTool) {
        const cell = screenToCell(e.clientX, e.clientY);
        if (cell) {
          const cells = computeShapeCells(
            shapeStart.current.row, shapeStart.current.col,
            cell.row, cell.col, e.shiftKey
          );
          setShapePreview(cells);
        }
        return;
      }

      if (isDragging.current && e.buttons === 1) {
        const cell = screenToCell(e.clientX, e.clientY);
        if (cell) applyTool(cell.row, cell.col);
      }
    },
    [screenToCell, applyTool, setOffset, isShapeTool, computeShapeCells, currentTool, setSelection]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      // Finish selection rectangle
      if (currentTool === "select" && selectionStart.current) {
        selectionStart.current = null;
      }

      // Finish moving selection cells
      if (isDraggingSelection.current && selectionDragStart.current) {
        const cell = screenToCell(e.clientX, e.clientY);
        if (cell) {
          const dRow = cell.row - selectionDragStart.current.row;
          const dCol = cell.col - selectionDragStart.current.col;
          if (dRow !== 0 || dCol !== 0) {
            moveSelectionCells(dRow, dCol);
          }
        }
        isDraggingSelection.current = false;
        selectionDragStart.current = null;
      }

      // Shape tool: commit the shape
      if (shapeStart.current && isShapeTool && shapePreview && shapePreview.length > 0) {
        const entries = shapePreview
          .filter(([r, c]) => r >= 0 && r < canvasSize.height && c >= 0 && c < canvasSize.width)
          .map(([r, c]) => ({ row: r, col: c, colorIndex: selectedColorIndex }));
        if (entries.length > 0) {
          useEditorStore.getState().batchSetCells(entries);
        }
      }
      shapeStart.current = null;
      setShapePreview(null);
      isDragging.current = false;
      isPanning.current = false;
    },
    [isShapeTool, shapePreview, canvasSize, selectedColorIndex, currentTool, screenToCell, moveSelectionCells]
  );

  // Double-click to set/toggle grid focus (works in any tool mode including pan)
  // Uses visual (screen) column, NOT mirrored data column
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!gridFocusMode || !blueprintMode) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const visualCol = Math.floor((x - offsetX) / cellSize);
      const visualRow = Math.floor((y - offsetY) / cellSize);
      if (visualRow < 0 || visualRow >= canvasSize.height || visualCol < 0 || visualCol >= canvasSize.width) return;

      const { groupSize, edgePadding } = gridConfig;
      const col = visualCol - edgePadding;
      const row = visualRow - edgePadding;
      const innerW = canvasSize.width - edgePadding * 2;
      const innerH = canvasSize.height - edgePadding * 2;
      if (col >= 0 && col < innerW && row >= 0 && row < innerH) {
        const gc = Math.floor(col / groupSize);
        const gr = Math.floor(row / groupSize);
        if (focusGroup && focusGroup.groupCol === gc && focusGroup.groupRow === gr) {
          setFocusGroup(null);
        } else {
          setFocusGroup({ groupCol: gc, groupRow: gr });
        }
      } else {
        setFocusGroup(null);
      }
    },
    [gridFocusMode, blueprintMode, offsetX, offsetY, cellSize, gridConfig, canvasSize, focusGroup]
  );



  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        useEditorStore.getState().undo();
      } else if (e.ctrlKey && e.key === "y") {
        e.preventDefault();
        useEditorStore.getState().redo();
      } else if (e.ctrlKey && e.key === "c") {
        e.preventDefault();
        useEditorStore.getState().copySelection();
      } else if (e.ctrlKey && e.key === "x") {
        e.preventDefault();
        useEditorStore.getState().cutSelection();
      } else if (e.ctrlKey && e.key === "v") {
        e.preventDefault();
        useEditorStore.getState().pasteClipboard();
      } else if (e.ctrlKey && e.key === "a") {
        e.preventDefault();
        useEditorStore.getState().selectAll();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (useEditorStore.getState().selection) {
          e.preventDefault();
          useEditorStore.getState().deleteSelection();
        }
      } else if (e.key === " ") {
        e.preventDefault();
        useEditorStore.getState().setTool("pan");
      } else if (!e.ctrlKey && !e.metaKey) {
        // Tool shortcuts (single key, no modifier)
        const toolMap: Record<string, import("../../types").EditorTool> = {
          p: "pen", l: "line", r: "rect", c: "circle",
          f: "fill", e: "eraser", i: "eyedropper",
          s: "select", w: "wand",
        };
        const tool = toolMap[e.key.toLowerCase()];
        if (tool) {
          e.preventDefault();
          useEditorStore.getState().setTool(tool);
        }
      } else if (e.key === "Escape") {
        // Cancel shape in progress
        if (shapeStart.current) {
          shapeStart.current = null;
          setShapePreview(null);
        }
        const state = useEditorStore.getState();
        if (state.floatingSelection) {
          state.commitFloatingSelection();
        } else if (state.selection) {
          state.clearSelection();
        }
        setFocusGroup(null);
      } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        // Move focus group with arrow keys
        setFocusGroup((prev) => {
          const state = useEditorStore.getState();
          if (!state.gridFocusMode || !state.blueprintMode) return prev;
          const { groupSize, edgePadding } = state.gridConfig;
          const innerW = state.canvasSize.width - edgePadding * 2;
          const innerH = state.canvasSize.height - edgePadding * 2;
          const maxGC = Math.ceil(innerW / groupSize) - 1;
          const maxGR = Math.ceil(innerH / groupSize) - 1;

          // If no focus yet, start at (0,0)
          const gc = prev ? prev.groupCol : 0;
          const gr = prev ? prev.groupRow : 0;
          let nc = gc, nr = gr;
          if (e.key === "ArrowLeft") nc = Math.max(0, gc - 1);
          if (e.key === "ArrowRight") nc = Math.min(maxGC, gc + 1);
          if (e.key === "ArrowUp") nr = Math.max(0, gr - 1);
          if (e.key === "ArrowDown") nr = Math.min(maxGR, gr + 1);

          if (!prev && nc === gc && nr === gr) {
            return { groupCol: 0, groupRow: 0 };
          }
          return { groupCol: nc, groupRow: nr };
        });
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") {
        useEditorStore.getState().setTool("pen");
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Cursor style
  const cursor =
    currentTool === "pan"
      ? "grab"
      : currentTool === "eyedropper" || currentTool === "fill"
        ? "crosshair"
        : currentTool === "select" || currentTool === "wand"
          ? "crosshair"
          : "default";

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {/* Status bar */}
      <div className="flex items-center gap-4 px-3 py-1 bg-gray-100 border-b text-xs text-gray-600 select-none">
        <span>
          画布: {canvasSize.width}×{canvasSize.height}
        </span>
        <span>缩放: {Math.round(zoom * 100)}%</span>
        {selectedColorIndex !== null && (
          <span className="flex items-center gap-1">
            当前色:
            <span
              className="inline-block w-3 h-3 border border-gray-400 rounded-sm"
              style={{ backgroundColor: MARD_COLORS[selectedColorIndex]?.hex }}
            />
            {MARD_COLORS[selectedColorIndex]?.code}
          </span>
        )}
        <span className="text-blue-500">
          图层: {layers.find((l) => l.id === activeLayerId)?.name ?? "—"}
        </span>
        {blueprintMode && blueprintMirror && (
          <span className="text-purple-500">🪞 镜像</span>
        )}
        {voiceControl.isListening && (
          <span className="text-red-500 animate-pulse">🎤 语音控制中</span>
        )}
        {voiceFeedback && (
          <span className="text-green-600 font-semibold">{voiceFeedback}</span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setShowThumbnail(!showThumbnail)}
          className={`px-1.5 py-0.5 rounded text-[10px] ${showThumbnail ? "bg-blue-100 text-blue-600" : "hover:bg-gray-200"}`}
          title={showThumbnail ? "关闭预览缩略图" : "显示预览缩略图"}
        >
          🖼️ 预览
        </button>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        data-canvas-container
        className="relative flex-1 overflow-hidden"
        style={{
          cursor,
          backgroundColor: "#e5e5e5",
          backgroundImage:
            "linear-gradient(45deg, #d0d0d0 25%, transparent 25%), linear-gradient(-45deg, #d0d0d0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d0d0d0 75%), linear-gradient(-45deg, transparent 75%, #d0d0d0 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas
          ref={refCanvasRef}
          className="absolute inset-0"
          style={{ imageRendering: "pixelated" }}
        />
        <canvas
          ref={pixelCanvasRef}
          className="absolute inset-0"
          style={{ imageRendering: "pixelated" }}
        />
        <canvas ref={gridCanvasRef} className="absolute inset-0 pointer-events-none" />
        <canvas ref={shapeCanvasRef} className="absolute inset-0 pointer-events-none" />
        <canvas ref={axisCanvasRef} className="absolute inset-0 pointer-events-none" />
        {showThumbnail && containerDims.w > 0 && (
          <PreviewThumbnail
            containerWidth={containerDims.w}
            containerHeight={containerDims.h}
          />
        )}
      </div>
    </div>
  );
}
