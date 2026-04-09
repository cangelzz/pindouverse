import { useRef, useEffect, useCallback } from "react";
import { useEditorStore } from "../../store/editorStore";
import { renderPixels, renderGrid } from "../../utils/canvasRenderer";
import { MARD_COLORS } from "../../data/mard221";

export function PixelCanvas() {
  const pixelCanvasRef = useRef<HTMLCanvasElement>(null);
  const refCanvasRef = useRef<HTMLCanvasElement>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
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

  // Bead layer controls
  const beadLayerVisible = useEditorStore((s) => s.beadLayerVisible);
  const beadLayerOpacity = useEditorStore((s) => s.beadLayerOpacity);
  const highlightColorIndex = useEditorStore((s) => s.highlightColorIndex);

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
    if (!container || !pc || !rc || !gc) return;

    const w = container.clientWidth;
    const h = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    for (const c of [pc, rc, gc]) {
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

  // Render pixel layer
  useEffect(() => {
    const ctx = pixelCanvasRef.current?.getContext("2d");
    if (!ctx || !containerRef.current) return;

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;

    ctx.clearRect(0, 0, w, h);

    if (!beadLayerVisible) return;

    ctx.globalAlpha = beadLayerOpacity;
    renderPixels(ctx, {
      canvasData,
      cellSize,
      offsetX,
      offsetY,
      viewWidth: w,
      viewHeight: h,
      highlightColorIndex,
    });
    ctx.globalAlpha = 1;
  }, [canvasData, cellSize, offsetX, offsetY, beadLayerVisible, beadLayerOpacity, highlightColorIndex]);

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
      </div>
    </div>
  );
}
