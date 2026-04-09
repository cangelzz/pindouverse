import { useRef, useEffect, useCallback } from "react";
import { useEditorStore } from "../../store/editorStore";
import { renderPixels, renderGrid } from "../../utils/canvasRenderer";
import { MARD_COLORS } from "../../data/mard221";

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
  const setZoom = useEditorStore((s) => s.setZoom);
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

  // Track dragging state
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const isPanning = useRef(false);

  // Resize canvases to fill container
  const resize = useCallback(() => {
    const container = containerRef.current;
    const pc = pixelCanvasRef.current;
    const rc = refCanvasRef.current;
    const gc = gridCanvasRef.current;
    const ac = axisCanvasRef.current;
    if (!container || !pc || !rc || !gc || !ac) return;

    const w = container.clientWidth;
    const h = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    for (const c of [pc, rc, gc, ac]) {
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.getContext("2d")?.scale(dpr, dpr);
    }
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  // Render pixel layers
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
      });
    }
  }, [layers, canvasData, cellSize, offsetX, offsetY, highlightColorIndex, blueprintMode]);

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
        const x = col * cellSize + offsetX;
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
  }, [refImagePixels, refImageWidth, refImageHeight, refImageVisible, refImageOpacity, cellSize, offsetX, offsetY]);

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
  }, [canvasSize, cellSize, offsetX, offsetY, gridConfig]);

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
  }, [blueprintMode, canvasSize, cellSize, offsetX, offsetY, gridConfig]);

  // Convert screen position to cell coordinates
  const screenToCell = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;

      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const col = Math.floor((x - offsetX) / cellSize);
      const row = Math.floor((y - offsetY) / cellSize);

      if (row < 0 || row >= canvasSize.height || col < 0 || col >= canvasSize.width) {
        return null;
      }
      return { row, col };
    },
    [offsetX, offsetY, cellSize, canvasSize]
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
        isDragging.current = true;
        const cell = screenToCell(e.clientX, e.clientY);
        if (cell) applyTool(cell.row, cell.col);
      }
    },
    [currentTool, offsetX, offsetY, screenToCell, applyTool]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning.current) {
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        setOffset(dragStart.current.ox + dx, dragStart.current.oy + dy);
        return;
      }

      if (isDragging.current && e.buttons === 1) {
        const cell = screenToCell(e.clientX, e.clientY);
        if (cell) applyTool(cell.row, cell.col);
      }
    },
    [screenToCell, applyTool, setOffset]
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    isPanning.current = false;
  }, []);



  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        useEditorStore.getState().undo();
      } else if (e.ctrlKey && e.key === "y") {
        e.preventDefault();
        useEditorStore.getState().redo();
      } else if (e.key === " ") {
        e.preventDefault();
        useEditorStore.getState().setTool("pan");
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
      : currentTool === "eyedropper"
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
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
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
        <canvas ref={axisCanvasRef} className="absolute inset-0 pointer-events-none" />
      </div>
    </div>
  );
}
