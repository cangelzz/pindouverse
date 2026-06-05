# Weapp Feature Migration — Design Spec

**Date:** 2026-06-02
**Base branch:** `miniapp/base`
**Scope:** Port four high-value features from the desktop/VS Code editor (`src/`) to the WeChat mini-app (`platforms/weapp/`).

## Goals

Bring the weapp editor (`platforms/weapp/src/pages/result/index.tsx`) closer to feature parity with the desktop editor on the editor surface that matters most for actual bead-art workflows.

## Non-goals

- No changes to `src/` (desktop) code.
- No multi-layer support, voice control, cloud sync, snapshots, or project info dialog (deferred).
- No shared package (`@pindou/core`) additions — weapp stays self-contained per user decision.

## Features (in implementation order)

| # | Feature | Branch | Depends on |
|---|---|---|---|
| 1 | Shape tools: line / rect / circle | `feature/weapp-shape-tools` | — |
| 2 | Blueprint mode + mirror | `feature/weapp-blueprint` | — |
| 3 | Selection + copy/cut/paste | `feature/weapp-selection` | — |
| 4 | Magic wand + region erase | `feature/weapp-wand-eraserfill` | #3 |

Each feature is implemented on its own branch off `miniapp/base`, verified, then squash-merged back. The branch is deleted after merge. Per the project's CLAUDE.md: never commit directly to `miniapp/base`.

## Shared-code strategy

Weapp owns its utilities. New files under `platforms/weapp/src/utils/`:

| File | Contents |
|---|---|
| `shapeDrawing.ts` | `lineCells`, `rectCells`, `circleCells`, `constrainLine`, `constrainRect` — ported verbatim from `src/utils/shapeDrawing.ts` (115 lines, pure functions) |
| `floodFill.ts` | `computeFloodReplaceEntries` (extracted from `result/index.tsx:72-96`) + `computeFloodSelectCells` (new, returns cell coords without mutating) |
| `selectionUtils.ts` | `rectSelectionCells`, `cellsToBounds`, `cloneSelectionRegion`, `applySelectionData`, clipboard payload type |

Desktop's equivalents are not touched. Long-term, if the duplication causes drift bugs, we can revisit promoting them to `@pindou/core` later.

## Test strategy per feature

Each feature branch must pass before merge:

1. **Unit tests** (vitest) on the pure utility functions added. Requires adding `vitest` as a `platforms/weapp/` devDependency and a `npm test` script. Co-located `*.test.ts` next to each util.
2. **Type check**: `npm run type-check` in `platforms/weapp/`.
3. **e2e**: One `tests/e2e/<feature>.test.ts` script using `miniprogram-automator`, following the pattern in `projects.test.ts`. Asserts the action's effect via storage reads or `mockWxMethod` returns. (`miniprogram-automator`'s ability to drive a `<Canvas>` is limited; prefer wiring tests through page-level methods exposed via `mp.currentPage().callMethod` rather than synthesized canvas touches.)
4. **Manual UI walkthrough** in WeChat DevTools: golden path + 1 edge case per feature.

## UI integration: toolbar growth

The current toolbar (`result/index.tsx:1543-1561`) holds 5 tools + export in one row. Adding 6 more tools (3 shapes + select + wand + eraserFill) makes the row overflow on small screens.

Two options carried into implementation; pick at the time of building feature #1:

### Option A — Grouped buttons (default plan)

```
画笔 | 形状▾ | 选区▾ | 油漆桶 | 取色 | 平移 | 导出
        ↓        ↓
   line/rect/circle   eraserFill/wand
```

- "形状▾" and "选区▾" open a `Taro.showActionSheet` listing their sub-tools
- Currently active sub-tool's icon replaces the group button's icon, so the user can tap once to re-activate the last shape
- Eraser stays as its own button at its current position (or moves under "选区▾" group)

### Option B — Horizontal scrollable toolbar

Wrap the existing `<View className="editor__toolbar">` in a `<ScrollView scrollX>` and lay all tools flat. Cheaper to implement but discoverability is worse — users may not scroll right.

