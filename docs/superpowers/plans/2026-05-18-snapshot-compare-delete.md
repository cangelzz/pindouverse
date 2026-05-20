# Snapshot Compare & Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add **对比** (compare current canvas against the snapshot) and **删除** (remove snapshot from storage) buttons to each row of the snapshot dialog.

**Architecture:** Generalize the existing `ChangesCompareDialog` with optional `baselineData / baselineSize / labels / title` props so it can serve both its current "changes since save" use and a new "diff against snapshot" use, and align both views to the union of canvas sizes when they differ. Add a new `deleteSnapshot` adapter method (file delete on Tauri, IDB delete on browser, not-supported throw elsewhere) and wire it through the store. The snapshot dialog renders three buttons per row.

**Tech Stack:** React, TypeScript, Vitest, Zustand store, Tauri (Rust file ops), IndexedDB (browser).

---

## File Structure

**Modified:**
- `src/adapters/index.ts` — add `deleteSnapshot` to `PlatformAdapter`
- `src/adapters/browser.ts` — implement `deleteSnapshot` + `idbDelete` helper
- `src/adapters/tauri.ts` — wire `deleteSnapshot` invoke
- `src/adapters/mobile.ts` — throw "not supported"
- `platforms/vscode/src/vscodeAdapter.ts` — throw "not supported"
- `src/store/editorStore.ts` — add `deleteSnapshot` action
- `src/components/Canvas/ChangesCompareDialog.tsx` — generalize with optional props + canvas-size mismatch handling
- `src/App.tsx` — three-button row + compare wiring + widen dialog
- `src-tauri/src/commands/project.rs` — `delete_snapshot` command
- `src-tauri/src/lib.rs` — register `delete_snapshot`

**Test files (modified or new):**
- `src/components/Canvas/ChangesCompareDialog.test.tsx` — new tests for prop-based override and size mismatch stat computation
- `src/store/editorStore.test.ts` — if it exists, add `deleteSnapshot` test; otherwise no new file (use ad-hoc test inside the existing snapshot context if any)

---

## Task 1: Adapter interface — declare deleteSnapshot

**Files:**
- Modify: `src/adapters/index.ts`

- [ ] **Step 1: Add the method to the PlatformAdapter interface**

Open `src/adapters/index.ts`. Find the `PlatformAdapter` interface — specifically the snapshot section (around line 134–138). Add `deleteSnapshot` right after the existing snapshot methods:

```ts
  // Snapshots
  saveSnapshot(project: ProjectFile, label: string): Promise<void>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  loadSnapshot(path: string): Promise<ProjectFile>;
  deleteSnapshot(path: string): Promise<void>;
```

- [ ] **Step 2: Type-check fails — adapters don't implement it yet**

Run: `npx tsc --noEmit`
Expected: errors about `BrowserAdapter`, `TauriAdapter`, `MobileAdapter` (and `VScodeAdapter` if it implements `PlatformAdapter`) not implementing `deleteSnapshot`. This is expected — Tasks 2–5 fix them.

(No commit yet — interface and implementations should land together so the build never breaks mid-task. We commit at the end of Task 5.)

---

## Task 2: Tauri Rust command

**Files:**
- Modify: `src-tauri/src/commands/project.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command**

In `src-tauri/src/commands/project.rs`, after the existing `load_snapshot` function (around line 206), add:

```rust
#[tauri::command]
pub fn delete_snapshot(path: String) -> Result<(), String> {
    use std::fs;
    fs::remove_file(&path).map_err(|e| format!("Delete failed: {}", e))
}
```

(Note: `use std::fs;` is already imported at the top of the file — this `use` inside the function is redundant. If it is already in scope, remove the inner `use`. Either way works syntactically.)

Actually — since `std::fs` is imported at the top of the file (per the existing `save_snapshot` and `list_snapshots` implementations which use it), drop the inner `use` and write:

```rust
#[tauri::command]
pub fn delete_snapshot(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("Delete failed: {}", e))
}
```

- [ ] **Step 2: Register the command**

In `src-tauri/src/lib.rs`, find the `tauri::generate_handler![...]` invocation that lists `save_snapshot, list_snapshots, load_snapshot`. Add `delete_snapshot` to the list:

```rust
            commands::project::save_snapshot,
            commands::project::list_snapshots,
            commands::project::load_snapshot,
            commands::project::delete_snapshot,
