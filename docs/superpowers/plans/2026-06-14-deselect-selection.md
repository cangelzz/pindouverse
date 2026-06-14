# Deselect Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the canvas selection three ways to be cleared — a right-click menu item, a toolbar button, and a click on the gray canvas margin in the select tool — fixing the bug where a whole-canvas marquee selection cannot be deselected.

**Architecture:** Pure webview React changes reusing the existing `clearSelection()` store action (no new store action). Add an `onDeselect` prop + bottom item to `SelectionContextMenu`, wire it and a margin-click branch into `PixelCanvas.handleMouseDown`, and add a selection-gated button to `CanvasToolbar`. All three call `clearSelection()`.

**Tech Stack:** React (TypeScript), Zustand store, Vite webview, Playwright webview tests.

---

## File Structure

- **Modify** `src/components/Canvas/SelectionContextMenu.tsx` — new `onDeselect` prop and a bottom "取消选区" item.
- **Modify** `src/components/Canvas/PixelCanvas.tsx` — pass `onDeselect`; add margin-click deselect in `handleMouseDown`.
- **Modify** `src/components/Canvas/CanvasToolbar.tsx` — selection-gated "取消选区" button.
- **Modify** `platforms/vscode/tests/selection-actions.spec.ts` — append a `Deselect` describe block (reuses the in-file `seedSelection` helper).

No store, adapter, or Rust changes.

---

## Task 1: Failing tests for the three deselect entry points

**Files:**
- Modify: `platforms/vscode/tests/selection-actions.spec.ts` (append a new `test.describe` block at end of file)

- [ ] **Step 1: Append the failing test block**

Append this to the very end of `platforms/vscode/tests/selection-actions.spec.ts` (after the final `});` of the existing `Selection actions — UI` describe). It reuses the in-file `seedSelection` helper defined at the top of the file.

```ts
test.describe("Deselect", () => {
  test.afterAll(() => cleanupHarness());

  test("context menu has 取消选区 item that clears the selection", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seedSelection(page);

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");

    // Open the context menu over the canvas.
    await page.mouse.click(box.x + 20, box.y + 20, { button: "right" });
    const item = page.getByRole("menuitem", { name: /^取消选区$/ });
    await expect(item).toBeVisible();

    await item.click();

    // Selection cleared and the menu closed.
    expect(await getStoreState(page, "selection")).toBe(null);
    await expect(page.getByRole("menuitem", { name: /^取消选区$/ })).toHaveCount(0);
  });

  test("toolbar 取消选区 button appears only with a selection and clears it", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const btn = page.getByRole("button", { name: "取消选区" });
    // No selection initially → no button.
    await expect(btn).toHaveCount(0);

    await seedSelection(page);
    await expect(btn).toBeVisible();

    await btn.click();
    expect(await getStoreState(page, "selection")).toBe(null);
    await expect(page.getByRole("button", { name: "取消选区" })).toHaveCount(0);
  });

  test("select tool: clicking the gray canvas margin clears a whole-canvas selection", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [8, 8]);
    await callAction(page, "setTool", ["select"]);
    await callAction(page, "selectAll");
    expect(await getStoreState(page, "selection")).not.toBe(null);

    // Shrink the grid so there is a wide gray margin to the right of it.
    await callAction(page, "setZoom", [0.2]);

    const container = page.locator("[data-canvas-container]");
    const box = await container.boundingBox();
    if (!box) throw new Error("container not visible");

    // Geometry from the store: the grid occupies container-local
    // [offsetX, offsetX + width*cellSize] horizontally.
    const geom = await page.evaluate(() => {
      const s = (window as any).__pindouStore.getState();
      return {
        offsetX: s.offsetX,
        cellSize: s.cellSize,
        w: s.canvasSize.width,
      };
    });
    const gridRight = geom.offsetX + geom.w * geom.cellSize;
    const marginX = box.x + gridRight + 10; // 10px past the grid's right edge
    const marginY = box.y + box.height / 2;
    // Sanity: the margin point must still be inside the container.
    expect(marginX).toBeLessThan(box.x + box.width - 1);

    await page.mouse.click(marginX, marginY, { button: "left" });

    expect(await getStoreState(page, "selection")).toBe(null);
  });
});
```

- [ ] **Step 2: Build the webview and run the new block — expect failures**

Run (from `platforms/vscode/`):

```bash
npm run build:webview 2>&1 | tail -3
npx playwright test tests/selection-actions.spec.ts -g "Deselect" 2>&1 | tail -20
```

