import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Canvas, Input, ScrollView, Text, View } from '@tarojs/components';
import type { CanvasTouchEvent } from '@tarojs/components';
import Taro, { useRouter, useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import type { CanvasData, ColorOverrideMap } from '@pindou/core';
import { MARD_COLORS, COLOR_GROUPS, getGroupIndices, getEffectiveHex, hexToRgb } from '@pindou/core';
import { lineCells, rectCells, circleCells } from '../../utils/shapeDrawing';
import {
  rectSelectionCells,
  cloneSelectionRegion,
  applyClipboardToData,
  type ClipboardPayload,
  type SelectionBounds,
} from '../../utils/selectionUtils';
import { computeFloodReplaceEntries, computeFloodSelectCells } from '../../utils/floodFill';
import './index.scss';

const CANVAS_ID = 'pindouEditorCanvas';
const EXPORT_CANVAS_ID = 'pindouExportCanvas';
const GRID_GROUP = 5;
const STATS_LIMIT = 6;
const MIN_SCALE = 0.5;
const MAX_SCALE = 12;

type Tool = 'pen' | 'eraser' | 'fill' | 'eyedropper' | 'pan' | 'line' | 'rect' | 'circle' | 'select' | 'eraserFill' | 'wand';
type ShapeTool = 'line' | 'rect' | 'circle';

interface StoredProject {
  id: string;
  name: string;
  data: CanvasData;
  width: number;
  height: number;
  algorithm: string;
  createdAt: number;
}

interface CanvasNode {
  width: number;
  height: number;
  getContext: (t: string) => CanvasRenderingContext2D;
}

interface CellPatch {
  row: number;
  col: number;
  prev: number | null;
  next: number | null;
}

interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface BeadStat {
  index: number;
  code: string;
  name: string;
  hex: string;
  count: number;
}

const TOOL_LIST: { id: Tool; label: string; icon: string }[] = [
  { id: 'pen', label: '画笔', icon: '✎' },
  { id: 'eraser', label: '橡皮', icon: '⌫' },
  { id: 'fill', label: '油漆桶', icon: '🪣' },
  { id: 'eyedropper', label: '取色', icon: '◎' },
  { id: 'pan', label: '平移', icon: '✋' },
];

function cloneData(src: CanvasData): CanvasData {
  return src.map((row) => row.map((cell) => ({ colorIndex: cell.colorIndex })));
}

function applyPatches(data: CanvasData, patches: CellPatch[], forward: boolean): CanvasData {
  for (const p of patches) {
    if (data[p.row]?.[p.col]) {
      data[p.row][p.col] = { colorIndex: forward ? p.next : p.prev };
    }
  }
  return data;
}

function hexToLightTint(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return '#f8f8f8';
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const mix = (c: number) => Math.round(c * 0.25 + 255 * 0.75);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function boundsFromCells(cells: Set<string>): SelectionBounds {
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const key of cells) {
    const [rStr, cStr] = key.split(',');
    const r = Number(rStr);
    const c = Number(cStr);
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  return { r1: minR, c1: minC, r2: maxR, c2: maxC };
}

export default function ResultPage() {
  const router = useRouter();
  const [project, setProject] = useState<StoredProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<CanvasData | null>(null);
  const [history, setHistory] = useState<CellPatch[][]>([]);
  const [histPos, setHistPos] = useState(0);
  const [tool, setTool] = useState<Tool>('pen');
  const [selectedColorIndex, setSelectedColorIndex] = useState<number>(0);
  const [view, setView] = useState<ViewState>({ scale: 1, offsetX: 0, offsetY: 0 });
  const [dirty, setDirty] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteGroup, setPaletteGroup] = useState<string>('mard221');
  const [paletteQuery, setPaletteQuery] = useState<string>('');
  const [onlyUsed, setOnlyUsed] = useState<boolean>(false);
  const [activeShape, setActiveShape] = useState<ShapeTool>('line');
  const [shapeFilled, setShapeFilled] = useState<boolean>(false);
  const [shapePreview, setShapePreview] = useState<[number, number][] | null>(null);
  const shapeStartRef = useRef<{ row: number; col: number } | null>(null);
  const [selectionBounds, setSelectionBounds] = useState<SelectionBounds | null>(null);
  const [selectionCellsIrregular, setSelectionCellsIrregular] = useState<Set<string> | null>(null);
  const [floatingPaste, setFloatingPaste] = useState<{
    payload: ClipboardPayload;
    offsetRow: number;
    offsetCol: number;
  } | null>(null);
  const selectionDragRef = useRef<{ startRow: number; startCol: number } | null>(null);
  const pasteDragRef = useRef<{ startTouchX: number; startTouchY: number; startOffsetRow: number; startOffsetCol: number } | null>(null);
  const clipboardRef = useRef<ClipboardPayload | null>(null);
  const [recentColors, setRecentColors] = useState<number[]>(() => {
    try {
      const raw = Taro.getStorageSync('pindou:recentColors');
      if (!raw) return [];
      const arr = JSON.parse(raw as string) as number[];
      return Array.isArray(arr) ? arr.filter((n) => Number.isInteger(n) && n >= 0 && n < MARD_COLORS.length).slice(0, 8) : [];
    } catch {
      return [];
    }
  });
  const [overrides, setOverrides] = useState<ColorOverrideMap>(() => {
    try {
      const raw = Taro.getStorageSync('pindou:overrides');
      if (!raw) return new Map();
      const entries = JSON.parse(raw as string) as Array<[number, { hex: string; rgb: [number, number, number] }]>;
      return new Map(entries);
    } catch {
      return new Map();
    }
  });

  const dataRef = useRef<CanvasData | null>(null);
  const viewRef = useRef<ViewState>({ scale: 1, offsetX: 0, offsetY: 0 });
  const overridesRef = useRef<ColorOverrideMap>(overrides);
  const cellBaseRef = useRef(8);
  const canvasCssRef = useRef({ width: 320, height: 320, ratio: 2 });
  const [showGrid, setShowGrid] = useState<boolean>(() => {
    try {
      const v = Taro.getStorageSync('pindou:showGrid');
      return v === '' || v === undefined || v === null ? true : !!v;
    } catch {
      return true;
    }
  });
  const showGridRef = useRef(showGrid);
  const [blueprintMode, setBlueprintMode] = useState<boolean>(() => {
    try {
      return !!Taro.getStorageSync('pindou:blueprint:mode');
    } catch {
      return false;
    }
  });
  const [blueprintMirror, setBlueprintMirror] = useState<boolean>(() => {
    try {
      return !!Taro.getStorageSync('pindou:blueprint:mirror');
    } catch {
      return false;
    }
  });
  const blueprintModeRef = useRef(blueprintMode);
  const blueprintMirrorRef = useRef(blueprintMirror);
  const strokeRef = useRef<{ patches: CellPatch[]; lastCell: string | null } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const pinchRef = useRef<{
    startDist: number;
    startScale: number;
    centerX: number;
    centerY: number;
    startOX: number;
    startOY: number;
  } | null>(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);

  useEffect(() => {
    showGridRef.current = showGrid;
    try {
      Taro.setStorageSync('pindou:showGrid', showGrid);
    } catch {}
  }, [showGrid]);

  useEffect(() => {
    blueprintModeRef.current = blueprintMode;
    try {
      Taro.setStorageSync('pindou:blueprint:mode', blueprintMode);
    } catch {}
  }, [blueprintMode]);

  useEffect(() => {
    blueprintMirrorRef.current = blueprintMirror;
    try {
      Taro.setStorageSync('pindou:blueprint:mirror', blueprintMirror);
    } catch {}
  }, [blueprintMirror]);

  const pushRecent = useCallback((idx: number) => {
    setRecentColors((prev) => {
      const next = [idx, ...prev.filter((n) => n !== idx)].slice(0, 8);
      try {
        Taro.setStorageSync('pindou:recentColors', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const id = router.params.id;
    if (router.params.new === '1') {
      try {
        const w = Math.max(8, Math.min(200, Number(router.params.w) || 52));
        const h = Math.max(8, Math.min(200, Number(router.params.h) || 52));
        const blank: CanvasData = [];
        for (let r = 0; r < h; r++) {
          const row = [];
          for (let c = 0; c < w; c++) row.push({ colorIndex: null });
          blank.push(row);
        }
        const stamp = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const name = `新作品 ${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
        const fresh: StoredProject = {
          id: 'p_' + Date.now(),
          name,
          data: blank,
          width: w,
          height: h,
          algorithm: 'blank',
          createdAt: Date.now(),
        };
        try {
          const list = (Taro.getStorageSync('pindou:projects') as StoredProject[]) || [];
          Taro.setStorageSync('pindou:projects', [fresh, ...list]);
        } catch {}
        setProject(fresh);
        const cloned = cloneData(fresh.data);
        setData(cloned);
        dataRef.current = cloned;
      } catch {
        setLoadError('创建空白作品失败');
      }
      return;
    }
    if (!id) {
      setLoadError('缺少作品 id');
      return;
    }
    try {
      const list = (Taro.getStorageSync('pindou:projects') as StoredProject[]) || [];
      const found = list.find((p) => p.id === id);
      if (!found) {
        setLoadError('作品不存在或已被删除');
        return;
      }
      setProject(found);
      const cloned = cloneData(found.data);
      setData(cloned);
      dataRef.current = cloned;
    } catch {
      setLoadError('读取作品失败');
    }
  }, [router.params.id, router.params.new, router.params.w, router.params.h]);

  useEffect(() => {
    if (!project) return;
    const sys = Taro.getSystemInfoSync();
    const cssSide = Math.min(sys.windowWidth - 32, Math.floor(sys.windowHeight * 0.55));
    const side = Math.max(220, cssSide);
    canvasCssRef.current = {
      width: side,
      height: side,
      ratio: sys.pixelRatio || 2,
    };
    const cellBase = Math.max(1, Math.min(side / project.width, side / project.height));
    cellBaseRef.current = cellBase;
    const drawW = cellBase * project.width;
    const drawH = cellBase * project.height;
    const next: ViewState = {
      scale: 1,
      offsetX: (side - drawW) / 2,
      offsetY: (side - drawH) / 2,
    };
    setView(next);
    viewRef.current = next;
  }, [project]);

  const drawCanvas = useCallback(() => {
    if (!project || !dataRef.current) return;
    const query = Taro.createSelectorQuery();
    query
      .select(`#${CANVAS_ID}`)
      .node()
      .exec((nodeRes) => {
        const node = nodeRes?.[0]?.node as CanvasNode | undefined;
        if (!node) return;
        const { width: cssW, height: cssH, ratio } = canvasCssRef.current;
        node.width = cssW * ratio;
        node.height = cssH * ratio;
        const ctx = node.getContext('2d');
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.fillStyle = '#f4f4f6';
        ctx.fillRect(0, 0, cssW, cssH);

        const { scale, offsetX, offsetY } = viewRef.current;
        const cell = cellBaseRef.current * scale;
        const drawW = cell * project.width;
        const drawH = cell * project.height;

        ctx.save();
        ctx.translate(offsetX, offsetY);
        if (blueprintModeRef.current && blueprintMirrorRef.current) {
          ctx.translate(drawW, 0);
          ctx.scale(-1, 1);
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, drawW, drawH);

        const src = dataRef.current!;
        const ov = overridesRef.current;
        const isBlueprint = blueprintModeRef.current;
        const fontSize = Math.max(8, Math.floor(cell * 0.4));
        if (isBlueprint) {
          ctx.font = `${fontSize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
        }
        for (let r = 0; r < project.height; r++) {
          for (let c = 0; c < project.width; c++) {
            const idx = src[r][c].colorIndex;
            if (idx === null || idx === undefined) continue;
            const hex = getEffectiveHex(idx, ov);
            if (isBlueprint) {
              ctx.fillStyle = hexToLightTint(hex);
              ctx.fillRect(c * cell, r * cell, cell, cell);
              if (cell >= 10) {
                ctx.fillStyle = '#222';
                ctx.fillText(
                  MARD_COLORS[idx]?.code ?? '',
                  c * cell + cell / 2,
                  r * cell + cell / 2,
                );
              }
            } else {
              ctx.fillStyle = hex;
              ctx.fillRect(c * cell, r * cell, cell, cell);
            }
          }
        }

        if (shapePreview && shapePreview.length > 0) {
          const hex = getEffectiveHex(selectedColorIndex, overrides);
          const rgb = hexToRgb(hex);
          ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.55)`;
          for (const [r, c] of shapePreview) {
            if (r < 0 || r >= project.height || c < 0 || c >= project.width) continue;
            ctx.fillRect(c * cell, r * cell, cell, cell);
          }
        }

        if (selectionBounds) {
          const b = selectionBounds;
          const minR = Math.min(b.r1, b.r2);
          const maxR = Math.max(b.r1, b.r2);
          const minC = Math.min(b.c1, b.c2);
          const maxC = Math.max(b.c1, b.c2);
          const x = minC * cell;
          const y = minR * cell;
          const w = (maxC - minC + 1) * cell;
          const h = (maxR - minR + 1) * cell;
          ctx.save();
          ctx.fillStyle = 'rgba(80, 130, 255, 0.15)';
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = 'rgba(40, 80, 220, 0.9)';
          ctx.setLineDash([4, 3]);
          ctx.lineWidth = Math.max(1, cell * 0.05);
          ctx.strokeRect(x, y, w, h);
          ctx.setLineDash([]);
          ctx.restore();
        }

        if (selectionCellsIrregular && selectionCellsIrregular.size > 0) {
          ctx.save();
          ctx.fillStyle = 'rgba(80, 180, 100, 0.18)';
          for (const key of selectionCellsIrregular) {
            const [rStr, cStr] = key.split(',');
            const r = Number(rStr);
            const c = Number(cStr);
            ctx.fillRect(c * cell, r * cell, cell, cell);
          }
          ctx.strokeStyle = 'rgba(40, 120, 60, 0.95)';
          ctx.lineWidth = Math.max(1, cell * 0.06);
          ctx.beginPath();
          for (const key of selectionCellsIrregular) {
            const [rStr, cStr] = key.split(',');
            const r = Number(rStr);
            const c = Number(cStr);
            if (!selectionCellsIrregular.has(`${r - 1},${c}`)) {
              ctx.moveTo(c * cell, r * cell);
              ctx.lineTo((c + 1) * cell, r * cell);
            }
            if (!selectionCellsIrregular.has(`${r + 1},${c}`)) {
              ctx.moveTo(c * cell, (r + 1) * cell);
              ctx.lineTo((c + 1) * cell, (r + 1) * cell);
            }
            if (!selectionCellsIrregular.has(`${r},${c - 1}`)) {
              ctx.moveTo(c * cell, r * cell);
              ctx.lineTo(c * cell, (r + 1) * cell);
            }
            if (!selectionCellsIrregular.has(`${r},${c + 1}`)) {
              ctx.moveTo((c + 1) * cell, r * cell);
              ctx.lineTo((c + 1) * cell, (r + 1) * cell);
            }
          }
          ctx.stroke();
          ctx.restore();
        }

        if (floatingPaste) {
          const fp = floatingPaste;
          ctx.save();
          ctx.globalAlpha = 0.85;
          for (let r = 0; r < fp.payload.h; r++) {
            for (let c = 0; c < fp.payload.w; c++) {
              const tr = fp.offsetRow + r;
              const tc = fp.offsetCol + c;
              if (tr < 0 || tr >= project.height || tc < 0 || tc >= project.width) continue;
              const idx = fp.payload.cells[r][c];
              if (idx === null) continue;
              ctx.fillStyle = getEffectiveHex(idx, overrides);
              ctx.fillRect(tc * cell, tr * cell, cell, cell);
            }
          }
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(220, 80, 40, 0.9)';
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = Math.max(1, cell * 0.05);
          const minR = Math.max(0, fp.offsetRow);
          const minC = Math.max(0, fp.offsetCol);
          const maxR = Math.min(project.height, fp.offsetRow + fp.payload.h);
          const maxC = Math.min(project.width, fp.offsetCol + fp.payload.w);
          if (maxR > minR && maxC > minC) {
            ctx.strokeRect(minC * cell, minR * cell, (maxC - minC) * cell, (maxR - minR) * cell);
          }
          ctx.setLineDash([]);
          ctx.restore();
        }

        if (showGridRef.current && cell >= 4) {
          ctx.strokeStyle = 'rgba(0,0,0,0.08)';
          ctx.lineWidth = 0.5;
          for (let r = 0; r <= project.height; r++) {
            ctx.beginPath();
            ctx.moveTo(0, r * cell);
            ctx.lineTo(drawW, r * cell);
            ctx.stroke();
          }
          for (let c = 0; c <= project.width; c++) {
            ctx.beginPath();
            ctx.moveTo(c * cell, 0);
            ctx.lineTo(c * cell, drawH);
            ctx.stroke();
          }
        }
        if (showGridRef.current) {
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = Math.max(1, cell * 0.06);
          for (let r = 0; r <= project.height; r += GRID_GROUP) {
            ctx.beginPath();
            ctx.moveTo(0, r * cell);
            ctx.lineTo(drawW, r * cell);
            ctx.stroke();
          }
          for (let c = 0; c <= project.width; c += GRID_GROUP) {
            ctx.beginPath();
            ctx.moveTo(c * cell, 0);
            ctx.lineTo(c * cell, drawH);
            ctx.stroke();
          }
        }
        ctx.restore();
      });
  }, [project, shapePreview, selectedColorIndex, overrides, blueprintMode, blueprintMirror, selectionBounds, floatingPaste, selectionCellsIrregular]);

  useEffect(() => {
    if (!project || !data) return;
    const t = setTimeout(drawCanvas, 20);
    return () => clearTimeout(t);
  }, [project, data, view, drawCanvas, overrides, showGrid, shapePreview, blueprintMode, blueprintMirror, selectionBounds, floatingPaste, selectionCellsIrregular]);

  const pickCell = useCallback(
    (touchX: number, touchY: number): { row: number; col: number } | null => {
      if (!project) return null;
      const { scale, offsetX, offsetY } = viewRef.current;
      const cell = cellBaseRef.current * scale;
      let col = Math.floor((touchX - offsetX) / cell);
      const row = Math.floor((touchY - offsetY) / cell);
      if (row < 0 || row >= project.height || col < 0 || col >= project.width) return null;
      if (blueprintModeRef.current && blueprintMirrorRef.current) {
        col = project.width - 1 - col;
      }
      return { row, col };
    },
    [project],
  );

  const computeShapeCells = useCallback(
    (start: { row: number; col: number }, end: { row: number; col: number }): [number, number][] => {
      if (activeShape === 'line') {
        return lineCells(start.row, start.col, end.row, end.col);
      }
      if (activeShape === 'rect') {
        return rectCells(start.row, start.col, end.row, end.col, shapeFilled);
      }
      const dr = end.row - start.row;
      const dc = end.col - start.col;
      const radius = Math.round(Math.hypot(dr, dc));
      return circleCells(start.row, start.col, radius, shapeFilled);
    },
    [activeShape, shapeFilled],
  );

  const commitStroke = useCallback(() => {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    if (!stroke || stroke.patches.length === 0) return;
    setHistory((prev) => {
      const truncated = prev.slice(0, histPos);
      truncated.push(stroke.patches);
      return truncated;
    });
    setHistPos((p) => p + 1);
    setDirty(true);
  }, [histPos]);

  const applyCellEdit = useCallback(
    (row: number, col: number, next: number | null): boolean => {
      const d = dataRef.current;
      if (!d) return false;
      const prev = d[row][col].colorIndex ?? null;
      if (prev === next) return false;
      d[row][col] = { colorIndex: next };
      if (!strokeRef.current) {
        strokeRef.current = { patches: [], lastCell: null };
      }
      strokeRef.current.patches.push({ row, col, prev, next });
      return true;
    },
    [],
  );

  const handleTouchStart = useCallback(
    (e: CanvasTouchEvent) => {
      if (!project || !dataRef.current) return;
      const touches = e.touches;
      if (touches.length === 2) {
        panRef.current = null;
        strokeRef.current = null;
        const t1 = touches[0];
        const t2 = touches[1];
        const dist = Math.hypot(t2.x - t1.x, t2.y - t1.y);
        pinchRef.current = {
          startDist: dist,
          startScale: viewRef.current.scale,
          centerX: (t1.x + t2.x) / 2,
          centerY: (t1.y + t2.y) / 2,
          startOX: viewRef.current.offsetX,
          startOY: viewRef.current.offsetY,
        };
        return;
      }
      if (touches.length !== 1) return;
      const { x, y } = touches[0];
      if (floatingPaste) {
        pasteDragRef.current = {
          startTouchX: x,
          startTouchY: y,
          startOffsetRow: floatingPaste.offsetRow,
          startOffsetCol: floatingPaste.offsetCol,
        };
        return;
      }
      if (tool === 'pan') {
        panRef.current = {
          startX: x,
          startY: y,
          ox: viewRef.current.offsetX,
          oy: viewRef.current.offsetY,
        };
        return;
      }
      const cell = pickCell(x, y);
      if (!cell) return;
      if (tool === 'eyedropper') {
        const idx = dataRef.current[cell.row][cell.col].colorIndex;
        const pos = `(${cell.row + 1},${cell.col + 1})`;
        if (idx !== null && idx !== undefined) {
          setSelectedColorIndex(idx);
          pushRecent(idx);
          setTool('pen');
          Taro.showToast({ title: `${MARD_COLORS[idx].code} ${pos}`, icon: 'none' });
        } else {
          Taro.showToast({ title: `空格 ${pos}`, icon: 'none' });
        }
        return;
      }
      if (tool === 'fill' || tool === 'eraserFill') {
        const next = tool === 'eraserFill' ? null : selectedColorIndex;
        const entries = computeFloodReplaceEntries(
          dataRef.current,
          cell.row,
          cell.col,
          next,
          project.width,
          project.height,
        );
        if (entries.length === 0) return;
        const patches = entries.map((e) => ({
          row: e.row,
          col: e.col,
          prev: dataRef.current![e.row][e.col].colorIndex ?? null,
          next: e.colorIndex,
        }));
        for (const e of entries) {
          dataRef.current![e.row][e.col] = { colorIndex: e.colorIndex };
        }
        strokeRef.current = { patches, lastCell: null };
        commitStroke();
        setData(cloneData(dataRef.current));
        return;
      }
      if (tool === 'wand') {
        const cells = computeFloodSelectCells(
          dataRef.current,
          cell.row,
          cell.col,
          project.width,
          project.height,
        );
        if (cells.size === 0) return;
        setSelectionBounds(null);
        setSelectionCellsIrregular(cells);
        return;
      }
      if (tool === 'line' || tool === 'rect' || tool === 'circle') {
        shapeStartRef.current = cell;
        setShapePreview([[cell.row, cell.col]]);
        return;
      }
      if (tool === 'select') {
        selectionDragRef.current = { startRow: cell.row, startCol: cell.col };
        setSelectionBounds({ r1: cell.row, c1: cell.col, r2: cell.row, c2: cell.col });
        return;
      }
      const next = tool === 'eraser' ? null : selectedColorIndex;
      const changed = applyCellEdit(cell.row, cell.col, next);
      if (strokeRef.current) strokeRef.current.lastCell = `${cell.row},${cell.col}`;
      if (changed) {
        setData(cloneData(dataRef.current));
      }
    },
    [project, tool, selectedColorIndex, pickCell, applyCellEdit, commitStroke, floatingPaste],
  );

  const handleTouchMove = useCallback(
    (e: CanvasTouchEvent) => {
      if (!project) return;
      const touches = e.touches;
      if (touches.length === 2 && pinchRef.current) {
        const t1 = touches[0];
        const t2 = touches[1];
        const dist = Math.hypot(t2.x - t1.x, t2.y - t1.y);
        if (pinchRef.current.startDist < 1) return;
        const next = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, pinchRef.current.startScale * (dist / pinchRef.current.startDist)),
        );
        const ratio = next / pinchRef.current.startScale;
        const cx = pinchRef.current.centerX;
        const cy = pinchRef.current.centerY;
        const ox = cx - (cx - pinchRef.current.startOX) * ratio;
        const oy = cy - (cy - pinchRef.current.startOY) * ratio;
        const nextView = { scale: next, offsetX: ox, offsetY: oy };
        viewRef.current = nextView;
        setView(nextView);
        return;
      }
      if (touches.length !== 1) return;
      const { x, y } = touches[0];
      if (tool === 'pan' && panRef.current) {
        const dx = x - panRef.current.startX;
        const dy = y - panRef.current.startY;
        const nextView = {
          scale: viewRef.current.scale,
          offsetX: panRef.current.ox + dx,
          offsetY: panRef.current.oy + dy,
        };
        viewRef.current = nextView;
        setView(nextView);
        return;
      }
      if (floatingPaste && pasteDragRef.current) {
        const dx = x - pasteDragRef.current.startTouchX;
        const dy = y - pasteDragRef.current.startTouchY;
        const scale = viewRef.current.scale;
        const cellPx = cellBaseRef.current * scale;
        const dCol = Math.round(dx / cellPx);
        const dRow = Math.round(dy / cellPx);
        setFloatingPaste((cur) => cur && {
          ...cur,
          offsetRow: pasteDragRef.current!.startOffsetRow + dRow,
          offsetCol: pasteDragRef.current!.startOffsetCol + dCol,
        });
        return;
      }
      if (tool === 'select' && selectionDragRef.current) {
        const cell = pickCell(x, y);
        if (!cell) return;
        setSelectionBounds({
          r1: selectionDragRef.current.startRow,
          c1: selectionDragRef.current.startCol,
          r2: cell.row,
          c2: cell.col,
        });
        return;
      }
      if (tool === 'pen' || tool === 'eraser') {
        const cell = pickCell(x, y);
        if (!cell) return;
        const key = `${cell.row},${cell.col}`;
        if (strokeRef.current && strokeRef.current.lastCell === key) return;
        const next = tool === 'eraser' ? null : selectedColorIndex;
        const changed = applyCellEdit(cell.row, cell.col, next);
        if (strokeRef.current) strokeRef.current.lastCell = key;
        if (changed) {
          setData(cloneData(dataRef.current!));
        }
      }
      if (
        (tool === 'line' || tool === 'rect' || tool === 'circle') &&
        shapeStartRef.current
      ) {
        const cell = pickCell(x, y);
        if (!cell) return;
        const preview = computeShapeCells(shapeStartRef.current, cell);
        setShapePreview(preview);
        return;
      }
    },
    [project, tool, selectedColorIndex, pickCell, applyCellEdit, computeShapeCells, floatingPaste],
  );

  const handleTouchEnd = useCallback(() => {
    pinchRef.current = null;
    panRef.current = null;

    if (
      (tool === 'line' || tool === 'rect' || tool === 'circle') &&
      shapeStartRef.current &&
      shapePreview &&
      shapePreview.length > 0 &&
      dataRef.current &&
      project
    ) {
      const patches: CellPatch[] = [];
      const next = selectedColorIndex;
      for (const [r, c] of shapePreview) {
        if (r < 0 || r >= project.height || c < 0 || c >= project.width) continue;
        const prev = dataRef.current[r][c].colorIndex ?? null;
        if (prev === next) continue;
        dataRef.current[r][c] = { colorIndex: next };
        patches.push({ row: r, col: c, prev, next });
      }
      if (patches.length > 0) {
        strokeRef.current = { patches, lastCell: null };
        commitStroke();
        setData(cloneData(dataRef.current));
        pushRecent(selectedColorIndex);
      }
      shapeStartRef.current = null;
      setShapePreview(null);
      return;
    }

    if (selectionDragRef.current) {
      selectionDragRef.current = null;
      return;
    }
    if (pasteDragRef.current) {
      pasteDragRef.current = null;
      return;
    }

    if (strokeRef.current && strokeRef.current.patches.length > 0) {
      commitStroke();
    } else {
      strokeRef.current = null;
    }
  }, [commitStroke, tool, shapePreview, project, selectedColorIndex, pushRecent]);

  const undo = useCallback(() => {
    if (histPos <= 0 || !dataRef.current) return;
    const patches = history[histPos - 1];
    applyPatches(dataRef.current, patches, false);
    setHistPos((p) => p - 1);
    setData(cloneData(dataRef.current));
    setDirty(true);
  }, [history, histPos]);

  const redo = useCallback(() => {
    if (histPos >= history.length || !dataRef.current) return;
    const patches = history[histPos];
    applyPatches(dataRef.current, patches, true);
    setHistPos((p) => p + 1);
    setData(cloneData(dataRef.current));
    setDirty(true);
  }, [history, histPos]);

  const saveChanges = useCallback(() => {
    if (!project || !dataRef.current || saving) return;
    setSaving(true);
    try {
      const list = (Taro.getStorageSync('pindou:projects') as StoredProject[]) || [];
      const next = list.map((p) =>
        p.id === project.id ? { ...p, data: cloneData(dataRef.current!) } : p,
      );
      Taro.setStorageSync('pindou:projects', next);
      setDirty(false);
      Taro.showToast({ title: '已保存', icon: 'success' });
    } catch {
      Taro.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      setSaving(false);
    }
  }, [project, saving]);

  const applyResize = useCallback(
    (newW: number, newH: number) => {
      if (!project || !dataRef.current) return;
      const oldW = project.width;
      const oldH = project.height;
      const oldData = dataRef.current;
      const w = Math.min(oldW, newW);
      const h = Math.min(oldH, newH);
      const nextData: CanvasData = [];
      for (let r = 0; r < newH; r++) {
        const row = [];
        for (let c = 0; c < newW; c++) {
          if (r < h && c < w) row.push({ colorIndex: oldData[r][c].colorIndex });
          else row.push({ colorIndex: null });
        }
        nextData.push(row);
      }
      const nextProject = { ...project, width: newW, height: newH, data: nextData };
      try {
        const list = (Taro.getStorageSync('pindou:projects') as StoredProject[]) || [];
        const updated = list.map((p) => (p.id === project.id ? nextProject : p));
        Taro.setStorageSync('pindou:projects', updated);
      } catch {}
      setProject(nextProject);
      setData(cloneData(nextData));
      dataRef.current = nextData;
      setHistory([]);
      setHistPos(0);
      setDirty(false);
      const ratio = canvasCssRef.current.width / Math.max(newW, newH);
      cellBaseRef.current = ratio;
      const offsetX = (canvasCssRef.current.width - newW * ratio) / 2;
      const offsetY = (canvasCssRef.current.height - newH * ratio) / 2;
      const v = { scale: 1, offsetX, offsetY };
      setView(v);
      viewRef.current = v;
      Taro.showToast({ title: `已调整为 ${newW}×${newH}`, icon: 'success' });
    },
    [project],
  );

  const promptResize = useCallback(() => {
    if (!project) return;
    const opts = {
      title: '调整画布',
      content: `当前 ${project.width}×${project.height}\n输入新尺寸 (如 60x80)，范围 4-256`,
      editable: true,
      placeholderText: `${project.width}x${project.height}`,
    } as Parameters<typeof Taro.showModal>[0];
    Taro.showModal({
      ...opts,
      success: (res) => {
        if (!res.confirm) return;
        const raw = ((res as { content?: string }).content || '').trim().toLowerCase();
        const m = raw.match(/^(\d+)\s*[x×*]\s*(\d+)$/);
        if (!m) {
          Taro.showToast({ title: '格式如 60x80', icon: 'none' });
          return;
        }
        const newW = parseInt(m[1], 10);
        const newH = parseInt(m[2], 10);
        if (newW < 4 || newH < 4 || newW > 256 || newH > 256) {
          Taro.showToast({ title: '尺寸需 4-256', icon: 'none' });
          return;
        }
        if (newW === project.width && newH === project.height) {
          Taro.showToast({ title: '尺寸未变', icon: 'none' });
          return;
        }
        const d = dataRef.current;
        let lost = 0;
        if (d && (newW < project.width || newH < project.height)) {
          for (let r = 0; r < project.height; r++) {
            for (let c = 0; c < project.width; c++) {
              if ((r >= newH || c >= newW) && d[r][c].colorIndex !== null) lost++;
            }
          }
        }
        if (lost > 0) {
          Taro.showModal({
            title: '确认裁剪',
            content: `将裁剪 ${lost} 个非空像素，确定继续？`,
            success: (r2) => {
              if (r2.confirm) applyResize(newW, newH);
            },
          });
        } else {
          applyResize(newW, newH);
        }
      },
    });
  }, [project, applyResize]);

  const applyTransform = useCallback(
    (kind: 'flipH' | 'flipV' | 'rotate90') => {
      if (!project || !dataRef.current) return;
      const oldW = project.width;
      const oldH = project.height;
      const oldData = dataRef.current;
      let newW = oldW;
      let newH = oldH;
      if (kind === 'rotate90') {
        newW = oldH;
        newH = oldW;
      }
      const nextData: CanvasData = [];
      for (let r = 0; r < newH; r++) {
        const row = [];
        for (let c = 0; c < newW; c++) {
          let sr = r;
          let sc = c;
          if (kind === 'flipH') sc = oldW - 1 - c;
          else if (kind === 'flipV') sr = oldH - 1 - r;
          else if (kind === 'rotate90') {
            sr = oldH - 1 - c;
            sc = r;
          }
          row.push({ colorIndex: oldData[sr][sc].colorIndex });
        }
        nextData.push(row);
      }
      const nextProject = { ...project, width: newW, height: newH, data: nextData };
      try {
        const list = (Taro.getStorageSync('pindou:projects') as StoredProject[]) || [];
        const updated = list.map((p) => (p.id === project.id ? nextProject : p));
        Taro.setStorageSync('pindou:projects', updated);
      } catch {}
      setProject(nextProject);
      setData(cloneData(nextData));
      dataRef.current = nextData;
      setHistory([]);
      setHistPos(0);
      setDirty(false);
      if (kind === 'rotate90') {
        const ratio = canvasCssRef.current.width / Math.max(newW, newH);
        cellBaseRef.current = ratio;
        const offsetX = (canvasCssRef.current.width - newW * ratio) / 2;
        const offsetY = (canvasCssRef.current.height - newH * ratio) / 2;
        const v = { scale: 1, offsetX, offsetY };
        setView(v);
        viewRef.current = v;
      }
      const label = kind === 'flipH' ? '已水平翻转' : kind === 'flipV' ? '已垂直翻转' : '已旋转 90°';
      Taro.showToast({ title: label, icon: 'success' });
    },
    [project],
  );

  const resetView = useCallback(() => {
    if (!project) return;
    const ratio = canvasCssRef.current.width / Math.max(project.width, project.height);
    cellBaseRef.current = ratio;
    const offsetX = (canvasCssRef.current.width - project.width * ratio) / 2;
    const offsetY = (canvasCssRef.current.height - project.height * ratio) / 2;
    const v = { scale: 1, offsetX, offsetY };
    setView(v);
    viewRef.current = v;
    Taro.showToast({ title: '已重置视图', icon: 'success' });
  }, [project]);

  const fillAll = useCallback(
    (next: number | null) => {
      const d = dataRef.current;
      if (!d) return;
      const patches: CellPatch[] = [];
      for (let r = 0; r < d.length; r++) {
        for (let c = 0; c < d[r].length; c++) {
          const prev = d[r][c].colorIndex ?? null;
          if (prev === next) continue;
          patches.push({ row: r, col: c, prev, next });
        }
      }
      if (patches.length === 0) {
        Taro.showToast({ title: '画布已为此状态', icon: 'none' });
        return;
      }
      const nextData = cloneData(d);
      applyPatches(nextData, patches, true);
      dataRef.current = nextData;
      setData(nextData);
      setHistory((prev) => {
        const truncated = prev.slice(0, histPos);
        truncated.push(patches);
        return truncated;
      });
      setHistPos((p) => p + 1);
      setDirty(true);
      Taro.showToast({ title: next == null ? '已清空' : '已填充', icon: 'success' });
    },
    [histPos],
  );

  const showStats = useCallback(() => {
    if (!project) return;
    const d = dataRef.current;
    if (!d) return;
    const counts = new Map<number, number>();
    let total = 0;
    let filled = 0;
    for (let r = 0; r < project.height; r++) {
      for (let c = 0; c < project.width; c++) {
        total++;
        const idx = d[r]?.[c]?.colorIndex;
        if (idx == null) continue;
        filled++;
        counts.set(idx, (counts.get(idx) || 0) + 1);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const lines = top.map(([idx, n]) => {
      const color = MARD_COLORS[idx];
      const pct = filled > 0 ? ((n / filled) * 100).toFixed(1) : '0';
      return `${color.code} ${color.name}  ×${n}  (${pct}%)`;
    });
    const header = `${project.width}×${project.height} · 共 ${counts.size} 色 · ${filled}/${total} 颗`;
    const body = lines.length > 0 ? lines.join('\n') : '画布为空';
    const more = counts.size > top.length ? `\n…还有 ${counts.size - top.length} 色` : '';
    Taro.showModal({
      title: '统计信息',
      content: `${header}\n\n${body}${more}`,
      showCancel: false,
      confirmText: '好的',
    });
  }, [project]);

  const saveAsCopy = useCallback(() => {
    if (!project || !dataRef.current) return;
    Taro.showModal({
      title: '另存为副本',
      content: '将当前编辑状态保存为新作品（原作品不变）。',
      success: (r) => {
        if (!r.confirm) return;
        try {
          const list = (Taro.getStorageSync('pindou:projects') as StoredProject[]) || [];
          const newId = `p_${Date.now()}`;
          const copy: StoredProject = {
            ...project,
            id: newId,
            name: `${project.name} 副本`,
            data: dataRef.current!.map((row) => row.map((cell) => ({ colorIndex: cell.colorIndex }))),
            createdAt: Date.now(),
          };
          Taro.setStorageSync('pindou:projects', [copy, ...list]);
          Taro.showToast({ title: '已另存', icon: 'success' });
          setTimeout(() => {
            Taro.redirectTo({ url: `/pages/result/index?id=${newId}` });
          }, 600);
        } catch {
          Taro.showToast({ title: '保存失败', icon: 'none' });
        }
      },
    });
  }, [project]);

  const openSelectionMenu = useCallback(() => {
    if (!dataRef.current || !project) return;
    const haveBounds = !!selectionBounds;
    const haveIrregular = !!selectionCellsIrregular && selectionCellsIrregular.size > 0;
    if (!haveBounds && !haveIrregular) return;
    const sc = MARD_COLORS[selectedColorIndex]?.code || '当前色';
    const items = ['复制', '剪切', '删除', `填充为 ${sc}`, '取消选区'];
    Taro.showActionSheet({
      itemList: items,
      success: (res) => {
        const label = items[res.tapIndex];
        if (label === '取消选区') {
          setSelectionBounds(null);
          setSelectionCellsIrregular(null);
          return;
        }
        const d = dataRef.current;
        if (!d || !project) return;
        const boundsForClone: SelectionBounds = haveBounds ? selectionBounds! : boundsFromCells(selectionCellsIrregular!);
        const payload = cloneSelectionRegion(d, boundsForClone);
        if (label === '复制') {
          clipboardRef.current = payload;
          Taro.showToast({ title: `已复制 ${payload.w}×${payload.h}`, icon: 'success' });
          return;
        }
        const sCells: Set<string> = haveIrregular
          ? selectionCellsIrregular!
          : rectSelectionCells(selectionBounds!);
        const patches: CellPatch[] = [];
        const fillIdx = label === `填充为 ${sc}` ? selectedColorIndex : null;
        for (const key of sCells) {
          const [rStr, cStr] = key.split(',');
          const r = Number(rStr);
          const c = Number(cStr);
          if (r < 0 || r >= project.height || c < 0 || c >= project.width) continue;
          const prev = d[r][c].colorIndex ?? null;
          if (prev === fillIdx) continue;
          d[r][c] = { colorIndex: fillIdx };
          patches.push({ row: r, col: c, prev, next: fillIdx });
        }
        if (patches.length > 0) {
          strokeRef.current = { patches, lastCell: null };
          commitStroke();
          setData(cloneData(dataRef.current!));
        }
        if (label === '剪切') {
          clipboardRef.current = payload;
          Taro.showToast({ title: `已剪切 ${payload.w}×${payload.h}`, icon: 'success' });
          setSelectionBounds(null);
          setSelectionCellsIrregular(null);
        } else if (label === '删除') {
          Taro.showToast({ title: '已删除', icon: 'success' });
          setSelectionBounds(null);
          setSelectionCellsIrregular(null);
        } else {
          Taro.showToast({ title: `已填充 ${patches.length} 颗`, icon: 'success' });
        }
      },
    });
  }, [selectionBounds, selectionCellsIrregular, project, selectedColorIndex, commitStroke]);

  const openProjectMenu = useCallback(() => {
    const gridLabel = showGrid ? '隐藏网格' : '显示网格';
    const sc = MARD_COLORS[selectedColorIndex]?.code || '当前色';
    const blueprintLabel = blueprintMode ? '退出图纸模式' : '进入图纸模式';
    const items: string[] = [];
    if (clipboardRef.current) items.push('粘贴');
    items.push(
      '调整画布尺寸',
      '水平翻转',
      '垂直翻转',
      '顺时针旋转 90°',
      '重置视图',
      gridLabel,
      blueprintLabel,
      '统计信息',
      '另存为副本',
      `全画布填充为 ${sc}`,
      '清空全画布',
    );
    if (blueprintMode) {
      const mirrorLabel = blueprintMirror ? '退出镜像' : '镜像（背面视角）';
      const baseIdx = clipboardRef.current ? 8 : 7;
      items.splice(baseIdx, 0, mirrorLabel);
    }
    Taro.showActionSheet({
      itemList: items,
      success: (res) => {
        const label = items[res.tapIndex];
        if (label === '粘贴') {
          if (clipboardRef.current && project) {
            const payload = clipboardRef.current;
            const offsetRow = Math.max(0, Math.floor((project.height - payload.h) / 2));
            const offsetCol = Math.max(0, Math.floor((project.width - payload.w) / 2));
            setFloatingPaste({ payload, offsetRow, offsetCol });
            setBlueprintMirror(false);
            setTool('select');
          }
        } else if (label === '调整画布尺寸') promptResize();
        else if (label === '水平翻转') applyTransform('flipH');
        else if (label === '垂直翻转') applyTransform('flipV');
        else if (label === '顺时针旋转 90°') applyTransform('rotate90');
        else if (label === '重置视图') resetView();
        else if (label === '隐藏网格' || label === '显示网格') setShowGrid((g) => !g);
        else if (label === '进入图纸模式' || label === '退出图纸模式') setBlueprintMode((v) => !v);
        else if (label === '镜像（背面视角）' || label === '退出镜像') setBlueprintMirror((v) => !v);
        else if (label === '统计信息') showStats();
        else if (label === '另存为副本') saveAsCopy();
        else if (label.startsWith('全画布填充为')) {
          Taro.showModal({
            title: '填充全画布',
            content: `将所有格子填充为 ${sc}？此操作可撤销。`,
            success: (r) => {
              if (r.confirm) fillAll(selectedColorIndex);
            },
          });
        } else if (label === '清空全画布') {
          Taro.showModal({
            title: '清空全画布',
            content: '将所有格子清空？此操作可撤销。',
            confirmColor: '#ff5e62',
            success: (r) => {
              if (r.confirm) fillAll(null);
            },
          });
        }
      },
    });
  }, [
    promptResize,
    applyTransform,
    resetView,
    showGrid,
    showStats,
    selectedColorIndex,
    fillAll,
    saveAsCopy,
    blueprintMode,
    blueprintMirror,
  ]);

  const exportPNG = useCallback(
    (opts: { withCodes: boolean; withGrid: boolean; withLegend: boolean }) => {
      if (!project || exporting) return;
      const d = dataRef.current;
      if (!d) return;
      setExporting(true);
      const w = project.width;
      const h = project.height;
      const cell = 24;
      const padding = 16;
      const footer = 56;
      const imgW = w * cell + padding * 2;

      const counts = new Map<number, number>();
      let totalBeads = 0;
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          const idx = d[r]?.[c]?.colorIndex;
          if (idx == null) continue;
          counts.set(idx, (counts.get(idx) || 0) + 1);
          totalBeads++;
        }
      }
      const legendEntries = opts.withLegend ? [...counts.entries()].sort((a, b) => b[1] - a[1]) : [];
      const itemW = 110;
      const rowH = 22;
      const legendHeaderH = 26;
      const legendCols = Math.max(1, Math.floor((imgW - padding * 2) / itemW));
      const legendRows = Math.ceil(legendEntries.length / legendCols);
      const legendH = legendEntries.length > 0 ? legendHeaderH + legendRows * rowH + 12 : 0;
      const imgH = h * cell + padding * 2 + legendH + footer;

      const query = Taro.createSelectorQuery();
      query
        .select(`#${EXPORT_CANVAS_ID}`)
        .node()
        .exec((nodeRes) => {
          const node = nodeRes?.[0]?.node as CanvasNode | undefined;
          if (!node) {
            Taro.showToast({ title: '导出失败', icon: 'none' });
            setExporting(false);
            return;
          }
          const ratio = 2;
          node.width = imgW * ratio;
          node.height = imgH * ratio;
          const ctx = node.getContext('2d');
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, imgW, imgH);

          for (let r = 0; r < h; r++) {
            for (let c = 0; c < w; c++) {
              const idx = d[r]?.[c]?.colorIndex ?? null;
              const x = padding + c * cell;
              const y = padding + r * cell;
              if (idx == null) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(x, y, cell, cell);
              } else {
                const color = MARD_COLORS[idx];
                const ovEntry = overridesRef.current.get(idx);
                const hex = ovEntry ? ovEntry.hex : color.hex;
                const rgb = ovEntry ? ovEntry.rgb : (color.rgb ?? [128, 128, 128]);
                ctx.fillStyle = hex;
                ctx.fillRect(x, y, cell, cell);
                if (opts.withCodes) {
                  const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
                  ctx.fillStyle = lum > 160 ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.9)';
                  ctx.font = '10px sans-serif';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(color.code, x + cell / 2, y + cell / 2);
                }
              }
            }
          }

          if (opts.withGrid) {
            ctx.strokeStyle = 'rgba(0,0,0,0.18)';
            ctx.lineWidth = 0.5;
            for (let c = 0; c <= w; c++) {
              const x = padding + c * cell;
              ctx.beginPath();
              ctx.moveTo(x, padding);
              ctx.lineTo(x, padding + h * cell);
              ctx.stroke();
            }
            for (let r = 0; r <= h; r++) {
              const y = padding + r * cell;
              ctx.beginPath();
              ctx.moveTo(padding, y);
              ctx.lineTo(padding + w * cell, y);
              ctx.stroke();
            }
            ctx.strokeStyle = 'rgba(0,0,0,0.55)';
            ctx.lineWidth = 1.2;
            for (let c = 0; c <= w; c += GRID_GROUP) {
              const x = padding + c * cell;
              ctx.beginPath();
              ctx.moveTo(x, padding);
              ctx.lineTo(x, padding + h * cell);
              ctx.stroke();
            }
            for (let r = 0; r <= h; r += GRID_GROUP) {
              const y = padding + r * cell;
              ctx.beginPath();
              ctx.moveTo(padding, y);
              ctx.lineTo(padding + w * cell, y);
              ctx.stroke();
            }
          }

          if (legendEntries.length > 0) {
            const legendTop = padding + h * cell;
            ctx.fillStyle = '#333';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(
              `用色清单 · 共 ${legendEntries.length} 色 · ${totalBeads} 颗`,
              padding,
              legendTop + legendHeaderH / 2,
            );
            ctx.font = '12px sans-serif';
            for (let i = 0; i < legendEntries.length; i++) {
              const [idx, cnt] = legendEntries[i];
              const color = MARD_COLORS[idx];
              const ovEntry = overridesRef.current.get(idx);
              const hex = ovEntry ? ovEntry.hex : color.hex;
              const col = i % legendCols;
              const row = Math.floor(i / legendCols);
              const x = padding + col * itemW;
              const y = legendTop + legendHeaderH + row * rowH;
              ctx.fillStyle = hex;
              ctx.fillRect(x, y + 3, 14, 14);
              ctx.strokeStyle = 'rgba(0,0,0,0.25)';
              ctx.lineWidth = 0.5;
              ctx.strokeRect(x + 0.5, y + 3.5, 13, 13);
              ctx.fillStyle = '#444';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText(`${color.code} ×${cnt}`, x + 20, y + 10);
            }
          }

          ctx.fillStyle = '#333';
          ctx.font = 'bold 18px sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(project.name, padding, padding + h * cell + legendH + footer / 2);
          ctx.fillStyle = '#888';
          ctx.font = '13px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(`${w} × ${h}  ·  拼豆 pindou`, imgW - padding, padding + h * cell + legendH + footer / 2);

          Taro.canvasToTempFilePath({
            canvas: node as unknown as Parameters<typeof Taro.canvasToTempFilePath>[0]['canvas'],
            fileType: 'png',
            success: (res) => {
              Taro.saveImageToPhotosAlbum({
                filePath: res.tempFilePath,
                success: () => Taro.showToast({ title: '已保存到相册', icon: 'success' }),
                fail: (err) => {
                  if (err.errMsg.includes('auth deny') || err.errMsg.includes('cancel')) {
                    Taro.showToast({ title: '需要相册权限', icon: 'none' });
                  } else {
                    Taro.showToast({ title: '保存到相册失败', icon: 'none' });
                  }
                },
                complete: () => setExporting(false),
              });
            },
            fail: () => {
              Taro.showToast({ title: '导出失败', icon: 'none' });
              setExporting(false);
            },
          });
        });
    },
    [project, exporting],
  );

  const openExportMenu = useCallback(() => {
    if (exporting) return;
    Taro.showActionSheet({
      itemList: ['完整图纸（色号+网格+清单）', '成品参考（仅网格）', '纯色拼图（无网格无色号）'],
      success: (res) => {
        if (res.tapIndex === 0) exportPNG({ withCodes: true, withGrid: true, withLegend: true });
        else if (res.tapIndex === 1) exportPNG({ withCodes: false, withGrid: true, withLegend: false });
        else if (res.tapIndex === 2) exportPNG({ withCodes: false, withGrid: false, withLegend: false });
      },
    });
  }, [exportPNG, exporting]);

  const openShapeMenu = useCallback(() => {
    Taro.showActionSheet({
      itemList: [
        `直线${activeShape === 'line' ? ' ✓' : ''}`,
        `矩形${activeShape === 'rect' ? ' ✓' : ''} ${shapeFilled ? '(实心)' : '(描边)'}`,
        `圆形${activeShape === 'circle' ? ' ✓' : ''} ${shapeFilled ? '(实心)' : '(描边)'}`,
        shapeFilled ? '切换为描边模式' : '切换为实心模式',
      ],
      success: (res) => {
        if (res.tapIndex === 0) {
          setActiveShape('line');
          setTool('line');
        } else if (res.tapIndex === 1) {
          setActiveShape('rect');
          setTool('rect');
        } else if (res.tapIndex === 2) {
          setActiveShape('circle');
          setTool('circle');
        } else if (res.tapIndex === 3) {
          setShapeFilled((v) => !v);
        }
      },
    });
  }, [activeShape, shapeFilled]);

  const openSelectionToolMenu = useCallback(() => {
    const isSelect = tool === 'select';
    const isWand = tool === 'wand';
    const isEraserFill = tool === 'eraserFill';
    const items = [
      `矩形选区${isSelect ? ' ✓' : ''}`,
      `魔棒${isWand ? ' ✓' : ''}`,
      `区域擦除${isEraserFill ? ' ✓' : ''}`,
    ];
    Taro.showActionSheet({
      itemList: items,
      success: (res) => {
        const label = items[res.tapIndex];
        const switchTo = (next: Tool) => {
          setFloatingPaste(null);
          setBlueprintMirror(false);
          setSelectionCellsIrregular(null);
          setSelectionBounds(null);
          setTool(next);
        };
        if (label.startsWith('矩形选区')) switchTo('select');
        else if (label.startsWith('魔棒')) switchTo('wand');
        else if (label.startsWith('区域擦除')) switchTo('eraserFill');
      },
    });
  }, [tool]);

  const shareImageRef = useRef<string>('');
  const generateShareImage = useCallback(() => {
    const query = Taro.createSelectorQuery();
    query
      .select(`#${CANVAS_ID}`)
      .node()
      .exec((nodeRes) => {
        const node = nodeRes?.[0]?.node as CanvasNode | undefined;
        if (!node) return;
        Taro.canvasToTempFilePath({
          canvas: node as unknown as Parameters<typeof Taro.canvasToTempFilePath>[0]['canvas'],
          fileType: 'jpg',
          quality: 0.85,
          success: (res) => {
            shareImageRef.current = res.tempFilePath;
          },
        });
      });
  }, []);

  useEffect(() => {
    if (!project || !data) return;
    const t = setTimeout(generateShareImage, 600);
    return () => clearTimeout(t);
  }, [project, data, view, generateShareImage]);

  useEffect(() => {
    if (dirty) {
      try {
        Taro.enableAlertBeforeUnload({ message: '当前作品有未保存的修改，确定离开？' });
      } catch {}
    } else {
      try {
        Taro.disableAlertBeforeUnload();
      } catch {}
    }
    return () => {
      try {
        Taro.disableAlertBeforeUnload();
      } catch {}
    };
  }, [dirty]);

  useShareAppMessage(() => {
    const title = project ? `我用拼豆设计了「${project.name}」` : '拼豆图纸';
    const path = project
      ? `/pages/result/index?id=${project.id}`
      : '/pages/home/index';
    return {
      title,
      path,
      imageUrl: shareImageRef.current || undefined,
    };
  });

  useShareTimeline(() => {
    const title = project ? `我用拼豆设计了「${project.name}」` : '拼豆图纸';
    return {
      title,
      query: project ? `id=${project.id}` : '',
      imageUrl: shareImageRef.current || undefined,
    };
  });

  const persistOverrides = useCallback((next: ColorOverrideMap) => {
    setOverrides(next);
    overridesRef.current = next;
    try {
      Taro.setStorageSync('pindou:overrides', JSON.stringify([...next.entries()]));
    } catch {}
  }, []);

  const promptCustomColor = useCallback(
    (idx: number) => {
      const c = MARD_COLORS[idx];
      const cur = getEffectiveHex(idx, overridesRef.current);
      const opts = {
        title: `自定义 ${c.code}`,
        content: `当前：${cur}\n输入 6 位 HEX，如 ff7043`,
        editable: true,
        placeholderText: cur.replace('#', ''),
      } as Parameters<typeof Taro.showModal>[0];
      Taro.showModal({
        ...opts,
        success: (res) => {
          if (!res.confirm) return;
          const raw = ((res as { content?: string }).content || '').trim().replace(/^#/, '');
          if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
            Taro.showToast({ title: '请输入 6 位 HEX', icon: 'none' });
            return;
          }
          const hex = `#${raw.toLowerCase()}`;
          const rgb = hexToRgb(hex);
          const next = new Map(overridesRef.current);
          next.set(idx, { hex, rgb });
          persistOverrides(next);
          Taro.showToast({ title: '已自定义', icon: 'success' });
        },
      });
    },
    [persistOverrides],
  );

  const replaceAllColor = useCallback(
    (from: number, to: number) => {
      const d = dataRef.current;
      if (!d || from === to) return;
      const patches: CellPatch[] = [];
      for (let r = 0; r < d.length; r++) {
        for (let c = 0; c < d[r].length; c++) {
          if (d[r][c].colorIndex === from) {
            patches.push({ row: r, col: c, prev: from, next: to });
          }
        }
      }
      if (patches.length === 0) {
        Taro.showToast({ title: '画布中没有此色', icon: 'none' });
        return;
      }
      const nextData = cloneData(d);
      applyPatches(nextData, patches, true);
      dataRef.current = nextData;
      setData(nextData);
      setHistory((prev) => {
        const truncated = prev.slice(0, histPos);
        truncated.push(patches);
        return truncated;
      });
      setHistPos((p) => p + 1);
      setDirty(true);
      Taro.showToast({ title: `已替换 ${patches.length} 颗`, icon: 'success' });
    },
    [histPos],
  );

  const colorLongPress = useCallback(
    (idx: number) => {
      const c = MARD_COLORS[idx];
      const hasOverride = overridesRef.current.has(idx);
      const items: string[] = [];
      const actions: Array<() => void> = [];
      items.push('设为当前色');
      actions.push(() => {
        setSelectedColorIndex(idx);
        pushRecent(idx);
        setTool('pen');
      });
      items.push('统计本色用量');
      actions.push(() => {
        const d = dataRef.current;
        if (!d) return;
        let n = 0;
        for (const row of d) {
          for (const cell of row) {
            if (cell.colorIndex === idx) n++;
          }
        }
        Taro.showModal({
          title: c.code,
          content: `${c.name}\n当前画布用量：${n} 颗`,
          showCancel: false,
        });
      });
      if (selectedColorIndex !== idx) {
        const tc = MARD_COLORS[selectedColorIndex];
        items.push(`全部替换为 ${tc.code}`);
        actions.push(() => replaceAllColor(idx, selectedColorIndex));
      }
      items.push('自定义颜色');
      actions.push(() => promptCustomColor(idx));
      if (hasOverride) {
        items.push('还原默认色');
        actions.push(() => {
          const next = new Map(overridesRef.current);
          next.delete(idx);
          persistOverrides(next);
          Taro.showToast({ title: '已还原', icon: 'success' });
        });
      }
      Taro.showActionSheet({
        itemList: items,
        success: (res) => {
          const fn = actions[res.tapIndex];
          if (fn) fn();
        },
      });
    },
    [persistOverrides, promptCustomColor, selectedColorIndex, replaceAllColor],
  );

  const stats = useMemo<BeadStat[]>(() => {
    if (!data) return [];
    const counts = new Map<number, number>();
    for (const row of data) {
      for (const cell of row) {
        if (cell.colorIndex !== null && cell.colorIndex !== undefined) {
          counts.set(cell.colorIndex, (counts.get(cell.colorIndex) || 0) + 1);
        }
      }
    }
    const out: BeadStat[] = [];
    for (const [idx, count] of counts) {
      const c = MARD_COLORS[idx];
      out.push({ index: idx, code: c.code, name: c.name, hex: getEffectiveHex(idx, overrides), count });
    }
    out.sort((a, b) => b.count - a.count);
    return out;
  }, [data, overrides]);

  const totalBeads = useMemo(() => stats.reduce((s, b) => s + b.count, 0), [stats]);

  const palettePreview = useMemo(() => {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const s of stats) {
      if (!seen.has(s.index)) {
        seen.add(s.index);
        out.push(s.index);
      }
    }
    if (out.length < 24) {
      for (let i = 0; i < MARD_COLORS.length && out.length < 48; i++) {
        if (!seen.has(i)) {
          seen.add(i);
          out.push(i);
        }
      }
    }
    return out;
  }, [stats]);

  const groupIndices = useMemo(() => getGroupIndices(paletteGroup), [paletteGroup]);
  const usedSet = useMemo(() => new Set(stats.map((s) => s.index)), [stats]);
  const filteredGroupIndices = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    let base = groupIndices;
    if (onlyUsed) base = base.filter((idx) => usedSet.has(idx));
    if (!q) return base;
    return base.filter((idx) => {
      const c = MARD_COLORS[idx];
      if (!c) return false;
      return c.code.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q);
    });
  }, [groupIndices, paletteQuery, onlyUsed, usedSet]);

  if (loadError) {
    return (
      <View className="editor editor--error">
        <Text className="editor__error">{loadError}</Text>
      </View>
    );
  }
  if (!project || !data) {
    return (
      <View className="editor editor--loading">
        <Text className="editor__loading">加载中…</Text>
      </View>
    );
  }

  const selectedHex = getEffectiveHex(selectedColorIndex, overrides);
  const selectedCode = MARD_COLORS[selectedColorIndex]?.code || '';
  let filledCount = 0;
  for (let r = 0; r < project.height; r += 1) {
    for (let c = 0; c < project.width; c += 1) {
      if (data[r][c].colorIndex !== null) filledCount += 1;
    }
  }
  const totalCount = project.width * project.height;
  const fillPct = totalCount === 0 ? 0 : Math.round((filledCount / totalCount) * 100);

  return (
    <View className="editor">
      <View className="editor__header">
        <View className="editor__title">
          <Text className="editor__name">{project.name}{dirty ? ' ·' : ''}</Text>
          <Text className="editor__meta">
            {project.width} × {project.height} · {filledCount}/{totalCount} ({fillPct}%)
          </Text>
        </View>
        <View className="editor__header-actions">
          <View
            className={`editor__icon-btn${histPos <= 0 ? ' editor__icon-btn--disabled' : ''}`}
            onClick={undo}
          >
            <Text>↶</Text>
          </View>
          <View
            className={`editor__icon-btn${histPos >= history.length ? ' editor__icon-btn--disabled' : ''}`}
            onClick={redo}
          >
            <Text>↷</Text>
          </View>
          <View
            className={`editor__icon-btn editor__icon-btn--primary${!dirty || saving ? ' editor__icon-btn--disabled' : ''}`}
            onClick={saveChanges}
          >
            <Text>保存</Text>
          </View>
          <View className="editor__icon-btn" onClick={openProjectMenu}>
            <Text>⋯</Text>
          </View>
          <Button className="editor__icon-btn editor__share-btn" openType="share">
            <Text>分享</Text>
          </Button>
        </View>
      </View>

      <View className="editor__canvas-wrap">
        {floatingPaste && (
          <View className="editor__paste-bar">
            <Text className="editor__paste-bar-info">
              粘贴 {floatingPaste.payload.w}×{floatingPaste.payload.h}
            </Text>
            <View className="editor__paste-bar-actions">
              <View
                className="editor__paste-bar-btn editor__paste-bar-btn--cancel"
                onClick={() => setFloatingPaste(null)}
              >
                <Text>取消</Text>
              </View>
              <View
                className="editor__paste-bar-btn editor__paste-bar-btn--confirm"
                onClick={() => {
                  if (!floatingPaste || !dataRef.current) return;
                  const patches = applyClipboardToData(
                    dataRef.current,
                    floatingPaste.payload,
                    floatingPaste.offsetRow,
                    floatingPaste.offsetCol,
                  );
                  if (patches.length > 0) {
                    strokeRef.current = { patches, lastCell: null };
                    commitStroke();
                    setData(cloneData(dataRef.current));
                  }
                  setFloatingPaste(null);
                }}
              >
                <Text>确认</Text>
              </View>
            </View>
          </View>
        )}
        <Canvas
          id={CANVAS_ID}
          canvasId={CANVAS_ID}
          type="2d"
          className="editor__canvas"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onLongPress={() => {
            if (
              (tool === 'select' || tool === 'wand') &&
              (selectionBounds || (selectionCellsIrregular && selectionCellsIrregular.size > 0)) &&
              !floatingPaste
            ) {
              openSelectionMenu();
            }
          }}
        />
        <Canvas
          id={EXPORT_CANVAS_ID}
          canvasId={EXPORT_CANVAS_ID}
          type="2d"
          className="editor__export-canvas"
        />
      </View>

      <View className="editor__stats">
        <View className="editor__stats-row">
          <Text className="editor__stats-label">共 {totalBeads} 颗</Text>
          <Text className="editor__stats-label">{stats.length} 种颜色</Text>
        </View>
        <ScrollView scrollX className="editor__stats-strip">
          {stats.slice(0, STATS_LIMIT).map((b) => (
            <View key={b.index} className="editor__stats-chip">
              <View className="editor__stats-swatch" style={{ background: b.hex }} />
              <Text className="editor__stats-code">{b.code}</Text>
              <Text className="editor__stats-count">{b.count}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <View className="editor__palette">
        <View className="editor__palette-head">
          <View className="editor__palette-current">
            <View className="editor__palette-swatch" style={{ background: selectedHex }} />
            <Text className="editor__palette-code">{selectedCode}</Text>
          </View>
          <View
            className="editor__palette-toggle"
            onClick={() => setPaletteOpen((v) => !v)}
          >
            <Text>{paletteOpen ? '收起' : '更多色'}</Text>
          </View>
        </View>
        {recentColors.length > 0 && (
          <ScrollView scrollX className="editor__palette-recent">
            <Text className="editor__palette-recent-label">最近</Text>
            {recentColors.map((idx) => {
              const c = MARD_COLORS[idx];
              if (!c) return null;
              const hex = getEffectiveHex(idx, overrides);
              const active = idx === selectedColorIndex;
              return (
                <View
                  key={`recent-${idx}`}
                  className={`editor__palette-cell editor__palette-cell--recent${active ? ' editor__palette-cell--active' : ''}`}
                  style={{ background: hex }}
                  onClick={() => {
                    setSelectedColorIndex(idx);
                    pushRecent(idx);
                    if (tool === 'eraser' || tool === 'pan') setTool('pen');
                  }}
                  onLongPress={() => colorLongPress(idx)}
                >
                  <Text className="editor__palette-cell-code">{c.code}</Text>
                </View>
              );
            })}
          </ScrollView>
        )}
        <ScrollView scrollX className="editor__palette-strip">
          {palettePreview.map((idx) => {
            const c = MARD_COLORS[idx];
            const hex = getEffectiveHex(idx, overrides);
            const active = idx === selectedColorIndex;
            return (
              <View
                key={idx}
                className={`editor__palette-cell${active ? ' editor__palette-cell--active' : ''}`}
                style={{ background: hex }}
                onClick={() => {
                  setSelectedColorIndex(idx);
                  pushRecent(idx);
                  if (tool === 'eraser' || tool === 'pan') setTool('pen');
                }}
                onLongPress={() => colorLongPress(idx)}
              >
                <Text className="editor__palette-cell-code">{c.code}</Text>
              </View>
            );
          })}
        </ScrollView>
        {paletteOpen && (
          <View className="editor__palette-groups-wrap">
            <ScrollView scrollX className="editor__palette-groups">
              {COLOR_GROUPS.map((g) => (
                <View
                  key={g.id}
                  className={`editor__palette-group${paletteGroup === g.id ? ' editor__palette-group--active' : ''}`}
                  onClick={() => setPaletteGroup(g.id)}
                >
                  <Text className="editor__palette-group-text">{g.name}</Text>
                </View>
              ))}
            </ScrollView>
            <View className="editor__palette-search">
              <Input
                className="editor__palette-search-input"
                value={paletteQuery}
                placeholder="搜索色号或名称（如 M021）"
                confirmType="search"
                onInput={(e) => setPaletteQuery(e.detail.value)}
              />
              {paletteQuery && (
                <Text
                  className="editor__palette-search-clear"
                  onClick={() => setPaletteQuery('')}
                >
                  ✕
                </Text>
              )}
              <View
                className={`editor__palette-used${onlyUsed ? ' editor__palette-used--active' : ''}`}
                onClick={() => setOnlyUsed((v) => !v)}
              >
                <Text className="editor__palette-used-text">
                  {onlyUsed ? `已用 ${usedSet.size}` : '只看已用'}
                </Text>
              </View>
            </View>
            <ScrollView scrollY className="editor__palette-grid">
              <View className="editor__palette-grid-inner">
                {filteredGroupIndices.length === 0 && (
                  <Text className="editor__palette-empty">无匹配的颜色</Text>
                )}
                {filteredGroupIndices.map((idx) => {
                  const c = MARD_COLORS[idx];
                  const hex = getEffectiveHex(idx, overrides);
                  const active = idx === selectedColorIndex;
                  return (
                    <View
                      key={idx}
                      className={`editor__palette-cell editor__palette-cell--grid${active ? ' editor__palette-cell--active' : ''}`}
                      style={{ background: hex }}
                      onClick={() => {
                        setSelectedColorIndex(idx);
                        pushRecent(idx);
                        if (tool === 'eraser' || tool === 'pan') setTool('pen');
                      }}
                      onLongPress={() => colorLongPress(idx)}
                    >
                      <Text className="editor__palette-cell-code">{c.code}</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}
      </View>

      <View className="editor__toolbar">
        {TOOL_LIST.map((t) => (
          <View
            key={t.id}
            className={`editor__tool${tool === t.id ? ' editor__tool--active' : ''}`}
            onClick={() => setTool(t.id)}
          >
            <Text className="editor__tool-icon">{t.icon}</Text>
            <Text className="editor__tool-label">{t.label}</Text>
          </View>
        ))}
        <View
          className={`editor__tool${
            tool === 'line' || tool === 'rect' || tool === 'circle' ? ' editor__tool--active' : ''
          }`}
          onClick={openShapeMenu}
        >
          <Text className="editor__tool-icon">
            {activeShape === 'line' ? '⟋' : activeShape === 'rect' ? '⬜' : '⭕'}
          </Text>
          <Text className="editor__tool-label">形状▾</Text>
        </View>
        <View
          className={`editor__tool${
            tool === 'select' || tool === 'wand' || tool === 'eraserFill' ? ' editor__tool--active' : ''
          }`}
          onClick={openSelectionToolMenu}
        >
          <Text className="editor__tool-icon">
            {tool === 'wand' ? '✦' : tool === 'eraserFill' ? '🧽' : '⬚'}
          </Text>
          <Text className="editor__tool-label">选区▾</Text>
        </View>
        <View
          className={`editor__tool editor__tool--export${exporting ? ' editor__tool--disabled' : ''}`}
          onClick={openExportMenu}
        >
          <Text className="editor__tool-icon">📷</Text>
          <Text className="editor__tool-label">{exporting ? '…' : '导出'}</Text>
        </View>
      </View>
    </View>
  );
}