```

- [ ] **Step 3: Verify Rust compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: compiles with no errors. (A warning about an unused command before it's wired to TS is fine.)

(Still no commit — see Task 5.)

---

## Task 3: Tauri TS adapter

**Files:**
- Modify: `src/adapters/tauri.ts`

- [ ] **Step 1: Add the method**

Open `src/adapters/tauri.ts`. After the existing `loadSnapshot` method (around line 37–39), add:

```ts
  async deleteSnapshot(path: string): Promise<void> {
    await invoke("delete_snapshot", { path });
  }
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: `TauriAdapter` no longer errors; the other adapters still error until Tasks 4–5.

---

## Task 4: Browser adapter

**Files:**
- Modify: `src/adapters/browser.ts`

- [ ] **Step 1: Add the `idbDelete` helper**

Open `src/adapters/browser.ts`. Find the existing helpers `idbGet`, `idbPut`, `idbAllKeys` (around lines 39–73). After `idbAllKeys`, add:

```ts
function idbDelete(store: string, key: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}
```

- [ ] **Step 2: Implement `deleteSnapshot` on the class**

In the same file, find the `loadSnapshot` method on `BrowserAdapter` (around line 235). After it, add:

```ts
  async deleteSnapshot(path: string): Promise<void> {
    await idbDelete(STORE_SNAPSHOTS, path);
  }
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: `BrowserAdapter` no longer errors.

---

## Task 5: Other adapters (mobile, vscode) + commit

**Files:**
- Modify: `src/adapters/mobile.ts`
- Modify: `platforms/vscode/src/vscodeAdapter.ts`

- [ ] **Step 1: Mobile adapter — throw not supported**

Open `src/adapters/mobile.ts`. Find the snapshot methods (search for `loadSnapshot`). After `loadSnapshot`, add:

```ts
  async deleteSnapshot(_path: string): Promise<void> {
    throw new Error("Snapshot delete not yet supported on this platform.");
  }
```

If you cannot find a snapshot section in `mobile.ts`, search for the class definition with `grep -n "class.*Adapter" src/adapters/mobile.ts` and add the method somewhere consistent with the existing structure.

- [ ] **Step 2: VSCode adapter — throw not supported**

Open `platforms/vscode/src/vscodeAdapter.ts`. Find the snapshot methods (search for `loadSnapshot`). After `loadSnapshot`, add the same throw:

```ts
  async deleteSnapshot(_path: string): Promise<void> {
    throw new Error("Snapshot delete not yet supported on this platform.");
  }
```

- [ ] **Step 3: Verify all platforms type-check**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 4: Verify Rust still compiles (no regressions)**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: compiles.

- [ ] **Step 5: Commit Tasks 1–5 together**

```bash
git add src/adapters/index.ts src/adapters/browser.ts src/adapters/tauri.ts \
        src/adapters/mobile.ts platforms/vscode/src/vscodeAdapter.ts \
        src-tauri/src/commands/project.rs src-tauri/src/lib.rs
git commit -m "adapters: add deleteSnapshot to PlatformAdapter + implementations"
```

---

## Task 6: Store action

**Files:**
- Modify: `src/store/editorStore.ts`

- [ ] **Step 1: Declare the action in the store type**

Open `src/store/editorStore.ts`. Find the snapshot actions in the type definition (around lines 167–170):

```ts
  // Snapshots
  createSnapshot: (label: string) => Promise<void>;
  loadSnapshots: () => Promise<void>;
  restoreSnapshot: (path: string) => Promise<void>;
