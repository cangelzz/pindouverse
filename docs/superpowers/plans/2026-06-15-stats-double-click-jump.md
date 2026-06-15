# 统计面板双击跳转色板 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在统计面板双击某颜色行，切到色板 tab、选中该色（蓝 ring + 自动滚动）、并在画布高亮其分布；不改当前工具。

**Architecture:** 回调 prop —— `BeadCounter` 双击行时调 `onColorActivate(colorIndex)`，由 `App` 编排：`setSelectedColor` + `setHighlightColor`（store 现成动作）+ `setRightTab("palette")`（App 本地）。色板的选中 ring/自动滚动、画布分布高亮均为现成响应，不改。

**Tech Stack:** React、zustand、Playwright（webview 集成测试，`platforms/vscode/` 下 `npm run test:webview`）。

设计依据：`docs/superpowers/specs/2026-06-15-stats-double-click-jump-design.md`

---

## 文件结构

**修改**
- `src/components/Stats/BeadCounter.tsx` — 加 `onColorActivate?` prop；每行 `<tr>` 加 `onDoubleClick` + `data-bead-row` + `cursor-pointer` + `title`
- `src/App.tsx` — 取 `setSelectedColor`/`setHighlightColor`，定义 `handleStatColorActivate`，传给 `<BeadCounter>`

**新增**
- `platforms/vscode/tests/statsJump.spec.ts` — webview 集成测试

**复用（不改）**
- `src/components/Palette/ColorPalette.tsx`（`selectedColorIndex` → 蓝 ring + `scrollIntoView`）
- `src/utils/canvasRenderer.ts`（`highlightColorIndex` → 分布高亮）
- `src/store/editorStore.ts`（`setSelectedColor` / `setHighlightColor`）

---

## Task 1: 统计行双击 → 选中 + 画布高亮 + 切色板 tab

**Files:**
- Test: `platforms/vscode/tests/statsJump.spec.ts`
- Modify: `src/components/Stats/BeadCounter.tsx`
- Modify: `src/App.tsx`

已知真实结构：
- `BeadCounter` 是 `export function BeadCounter()`（无 props），行渲染在 `src/components/Stats/BeadCounter.tsx:116`：`<tr key={c.code} className="border-b border-gray-100 hover:bg-gray-50">`；`c` 是 `BeadCount`，含 `colorIndex`/`code`/`name`/`hex`/`count`。
- `App.tsx`：`rightTab` 本地 state 在第 145 行；store 选择器集中在第 154-211 行（含 `colorOverrides` 在 211 行）；`<BeadCounter />` 在第 673 行；tab 按钮"统计"在第 652 行。
- store：`setSelectedColor(index)`、`setHighlightColor(index)` 为纯 `set`；工具字段 `currentTool`（默认 `"pan"`）。
- 测试 helper（`platforms/vscode/tests/helpers.ts`）：`setupPage`、`loadProject`、`cleanupHarness`、`callAction`、`getStoreState`、`clickButton(page, text)`。store 暴露在 `(window as any).__pindouStore`。`npm run test:webview` 会先 `npm run build` 再跑 playwright。

- [ ] **Step 1: 写失败的集成测试**

新建 `platforms/vscode/tests/statsJump.spec.ts`：