Decision criteria: if the toolbar layout already has design constraints we forgot, fall back to Option B. Otherwise Option A.

## Feature-by-feature design

### #1 Shape tools (line / rect / circle)

**State adds** (locals in `ResultPage`):
- `shapeFilled: boolean` (default `false` = outline mode), toggle via long-press on the group button
- `shapePreview: { tool: Shape, cells: [number, number][] } | null` — live drag preview

**Touch flow**:
1. `onTouchStart` with shape tool active → record startCell, set `shapePreview = { cells: [start] }`
2. `onTouchMove` → recompute cells via the matching `xxxCells()` function, update preview
3. `onTouchEnd` → convert cells to `CellPatch[]` (`prev` from `dataRef`, `next = selectedColorIndex`), push as a single history entry, clear preview

**Render**: in `drawCanvas`, after the main grid render, overlay preview cells with a semi-transparent fill of the selected color so the user sees what they'll get.

**Recent colors**: a shape commit calls `pushRecent(selectedColorIndex)` once, same as pen.

**Unit tests**: ported tests for `lineCells` / `rectCells` / `circleCells` covering: empty, single-cell, diagonal, vertex order independence, filled vs outline.

**e2e**: build a 16×16 canvas, call a page method that simulates "draw a 5×5 rect with color X", assert resulting cell count + corner cells via storage read.

### #2 Blueprint mode + mirror

**State adds**:
- `blueprintMode: boolean` — persisted to storage key `pindou:blueprint:mode`
- `blueprintMirror: boolean` — persisted to storage key `pindou:blueprint:mirror`

**Render** in `drawCanvas`:
- When `blueprintMode === true`: for each non-empty cell, paint a very light tint background (e.g. `hex + '22'`) and draw the `MARD_COLORS[idx].code` text centered with `ctx.fillText`. Font size = `Math.max(8, cell * 0.4)`.
- When `blueprintMirror === true`: wrap the whole grid render in `ctx.save(); ctx.scale(-1, 1); ctx.translate(-drawW, 0); … ctx.restore();`. Touch-to-cell mapping must mirror back: when mirror is on, transform `tapX` to `drawW - tapX` before computing `col`.

**Menu entry** (in `openProjectMenu`):
- Add `blueprintMode ? '退出图纸模式' : '进入图纸模式'`
- When blueprint is on, also show `blueprintMirror ? '退出镜像' : '镜像（背面视角）'`

**Editing in blueprint mode**: allowed. The blueprint is just a visual mode; pen/eraser/etc still work. Mirror DOES affect input mapping (so what you tap is the cell you visually see).

**Unit tests**: none — render-only changes verified by manual + e2e.

**e2e**: enable blueprint via page method, assert `blueprintMode` storage value is `true`; toggle mirror, assert second storage flip.

### #3 Selection + copy/cut/paste

**New tool**: `select` (drag-out rectangle).