```

Add a fourth line:

```ts
  deleteSnapshot: (path: string) => Promise<void>;
```

- [ ] **Step 2: Implement the action**

Find the existing snapshot action implementations (around lines 1091–1113). After `restoreSnapshot`, add:

```ts
  deleteSnapshot: async (path) => {
    const adapter = getAdapter();
    await adapter.deleteSnapshot(path);
    await get().loadSnapshots();
  },
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/store/editorStore.ts
git commit -m "store: add deleteSnapshot action"
```

---

## Task 7: ChangesCompareDialog generalization — props + size mismatch

**Files:**
- Modify: `src/components/Canvas/ChangesCompareDialog.tsx`

This task changes the component signature to accept optional override props and handle different baseline/current canvas sizes. Existing call sites work unchanged because all new props are optional.

- [ ] **Step 1: Read the current component to understand the structure**

Run: `cat src/components/Canvas/ChangesCompareDialog.tsx`
Note where `baselineCanvasData`, `canvasSize`, and the title `变更对比` are referenced.

- [ ] **Step 2: Rewrite the component with optional props and size-union logic**

Replace the entire contents of `src/components/Canvas/ChangesCompareDialog.tsx` with:

```tsx
import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { useEditorStore } from "../../store/editorStore";
import { getEffectiveHex } from "../../utils/colorHelper";
import type { CanvasData, CanvasSize } from "../../types";
import type { ColorOverrideMap } from "../../utils/colorHelper";

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
  /** Override baseline size. When omitted, reads store.canvasSize. */
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

  const stats = useMemo(() => {
    if (!baselineData) return { added: 0, removed: 0, modified: 0 };
    let added = 0, removed = 0, modified = 0;
    for (let r = 0; r < viewH; r++) {
      for (let c = 0; c < viewW; c++) {
        const base = baselineData[r]?.[c]?.colorIndex ?? null;
        const curr = canvasData[r]?.[c]?.colorIndex ?? null;
        if (base === curr) continue;
        if (base === null) added++;
        else if (curr === null) removed++;
        else modified++;
      }
    }
    return { added, removed, modified };
  }, [canvasData, baselineData, viewW, viewH]);

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
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Verify the existing call site still compiles**

The call site at `src/App.tsx:853` is:
```tsx
{showChangesCompare && <ChangesCompareDialog onClose={() => setShowChangesCompare(false)} />}
```

All new props are optional. The dialog will fall back to `store.baselineCanvasData` and `store.canvasSize` exactly as before. No changes to App.tsx for the existing call.

- [ ] **Step 5: Run existing tests**

Run: `npx vitest run`
Expected: all pass (the dialog refactor preserves the old behavior when no props are passed).

- [ ] **Step 6: Commit**

```bash
git add src/components/Canvas/ChangesCompareDialog.tsx
git commit -m "ChangesCompareDialog: accept optional baseline override + size-union view"
```

---

## Task 8: ChangesCompareDialog test — size mismatch stat math

**Files:**
- Create: `src/components/Canvas/ChangesCompareDialog.test.tsx`

This test exercises the **stats** computation only — it imports the component, but instead of rendering it (which would require jsdom + canvas), it tests the pure stat math directly. The simplest approach is to expose a pure helper.

Refactor the stat logic into a standalone exported pure function so it's testable without rendering.

- [ ] **Step 1: Extract `computeChangeStats` from the dialog**

Open `src/components/Canvas/ChangesCompareDialog.tsx`. Above the `ChangesCompareDialog` function export, add:

