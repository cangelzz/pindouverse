# Deselect Selection — Design

**Date**: 2026-06-14
**Status**: Draft, awaiting user review
**Scope**: Give the canvas selection three reliable ways to be cleared, fixing the bug where a whole-canvas marquee selection cannot be deselected (no empty grid cell to click).

---

## Problem

When a rectangular marquee selection covers the entire canvas, there is no way to deselect it. In the select tool's `handleMouseDown` (`src/components/Canvas/PixelCanvas.tsx`):

- Clicking a cell **inside** the selection starts a selection drag (line ~936), never clears.
- Clicking the gray margin **outside** the canvas grid returns early at `if (!cell) return` (line ~847), never clears.

A whole-canvas selection has no empty grid cell to click, so neither path clears it — the user is stuck. (Partial selections can already be cleared by clicking a non-selected cell, which hits `clearSelection()` at line ~946.)

## Decisions (agreed with user)

1. **Reuse the existing `clearSelection()` store action** — no new store action. It already commits any floating selection first, then nulls `selection`/`selectionBounds`.
2. **Three entry points**: a "取消选区" item at the bottom of the right-click context menu; a "取消选区" button on the canvas toolbar; and clicking the gray canvas margin while the select tool is active.
3. **Margin-click scope**: only when the **select tool** is active, and only within the **canvas viewport container's gray margin** (a click that maps to no grid cell). Other tools and side panels are untouched. (User choice.)
4. **Toolbar button visibility**: rendered **only when a selection exists** (`selection` is non-null). Hidden otherwise. (User choice.)

## Why no floating-selection ambiguity

`clearSelection()` commits (stamps down) a floating selection before clearing. But:

- The right-click menu and the `SelectionActionsChip` already only render when `!floatingSelectionState` (lines ~1463, ~1521), so "取消选区" in the menu only ever applies to a non-floating marquee.
- During a floating selection, `selection` is `null` (set when lifting/duplicating to float), so the toolbar button — gated on `selection` truthy — is automatically hidden too.
- The margin-click path is additionally guarded by `!floatingSelectionState`.

So all three entry points act only on a non-floating marquee selection. Floating selections continue to be committed by clicking outside them, exactly as today. No behavior change for floating selections.

## Changes

All changes are in the webview React layer. **No store changes, no adapter/Rust changes.**

### 1. `src/components/Canvas/SelectionContextMenu.tsx`

- Add a prop to the `Props` interface: `onDeselect: () => void;`
- Add it to the destructured params.
- At the bottom of the menu (after the existing "替换颜色..." item), append:

```tsx
      <Divider />

      <Item label="取消选区" onClick={onDeselect} onCloseMenu={onClose} />
```

### 2. `src/components/Canvas/PixelCanvas.tsx`

- Pass the new prop where `<SelectionContextMenu ... />` is mounted (~line 1540):

```tsx
          onDeselect={() => clearSelection()}
```

- In `handleMouseDown`, replace the early `if (!cell) return;` inside the `if (e.button === 0)` block (~line 846–847) with a margin-aware version:

```tsx
      if (e.button === 0) {
        const cell = screenToCell(e.clientX, e.clientY);
        if (!cell) {
          // Click in the gray margin (outside the canvas grid). In the select
          // tool, treat it as "click empty space" → deselect. This is the only
          // way to clear a whole-canvas selection, which has no empty grid cell
          // to click. Other tools and floating selections are untouched.
          if (currentTool === "select" && selection && !floatingSelectionState) {
            clearSelection();
          }
          return;
        }
        // ... rest unchanged
```

`clearSelection` is already read from the store in this component (line ~72). `currentTool`, `selection`, `floatingSelectionState` are already in scope and in the `handleMouseDown` dependency array.

### 3. `src/components/Canvas/CanvasToolbar.tsx`

- Read from the store: `const selection = useEditorStore((s) => s.selection);` and `const clearSelection = useEditorStore((s) => s.clearSelection);`
- Render a conditional button. Place it after the basic-tools second slice (the `tools.slice(4)` block, i.e. after the 平移 button) and before the first `<div className="border-t my-1 w-full" />`:

```tsx
      {/* Deselect — only while a selection exists */}
      {selection && (
        <button
          onClick={() => clearSelection()}
          className="w-9 h-9 rounded flex items-center justify-center text-lg hover:bg-gray-200"
          title="取消选区"
        >
          ⊘
        </button>
      )}
```

Glyph `⊘` (circled slash) reads as "clear/none" and matches the existing single-character icon style. Final glyph may be adjusted during implementation if a clearer one fits the toolbar's visual language.

## Testing

Playwright webview tests in `platforms/vscode/tests/` (add to the existing `selection-actions.spec.ts`, which already has selection helpers, or a new `deselect.spec.ts` — implementation plan decides). Use store actions via `callAction`/`setStoreState` for setup and `getStoreState` for assertions; avoid synthesizing canvas pointer events except where the margin-click test requires a real click.

1. **Context-menu item**: seed a selection, right-click the canvas to open the menu, assert a `menuitem` named `取消选区` is visible, click it, assert `selection` is `null` and the menu closed.
2. **Toolbar button**: assert no `取消选区` button when there is no selection; `selectAll` (or seed a selection); assert the button appears; click it; assert `selection` is `null` and the button disappears.
3. **Margin click (the core bug)**: select tool active, seed a whole-canvas selection (`selectAll`), then dispatch a left mousedown at a coordinate inside the canvas container's gray margin (outside the grid) — derive the coordinate from the container's `boundingBox` (e.g. a corner known to be outside a centered, fit-to-window grid). Assert `selection` becomes `null`. If reliable margin coordinates prove too brittle in the headless harness, fall back to a documented manual smoke test and keep tests 1–2 as the automated coverage; note this explicitly in the plan rather than silently dropping it.

No unit tests: no new pure functions; `clearSelection` already has coverage.

## Files

**Modified:**
- `src/components/Canvas/SelectionContextMenu.tsx` — new `onDeselect` prop + bottom "取消选区" item.
- `src/components/Canvas/PixelCanvas.tsx` — pass `onDeselect`; margin-click deselect in `handleMouseDown`.
- `src/components/Canvas/CanvasToolbar.tsx` — conditional "取消选区" button.
- `platforms/vscode/tests/selection-actions.spec.ts` (or new `deselect.spec.ts`) — tests 1–3.

No store, adapter, or Rust changes.

## Risks / Trade-offs

- **Margin-click only in select tool**: a user on the pen tool with a whole-canvas selection cannot deselect by clicking the margin — but the toolbar button and right-click menu work for every tool, so the bug is still fully fixed. This is the conservative, low-risk choice the user selected.
- **Toolbar button conditional rendering**: the toolbar's button set shifts vertically when a selection appears/disappears. Acceptable and consistent with the existing blueprint-mode sub-toggles, which also render conditionally.
- **Glyph choice** (`⊘`) is provisional; a different icon can be swapped without design impact.

## Out of Scope

- Escape-key to deselect (not requested; can be added later trivially if wanted).
- Discard-vs-commit choice for floating selections (floating selections are unaffected; they commit on click-outside as today).
- A deselect affordance on `SelectionActionsChip` (the three requested entry points are sufficient).
- Any change to how selections are created or resized.