```ts
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { setupPage, loadProject, cleanupHarness, callAction, getStoreState, clickButton } from "./helpers";

test.describe("stats double-click jumps to palette", () => {
  test.afterAll(() => cleanupHarness());

  async function seed(page: Page) {
    await callAction(page, "newCanvas", [4, 4]);
    // Two distinct colors so the stats panel has rows: index 0 (A1) and 27 (B2).
    await callAction(page, "batchSetCells", [[
      { row: 0, col: 0, colorIndex: 0 },
      { row: 0, col: 1, colorIndex: 27 },
      { row: 1, col: 0, colorIndex: 27 },
    ]]);
  }

  test("double-clicking a stats row selects + highlights the color and shows the palette", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seed(page);

    const toolBefore = await getStoreState<string>(page, "currentTool");

    // Open the stats tab.
    await clickButton(page, "统计");
    // The seeded row for color 27 must be present.
    const row = page.locator('[data-bead-row="27"]');
    await expect(row).toBeVisible();

    // Double-click it.
    await row.dblclick();

    // Color 27 becomes the selected draw color and the canvas-distribution highlight.
    expect(await getStoreState<number | null>(page, "selectedColorIndex")).toBe(27);
    expect(await getStoreState<number | null>(page, "highlightColorIndex")).toBe(27);

    // The palette tab is now active: its swatch button for color 27 is rendered/visible.
    await expect(page.locator('button[data-color-index="27"]')).toBeVisible();

    // The current tool is unchanged.
    expect(await getStoreState<string>(page, "currentTool")).toBe(toolBefore);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run（在 `platforms/vscode/`）：`npm run test:webview -- statsJump`
Expected: FAIL —— 双击无 handler，`selectedColorIndex`/`highlightColorIndex` 不会变成 27，或 `[data-bead-row="27"]` 不存在。

- [ ] **Step 3: BeadCounter 加双击 prop**

在 `src/components/Stats/BeadCounter.tsx`：

把签名第 9 行
```tsx
export function BeadCounter() {
```
改为
```tsx
export function BeadCounter({ onColorActivate }: { onColorActivate?: (colorIndex: number) => void }) {
```

把行渲染第 116 行
```tsx
              <tr key={c.code} className="border-b border-gray-100 hover:bg-gray-50">
```
改为
```tsx
              <tr
                key={c.code}
                data-bead-row={c.colorIndex}
                onDoubleClick={() => onColorActivate?.(c.colorIndex)}
                className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                title="双击：在色板中选中并高亮分布"
              >
```

- [ ] **Step 4: App 编排并传 prop**

在 `src/App.tsx`：

在 store 选择器区（第 211 行 `const colorOverrides = useEditorStore((s) => s.colorOverrides);` 之后）加：
```tsx
  const setSelectedColor = useEditorStore((s) => s.setSelectedColor);
  const setHighlightColor = useEditorStore((s) => s.setHighlightColor);
```

在组件体内（其它处理函数附近、return 之前的合适位置）加编排函数：
```tsx
  const handleStatColorActivate = (colorIndex: number) => {
    setSelectedColor(colorIndex);
    setHighlightColor(colorIndex);
    setRightTab("palette");
  };
```

把第 673 行
```tsx
            {rightTab === "stats" && <BeadCounter />}
```
改为
```tsx
            {rightTab === "stats" && <BeadCounter onColorActivate={handleStatColorActivate} />}
```

- [ ] **Step 5: 跑测试确认通过**

Run（在 `platforms/vscode/`）：`npm run test:webview -- statsJump`
Expected: PASS（1 个用例）。

- [ ] **Step 6: 类型检查 + 全量 webview 回归**

Run（仓库根）：`npx tsc --noEmit -p tsconfig.json`
Expected: 无错误。

Run（在 `platforms/vscode/`）：`npm run test:webview`
Expected: 原有用例 + 新增 1 个全过。

- [ ] **Step 7: 提交**

```bash
git add src/components/Stats/BeadCounter.tsx src/App.tsx platforms/vscode/tests/statsJump.spec.ts
git commit -m "feat(stats): double-click a color to jump to palette, select + highlight it"
```

> 提交只 `git add` 这三个文件，**不要** `git commit -am` / `git add -A`（仓库有无关 samples 改动）。

---

## 收尾

- [ ] **手测**：画几格不同色 → 切"统计" tab → 双击某色行 → 右侧应切到"色板"、该色蓝 ring 选中并滚动到可见、画布该色分布被红框圈出且其余淡化；当前工具不变。
- [ ] 按项目规范 squash 合并到 main（`git checkout main && git merge --squash feature/stats-double-click-jump && git commit`），删分支。

---

## 自检结论

- **Spec 覆盖**：切 tab（Step 4 `setRightTab`）；选中 ring + 自动滚动（Step 4 `setSelectedColor` → 现成响应）；画布分布高亮（Step 4 `setHighlightColor` → 现成响应）；不改工具（无 `setTool` 调用，Step 1 断言 `currentTool` 不变）；双击触发（Step 3 `onDoubleClick`）。全覆盖。
- **占位符**：无 TBD/TODO，每步含真实代码或确切命令。
- **类型/名称一致**：`onColorActivate`（BeadCounter prop ↔ App 传参）、`handleStatColorActivate`、`data-bead-row`、`setSelectedColor`/`setHighlightColor`/`setRightTab`/`currentTool` 均与真实 store/组件签名一致；测试用 `data-bead-row`（统计行）与 `data-color-index`（色板按钮）区分，避免选择器冲突。