```tsx
export interface ChangeStats {
  added: number;
  removed: number;
  modified: number;
}

export function computeChangeStats(
  current: CanvasData,
  baseline: CanvasData | null,
  viewW: number,
  viewH: number,
): ChangeStats {
  if (!baseline) return { added: 0, removed: 0, modified: 0 };
  let added = 0, removed = 0, modified = 0;
  for (let r = 0; r < viewH; r++) {
    for (let c = 0; c < viewW; c++) {
      const base = baseline[r]?.[c]?.colorIndex ?? null;
      const curr = current[r]?.[c]?.colorIndex ?? null;
      if (base === curr) continue;
      if (base === null) added++;
      else if (curr === null) removed++;
      else modified++;
    }
  }
  return { added, removed, modified };
}
```

Replace the inline `useMemo(() => { ... let added = 0 ... }, [...]);` block with:

```tsx
  const stats = useMemo(
    () => computeChangeStats(canvasData, baselineData, viewW, viewH),
    [canvasData, baselineData, viewW, viewH],
  );
```

- [ ] **Step 2: Type-check still passes**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Write the test**

Create `src/components/Canvas/ChangesCompareDialog.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { computeChangeStats } from "./ChangesCompareDialog";
import type { CanvasData } from "../../types";

function makeCells(rows: (number | null)[][]): CanvasData {
  return rows.map((row) => row.map((v) => ({ colorIndex: v })));
}

describe("computeChangeStats", () => {
  it("returns zeros when baseline is null", () => {
    expect(computeChangeStats(makeCells([[1]]), null, 1, 1)).toEqual({
      added: 0, removed: 0, modified: 0,
    });
  });

  it("returns zeros for identical grids", () => {
    const a = makeCells([[1, 2], [3, 4]]);
    const b = makeCells([[1, 2], [3, 4]]);
    expect(computeChangeStats(a, b, 2, 2)).toEqual({
      added: 0, removed: 0, modified: 0,
    });
  });

  it("counts added/removed/modified", () => {
    const baseline = makeCells([
      [null, 1, 2],
      [3,    4, null],
    ]);
    const current = makeCells([
      [5,    1, 2],   // added: (0,0) null→5
      [3,    9, 8],   // modified: (1,1) 4→9; added: (1,2) null→8
    ]);
    expect(computeChangeStats(current, baseline, 3, 2)).toEqual({
      added: 2, removed: 0, modified: 1,
    });
  });

  it("counts removed cells", () => {
    const baseline = makeCells([[1, 2, 3]]);
    const current = makeCells([[1, null, 3]]);
    expect(computeChangeStats(current, baseline, 3, 1)).toEqual({
      added: 0, removed: 1, modified: 0,
    });
  });

  it("handles size mismatch — baseline smaller than current", () => {
    // baseline 2x2, current 3x2 (extra column on the right is all filled)
    const baseline = makeCells([
      [1, 2],
      [3, 4],
    ]);
    const current = makeCells([
      [1, 2, 5],
      [3, 4, 6],
    ]);
    // Walking 3x2 (union), the extra column has baseline=null, current=5/6 → 2 added
    expect(computeChangeStats(current, baseline, 3, 2)).toEqual({
      added: 2, removed: 0, modified: 0,
    });
  });

  it("handles size mismatch — current smaller than baseline", () => {
    const baseline = makeCells([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const current = makeCells([
      [1, 2],
      [4, 5],
    ]);
    // Walking 3x2 (union), the extra column has baseline=3/6, current=undefined→null → 2 removed
    expect(computeChangeStats(current, baseline, 3, 2)).toEqual({
      added: 0, removed: 2, modified: 0,
    });
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/Canvas/ChangesCompareDialog.test.tsx`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Canvas/ChangesCompareDialog.tsx src/components/Canvas/ChangesCompareDialog.test.tsx
git commit -m "ChangesCompareDialog: extract computeChangeStats + size-mismatch tests"
```

---

## Task 9: Snapshot dialog UI — three buttons per row, compare + delete handlers

**Files:**
- Modify: `src/App.tsx`

This task wires everything together: adds local state for the "compare target" (loaded snapshot data), adds compare and delete handlers, replaces the single-button row with the new three-button row, and conditionally renders `ChangesCompareDialog` with snapshot-baseline props.

- [ ] **Step 1: Add state + handlers**

Open `src/App.tsx`. Find the existing snapshot-related state hooks (around lines 113–114, 173–176). Add new ones nearby:

```tsx
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [compareSnapshot, setCompareSnapshot] = useState<{
    canvasData: CanvasData;
    canvasSize: CanvasSize;
    name: string;
  } | null>(null);