Expected: 3 failures —
- "context menu has 取消选区 item" → menuitem `取消选区` never appears (times out).
- "toolbar 取消选区 button" → button with that name never appears.
- "select tool: clicking the gray canvas margin..." → margin click currently hits `if (!cell) return` without clearing, so `selection` stays non-null and the final assertion fails.

- [ ] **Step 3: Commit the failing tests**

```bash
git add platforms/vscode/tests/selection-actions.spec.ts
git commit -m "test: failing tests for deselect (menu item, toolbar button, margin click)"
```

---

## Task 2: "取消选区" item in the context menu

**Files:**
- Modify: `src/components/Canvas/SelectionContextMenu.tsx`

- [ ] **Step 1: Add the `onDeselect` prop to the `Props` interface**

Find the `Props` interface (lines ~4–16). Add `onDeselect` after `onReplaceColor`:

```tsx
  onReplaceColor: () => void;
  onDeselect: () => void;
  onClose: () => void;
```

- [ ] **Step 2: Destructure the new prop**

In the `SelectionContextMenu` function params (lines ~62–74), add `onDeselect,` after `onReplaceColor,`:

```tsx
  onReplaceColor,
  onDeselect,
  onClose,
}: Props) {
```

- [ ] **Step 3: Render the bottom item**

Find the last menu item (the "替换颜色..." item, line ~162):

```tsx
      <Item label="替换颜色..." onClick={onReplaceColor} onCloseMenu={onClose} />
    </div>
```

Insert a divider + the deselect item before the closing `</div>`:

```tsx
      <Item label="替换颜色..." onClick={onReplaceColor} onCloseMenu={onClose} />

      <Divider />

      <Item label="取消选区" onClick={onDeselect} onCloseMenu={onClose} />
    </div>
```

- [ ] **Step 4: Typecheck**

Run (from repo root `Q:/repo/pindou`):

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: a type error at the `<SelectionContextMenu .../>` usage in `PixelCanvas.tsx` — `onDeselect` is now required but not yet passed. That's expected; it's fixed in Task 3. (The `isMirror`/`PixelCanvas` pre-existing error from `main` may also appear and is unrelated.) If the ONLY new error is the missing `onDeselect` prop, proceed.

- [ ] **Step 5: Commit**

```bash
git add src/components/Canvas/SelectionContextMenu.tsx
git commit -m "feat: add 取消选区 item to selection context menu"
```

---

## Task 3: Wire onDeselect + margin-click deselect in PixelCanvas

**Files:**
- Modify: `src/components/Canvas/PixelCanvas.tsx`

- [ ] **Step 1: Pass `onDeselect` to the context menu**

Find the `<SelectionContextMenu ... />` mount (around lines ~1540–1552). Add the `onDeselect` prop next to `onReplaceColor`:

```tsx
          onReplaceColor={() => setReplaceOpen(true)}
          onDeselect={() => clearSelection()}
          onClose={() => setContextMenu(null)}
```

`clearSelection` is already read from the store in this component (line ~72).

- [ ] **Step 2: Add margin-click deselect in `handleMouseDown`**

Find the start of the left-button block in `handleMouseDown` (lines ~845–847):

```tsx
      if (e.button === 0) {
        const cell = screenToCell(e.clientX, e.clientY);
        if (!cell) return;
```

Replace `if (!cell) return;` with the margin-aware version:

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
```

`currentTool`, `selection`, `floatingSelectionState`, and `clearSelection` are all already in scope and already listed in this `useCallback`'s dependency array (line ~998), so no dependency-array change is needed.

- [ ] **Step 3: Typecheck**

Run (from repo root):

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: the `onDeselect` error from Task 2 is gone. Only the pre-existing unrelated `PixelCanvas.tsx ... 'isMirror' does not exist` error from `main` may remain (it predates this work). No new errors.

- [ ] **Step 4: Build the webview and run the menu + margin tests**

Run (from `platforms/vscode/`):

```bash
npm run build:webview 2>&1 | tail -3
npx playwright test tests/selection-actions.spec.ts -g "取消选区 item|gray canvas margin" 2>&1 | tail -20
```

Expected: the "context menu has 取消选区 item..." and "select tool: clicking the gray canvas margin..." tests now PASS. (The toolbar test still fails — implemented in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/components/Canvas/PixelCanvas.tsx
git commit -m "feat: deselect via context menu wiring + select-tool margin click"
```

---

## Task 4: Toolbar "取消选区" button

**Files:**
- Modify: `src/components/Canvas/CanvasToolbar.tsx`

- [ ] **Step 1: Read selection + clearSelection from the store**