**State adds**:
- `selectionBounds: { r1, c1, r2, c2 } | null`
- `selectionCells: Set<string> | null` — for irregular selections from wand later (#4). For rectangles, derived from bounds.
- `floatingSelection: { w, h, cells: (number|null)[][], offsetRow, offsetCol } | null` — paste preview
- `clipboardRef = useRef<ClipboardPayload | null>(null)` — in-memory only (matches desktop behavior)

**Touch flow** (select tool):
1. Touch-down on empty area outside selection → start new selection drag
2. Touch-down inside selection → start drag-move (no-op for now; selection itself is static)
3. Long-press inside selection → action sheet: `复制 / 剪切 / 删除 / 填充 ${selectedColorCode} / 取消选区`

**Render**: selection bounds drawn as dashed border (`ctx.setLineDash([4, 4])`) over the affected cells. No marching-ants animation (perf + simplicity).

**Clipboard**:
```ts
interface ClipboardPayload {
  w: number;
  h: number;
  cells: (number | null)[][];
}
```
Lives only in a `useRef`. Not persisted across page navigations; matches desktop.

**Paste flow**:
1. Top toolbar button "粘贴" enabled when clipboardRef is non-null
2. Tap → `floatingSelection` initialized at canvas center
3. While `floatingSelection` is non-null, a floating bar shows at the top: "✓ 确认" and "✕ 取消"; drag-to-move the floating region on canvas
4. ✓ commits as a single history entry; ✕ discards
5. Switching tools or leaving the page while floating → prompt to commit or discard

**Long-press menu actions**:
- 复制: serialize selected cells into `clipboardRef.current`, keep selection
- 剪切: copy + delete in one history entry, clear selection
- 删除: set selected cells to null in one history entry, clear selection
- 填充: set selected cells to `selectedColorIndex` in one history entry, keep selection
- 取消: just clear `selectionBounds` / `selectionCells`

**Unit tests**: `rectSelectionCells(bounds)` returns expected cell set; `applySelectionData(data, payload, offset)` produces correct `CellPatch[]` including clamping to canvas bounds.

**e2e**: page-method to set a selection bounds, page-method to copy, page-method to paste at offset, assert canvas data via storage.

### #4 Magic wand + region erase

**eraserFill tool**: separate from `eraser`. Same code path as `fill` but writes `null` instead of `selectedColorIndex`. Confirmation modal when target region size > 50 cells (matches existing safety pattern).

**wand tool**:
1. Tap a cell → `computeFloodSelectCells(data, r, c, w, h)` returns same-color-connected cells
2. Result is loaded into `selectionCells` (irregular selection, not a bound rect; derive a bounding box for the dashed-border render)
3. Same long-press action sheet as #3 applies

**Render irregular selections**: dashed outline drawn around the outer edge of the selection region. Simplest: outline every cell that has at least one neighbor not in the selection (per-edge). Performance is fine for typical wand selections (<500 cells).

**Unit tests**: `computeFloodSelectCells` — single cell, full-uniform region, diagonal disconnection (4-connected, not 8), bounds clamping.

**e2e**: seed canvas with a known same-color blob, fire wand at one of its cells via page method, assert `selectionCells` size matches.

## Per-feature commit / merge checklist

For each feature:

1. `git checkout miniapp/base && git pull` (paranoia)
2. `git checkout -b feature/weapp-<name>`
3. Implement util(s) → write unit tests → run vitest → green
4. Wire into `result/index.tsx` (and toolbar/menu changes)
5. Build: `cd platforms/weapp && npm run build:weapp`
6. Type check: `npm run type-check`
7. Write `tests/e2e/<feature>.test.ts`, run `npm run test:e2e:build`
8. Manual smoke in DevTools (golden path + 1 edge case)
9. Commit on the feature branch (small commits OK during dev)
10. `git checkout miniapp/base && git merge --squash feature/weapp-<name> && git commit -m "feat(weapp): <feature> ported from desktop"`
11. `git branch -d feature/weapp-<name>`
12. Move to next feature

## Risks & open items

- **Canvas touch performance**: shape preview re-renders on every touchmove. If laggy on low-end devices, throttle to 30 fps via `requestAnimationFrame`.
- **Touch precision in mirror mode**: confirm by manual test that flipping doesn't drift cell coordinates by 1 px at edges.
- **e2e for canvas interactions**: `miniprogram-automator` can't synthesize canvas touches reliably. Expose test-only page methods (gated by `process.env.NODE_ENV === 'development'`) that call the same internal handlers tap events would, so e2e exercises real logic without fighting the input layer.
- **Clipboard navigation**: if the user navigates away mid-paste (floatingSelection non-null), the back-nav warning hook already in place (`unsaved changes`) should be extended to also flag pending floating paste.

## Out of scope (to defer to a future round)

- Multi-layer support
- Reference image overlay
- Cloud / Gist sync
- Voice control
- AI voice (LLM)
- Snapshots
- Custom color groups
- Grid focus mode
- Highlight color
- Auto-save