```

(Adjust the existing `useState(false)` for `showSnapshots` lines if you need to reorder; the key is the `compareSnapshot` state is added in the same `App` component scope.)

At the top of `App.tsx`, ensure these types are imported (add to the existing type import line if not already there):

```tsx
import type { CanvasData, CanvasSize } from "./types";
```

Find the snapshot store hooks (around lines 173–176). Add `deleteSnapshot`:

```tsx
  const snapshots = useEditorStore((s) => s.snapshots);
  const createSnapshot = useEditorStore((s) => s.createSnapshot);
  const loadSnapshots = useEditorStore((s) => s.loadSnapshots);
  const restoreSnapshot = useEditorStore((s) => s.restoreSnapshot);
  const deleteSnapshot = useEditorStore((s) => s.deleteSnapshot);
```

- [ ] **Step 2: Add compare handler**

The browser/Tauri adapter exposes `loadSnapshot` via `getAdapter().loadSnapshot(path)`. We'll inline the call.

Add a handler near the other event handlers. The simplest place is inline in the button, but for clarity make a named arrow function inside the snapshot dialog JSX. Inside the snapshot dialog map (find the section that maps `snapshots.map((s) => ...)` around line 1101), inline an async handler.

Actually let's keep it inline and short. Skip to Step 3.

- [ ] **Step 3: Replace the snapshot dialog body**

Find the existing snapshot dialog JSX (around lines 1062–1130). The whole `{showSnapshots && (...)}` block.

Replace with the version below. The key differences from before:
- Dialog width `w-[420px]` → `w-[480px]`
- Each row has a button group: 对比 / 恢复 / 删除
- Compare opens `ChangesCompareDialog` with snapshot data as baseline
- Delete uses `confirm()` then calls `deleteSnapshot`

```tsx
      {/* Snapshot Dialog */}
      {showSnapshots && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[480px] max-h-[70vh] flex flex-col">
            <div className="px-4 py-3 border-b flex justify-between items-center">
              <h2 className="font-semibold text-sm">版本管理</h2>
              <button
                onClick={() => setShowSnapshots(false)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3 overflow-y-auto">
              {/* Create snapshot */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={snapshotLabel}
                  onChange={(e) => setSnapshotLabel(e.target.value)}
                  placeholder="版本备注（可选）"
                  className="flex-1 px-2 py-1 text-xs border rounded"
                />
                <button
                  onClick={async () => {
                    await createSnapshot(snapshotLabel || "手动保存");
                    setSnapshotLabel("");
                  }}
                  className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                >
                  创建快照
                </button>
              </div>

              {/* Snapshot list */}
              {snapshots.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">暂无快照</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {snapshots.map((s) => (
                    <div
                      key={s.path}
                      className="flex items-center gap-2 p-2 bg-gray-50 rounded border text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.name}</div>
                        <div className="text-gray-400">{s.modified}</div>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            const proj = await getAdapter().loadSnapshot(s.path);
                            setCompareSnapshot({
                              canvasData: proj.canvasData,
                              canvasSize: proj.canvasSize,
                              name: s.name,
                            });
                          } catch (e) {
                            alert(`加载快照失败: ${e instanceof Error ? e.message : String(e)}`);
                          }
                        }}
                        className="px-2 py-1 border border-gray-300 text-blue-600 rounded hover:bg-blue-50 shrink-0"
                      >
                        对比
                      </button>
                      <button
                        onClick={async () => {
                          await restoreSnapshot(s.path);
                          setShowSnapshots(false);
                        }}
                        className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 shrink-0"
                      >
                        恢复
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`确认删除快照「${s.name}」？此操作不可撤销。`)) return;
                          try {
                            await deleteSnapshot(s.path);
                          } catch (e) {
                            alert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
                          }
                        }}
                        title="删除快照"
                        className="px-2 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50 shrink-0"
                      >
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Snapshot compare dialog */}
      {compareSnapshot && (
        <ChangesCompareDialog
          onClose={() => setCompareSnapshot(null)}
          baselineData={compareSnapshot.canvasData}
          baselineSize={compareSnapshot.canvasSize}
          baselineLabel={`快照: ${compareSnapshot.name}`}
          currentLabel="当前"
          title="与快照对比"
        />
      )}