In `CanvasToolbar`, find the existing store reads near the top of the component (after `const lastEraserSubmode = ...`, line ~29). Add:

```tsx
  const selection = useEditorStore((s) => s.selection);
  const clearSelection = useEditorStore((s) => s.clearSelection);
```

- [ ] **Step 2: Render the selection-gated button**

Find the second basic-tools slice block and the divider that follows it (lines ~129–142):

```tsx
      {/* Basic tools (second slice: eyedropper, pan) */}
      {tools.slice(4).map((t) => (
        <button
          key={t.id}
          onClick={() => setTool(t.id)}
          className={`w-9 h-9 rounded flex items-center justify-center text-lg transition-colors
            ${currentTool === t.id ? "bg-blue-500 text-white shadow" : "hover:bg-gray-200"}`}
          title={`${t.label} (${t.shortcut})`}
        >
          {t.icon}
        </button>
      ))}

      <div className="border-t my-1 w-full" />
```

Insert the deselect button between the closing `))}` of the slice map and the `<div className="border-t my-1 w-full" />`:

```tsx
      ))}

      {/* Deselect — only while a marquee selection exists */}
      {selection && (
        <button
          onClick={() => clearSelection()}
          aria-label="取消选区"
          className="w-9 h-9 rounded flex items-center justify-center text-lg hover:bg-gray-200"
          title="取消选区"
        >
          ⊘
        </button>
      )}

      <div className="border-t my-1 w-full" />
```

(The `aria-label` is required: the button's only text is the glyph `⊘`, which would otherwise be its accessible name and break the role-based test query.)

- [ ] **Step 3: Typecheck**

Run (from repo root):

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: PASS (only the unrelated pre-existing `isMirror` error may remain).

- [ ] **Step 4: Build the webview and run the toolbar test**

Run (from `platforms/vscode/`):

```bash
npm run build:webview 2>&1 | tail -3
npx playwright test tests/selection-actions.spec.ts -g "toolbar 取消选区" 2>&1 | tail -20
```

Expected: the "toolbar 取消选区 button..." test PASSES.

- [ ] **Step 5: Commit**

```bash
git add src/components/Canvas/CanvasToolbar.tsx
git commit -m "feat: add 取消选区 button to canvas toolbar"
```

---

## Task 5: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole Deselect block**

Run (from `platforms/vscode/`):

```bash
npx playwright test tests/selection-actions.spec.ts -g "Deselect" 2>&1 | tail -10
```

Expected: 3 passed.

- [ ] **Step 2: Run the full webview suite — guard against regressions**

Run (from `platforms/vscode/`):

```bash
npm run test:webview 2>&1 | tail -10
```

Expected: all tests pass (the existing suite plus the 3 new Deselect tests). Pay special attention to the existing `Selection actions — UI` tests (right-click menu, chip) — they share the menu and canvas and must stay green.

- [ ] **Step 3: Final commit (if anything is uncommitted)**

```bash
git status --short
```

If clean, done. If build artifacts changed and are tracked:

```bash
git add -A
git commit -m "chore: verify deselect passes webview suite"
```

---

## Self-Review Notes

- **Spec coverage:** right-click menu item (Task 2 + Task 3 Step 1) ✓; toolbar button gated on `selection` (Task 4) ✓; select-tool margin-click deselect (Task 3 Step 2) ✓; reuse `clearSelection`, no new store action ✓; floating selections untouched (margin guard `!floatingSelectionState`; toolbar hidden because `selection` is null while floating; context menu already only renders for non-floating) ✓; tests 1–3 (Task 1) ✓.
- **Margin-test determinism:** `setZoom(0.2)` on an 8×8 canvas guarantees a grid far smaller than the container, so `gridRight + 10` lands in the gray margin; the test asserts `marginX` is still inside the container before clicking. If this proves flaky in CI, the fallback (per the spec) is to demote test 3 to a documented manual smoke and keep tests 1–2 automated — but attempt the automated version first.
- **Type/name consistency:** `onDeselect: () => void` is declared in `Props`, destructured, used on the item, and passed from `PixelCanvas` identically. The toolbar query name (`取消选区`) matches the button's `aria-label`; the menu query name (`取消选区`) matches the `<Item label>`.
- **No new store action:** all three entry points call the existing `clearSelection()`.
- **Manual smoke (recommended once):** make a whole-canvas selection with the select tool, confirm (a) right-click → 取消选区 clears it, (b) the toolbar ⊘ button appears and clears it, (c) clicking the gray margin clears it; then verify the ⊘ button is absent when there is no selection.