```

Make sure `getAdapter` is already imported at the top of the file. If not, add:

```tsx
import { getAdapter } from "./adapters";
```

(Check with `grep -n "getAdapter" src/App.tsx` first.)

- [ ] **Step 4: Type-check passes**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "App: add compare and delete buttons to snapshot rows"
```

---

## Task 10: Manual smoke test

**Files:** none

Use Tauri dev to verify the full flow.

- [ ] **Step 1: Start the dev app**

Run: `npm run tauri dev` (from project root, or whatever command this project uses — check `cat package.json | grep -A 5 '"scripts"'`).

- [ ] **Step 2: Walk through the user flow**

1. Open a sample project (e.g. `samples/inuyasha-small.pindou`)
2. Open the version-management dialog
3. Create 2 snapshots with different labels
4. Make some edits to the canvas
5. Click 对比 on the first snapshot → confirm the diff dialog opens, baseline side shows the snapshot, current side shows the edits, stats are reasonable (some `+` / `-` / `~` count)
6. Close the compare dialog → snapshot list should still be open
7. Click 删除 on the first snapshot → confirm the native confirmation appears
   - Click 取消 → snapshot remains
   - Click 确定 → snapshot disappears from the list
8. Click 恢复 on the remaining snapshot → verify it restores correctly

- [ ] **Step 3: Repeat on the VSCode webview build for the no-snapshot-platform fallback**

(This is informational; VSCode webview currently has no UI to even open snapshots in the existing build. Skip if access is gated.)

If the snapshot dialog IS reachable from VSCode webview:
1. Try delete → expect alert with "Snapshot delete not yet supported on this platform."

- [ ] **Step 4: If anything breaks, file a follow-up commit**

Otherwise mark Task 10 done and proceed to finishing-a-development-branch.

---

## Self-Review

**Spec coverage:**
- Compare reuses ChangesCompareDialog with optional props → Task 7
- Generalized dialog handles size mismatch (union) → Task 7 + Task 8 (tests)
- Snapshot compare loads snapshot via adapter and passes its data as props → Task 9
- Delete adapter method on all platforms (Tauri Rust + TS, Browser IDB, mobile/vscode throw) → Tasks 1–5
- Store action `deleteSnapshot` → Task 6
- Three-button row in snapshot dialog → Task 9
- Native `confirm()` before delete → Task 9
- Manual smoke test → Task 10

**Placeholder scan:** No TBD / TODO / "Add appropriate". All steps have actual code.

**Type consistency:**
- `deleteSnapshot(path: string): Promise<void>` consistent across interface, all adapters, store, and call site.
- `ChangesCompareDialogProps` field names (`baselineData`, `baselineSize`, `baselineLabel`, `currentLabel`, `title`) consistent between definition and call site in Task 9.
- `computeChangeStats(current, baseline, viewW, viewH)` signature consistent between extraction (Task 8 Step 1), useMemo replacement (Task 8 Step 1), and test usage (Task 8 Step 3).
