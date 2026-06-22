# 导出图纸标题来自项目属性 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让导出对话框顶部标题栏的标题取自 `projectInfo.title`(与作者对称),项目无标题时可填写并在导出时写回项目信息。

**Architecture:** 删除已被取代的 `ExportWatermarkSettings.appDescription` 字段;`ExportDialog` 新增 `titleInput` 状态绑定 `projectInfo.title`,通过既有纯函数 `composeHeaderDescription(title, author)` 合成 header 文本;导出真正开始时,若项目原本无标题且用户填了标题,调 `setProjectInfo` 写回(自动置 isDirty)。

**Tech Stack:** React + Zustand(`src/store/editorStore.ts`)、Vitest(核心单测)、Playwright(VS Code webview 测试,`platforms/vscode/tests`)。共享组件 `src/components/Export/ExportDialog.tsx` 同时服务 Tauri 桌面端与 VS Code webview。

参考设计文档:`docs/superpowers/specs/2026-06-22-blueprint-export-title-from-project-design.md`

---

### Task 1: 删除 `appDescription` 字段并修复单测

**Files:**
- Modify: `src/types/index.ts:127-138`(`ExportWatermarkSettings` 接口)
- Modify: `src/utils/blueprintDecorations.ts:13-19`(`DEFAULT_WATERMARK_SETTINGS`)
- Test: `src/utils/blueprintDecorations.test.ts:128-157`

这是一个删除重构。先改测试(去掉对 `appDescription` 的引用,换用保留字段 `appWatermark` 断言 load/save 仍覆盖),再删类型与默认值,最后跑测试 + 类型检查确认全绿。

- [ ] **Step 1: 更新单测,移除 `appDescription` 引用**

把 `src/utils/blueprintDecorations.test.ts` 的 "round-trips persisted fields"(128-143 行)与 "fills in missing fields with defaults"(150-157 行)两个用例改为:

```ts
  it("round-trips persisted fields", () => {
    const s: ExportWatermarkSettings = {
      showHeader: false,
      appWatermark: true,
      authorWatermark: false,
      authorOverride: "Alice",
    };
    saveWatermarkSettings(s);
    const loaded = loadWatermarkSettings();
    expect(loaded.showHeader).toBe(false);
    expect(loaded.appWatermark).toBe(true);
    expect(loaded.authorWatermark).toBe(false);
    expect(loaded.authorOverride).toBe("Alice");
  });

  it("ignores malformed JSON gracefully", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadWatermarkSettings()).toEqual(DEFAULT_WATERMARK_SETTINGS);
  });

  it("fills in missing fields with defaults", () => {
    localStorage.setItem(KEY, JSON.stringify({ showHeader: false }));
    const loaded = loadWatermarkSettings();
    expect(loaded.showHeader).toBe(false);
    expect(loaded.appWatermark).toBe(DEFAULT_WATERMARK_SETTINGS.appWatermark);
    expect(loaded.authorWatermark).toBe(DEFAULT_WATERMARK_SETTINGS.authorWatermark);
  });
```

(保持 "ignores malformed JSON gracefully" 用例不变,如上一并列出以保留顺序。)

- [ ] **Step 2: 删除类型字段**

在 `src/types/index.ts` 的 `ExportWatermarkSettings` 接口中删除这两行:

```ts
  /** Optional description appended as " - <desc>" after PindouVerse. Default "". */
  appDescription: string;
```

删除后接口为:

```ts
export interface ExportWatermarkSettings {
  /** Show top header band with icon + PindouVerse text. Default true. */
  showHeader: boolean;
  /** Tile PindouVerse text at 45° across the grid. Default false. */
  appWatermark: boolean;
  /** Tile resolved author text at 45° across the grid. Default true. */
  authorWatermark: boolean;
  /** Per-session author override; not persisted. Empty falls back to projectInfo.author. */
  authorOverride: string;
}
```

- [ ] **Step 3: 删除默认值字段**

在 `src/utils/blueprintDecorations.ts` 的 `DEFAULT_WATERMARK_SETTINGS` 中删除 `appDescription: "",` 一行:

```ts
export const DEFAULT_WATERMARK_SETTINGS: ExportWatermarkSettings = {
  showHeader: true,
  appWatermark: false,
  authorWatermark: true,
  authorOverride: "",
};
```

- [ ] **Step 4: 跑核心单测 + 类型检查**

Run: `npm run test -- blueprintDecorations` (从仓库根目录)
Expected: PASS,所有 `blueprintDecorations.test.ts` 用例通过。

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 仅 `src/components/Export/ExportDialog.tsx` 可能报 `appDescription` 不存在的错误(将在 Task 2 修复)。若此处想保持零报错,可与 Task 2 连续完成后再跑。

- [ ] **Step 5: 不单独提交**,与 Task 2 一起提交(类型删除会让 ExportDialog 暂时无法编译,需 Task 2 同步修复)。

---

### Task 2: ExportDialog 标题字段绑定 `projectInfo.title`

**Files:**
- Modify: `src/components/Export/ExportDialog.tsx`(状态、`watermarkPayload`、header 子字段 UI)
- Test: `platforms/vscode/tests/export.spec.ts`

- [ ] **Step 1: 写失败的 Playwright 测试(有标题 → 只读 / 无标题 → 可编辑)**

在 `platforms/vscode/tests/export.spec.ts` 的 `test.describe("Export", ...)` 内追加两个测试。`setStoreState`、`getStoreState` 已在 `./helpers` 导出;需在 import 列表加入它们(见 Step 2 前的 import 调整)。

```ts
  test("title field: shows project title as read-only when set", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await setStoreState(page, { projectInfo: { title: "犬夜叉桔梗" } });
    await openExportDialog(page);

    await expect(page.getByText("标题来自当前项目设置，优先使用")).toBeVisible();
    // 该场景只设了 title、未设 author，故水印区唯一的 disabled 文本框就是标题框。
    const titleInput = page.locator("input[disabled]");
    await expect(titleInput).toHaveValue("犬夜叉桔梗");
  });

  test("title field: editable when project has no title", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await setStoreState(page, { projectInfo: {} });
    await openExportDialog(page);

    const titleInput = page.getByPlaceholder(/填写后将保存到项目信息/);
    await expect(titleInput).toBeVisible();
    await expect(titleInput).toBeEnabled();
  });
```

- [ ] **Step 2: 运行测试,确认失败**

先在 import 块(`export.spec.ts:2-11`)加入 `setStoreState`, `getStoreState`:

```ts
import {
  setupPage,
  loadProject,
  cleanupHarness,
  stageReply,
  getWrites,
  callAction,
  clearMessages,
  dismissAppAlert,
  setStoreState,
  getStoreState,
} from "./helpers";
```

Run(从 `platforms/vscode/`): `npm run test:webview -- export`
Expected: 两个新测试 FAIL(找不到 "标题来自当前项目设置" 文案 / 找不到新占位符)。

- [ ] **Step 3: 改 ExportDialog —— 状态与 payload**

在 `src/components/Export/ExportDialog.tsx`:

(a) 第 23 行下方,`projectInfo` 选择器后补一个 setter 选择器:

```ts
  const projectInfo = useEditorStore((s) => s.projectInfo);
  const setProjectInfo = useEditorStore((s) => s.setProjectInfo);
```

(b) 第 26 行 `const projectAuthor = ...` 后,新增标题状态:

```ts
  const projectAuthor = projectInfo?.author ?? "";
  const projectTitle = projectInfo?.title ?? "";
  const [titleInput, setTitleInput] = useState(projectTitle);
  const hadProjectTitle = projectTitle.trim().length > 0;
```

(c) 把 `watermarkPayload`(27-37 行)的 `app_description` 来源由 `watermark.appDescription` 改为 `titleInput`,并把 `titleInput` 加入依赖数组:

```ts
  const watermarkPayload: WatermarkPayload = useMemo(
    () => ({
      show_header: watermark.showHeader,
      app_description: composeHeaderDescription(
        titleInput,
        resolveWatermarkAuthor(watermark.authorOverride, projectAuthor)
      ),
      watermark_lines: computeWatermarkLines(watermark, projectAuthor),
    }),
    [watermark, projectAuthor, titleInput]
  );
```

(`composeHeaderDescription` 内部已 trim,直接传 `titleInput` 原值即可。)

- [ ] **Step 4: 改 ExportDialog —— header 子字段 UI**

把 `showHeader` 勾选项下的描述输入块(315-326 行)整体替换为标题块:

```tsx
              {watermark.showHeader && (
                <div className="pl-6">
                  <label className="text-[11px] text-gray-500 block mb-0.5">标题</label>
                  {hadProjectTitle ? (
                    <>
                      <input
                        type="text"
                        value={projectTitle}
                        disabled
                        className="w-full px-2 py-1 text-xs border rounded bg-gray-50 text-gray-500"
                      />
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        标题来自当前项目设置，优先使用
                      </p>
                    </>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={titleInput}
                        onChange={(e) => setTitleInput(e.target.value)}
                        placeholder="(未设置，填写后将保存到项目信息)"
                        className="w-full px-2 py-1 text-xs border rounded"
                      />
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {titleInput.trim()
                          ? "导出时将作为标题，并保存到项目信息"
                          : "未设置标题，仅显示应用名"}
                      </p>
                    </>
                  )}
                </div>
              )}
```

- [ ] **Step 5: 修复受影响的既有测试(旧占位符断言)**

`export.spec.ts` 的 "watermark section: header checkbox visible and toggles" 用例(72 行)断言旧占位符 `犬夜叉桔梗`。默认样本无标题(同 "empty-author hint" 用例所示),故为可编辑分支。把第 72 行改为新占位符:

```ts
    await headerToggle.check();
    await expect(page.getByPlaceholder(/填写后将保存到项目信息/)).toBeVisible();
```

- [ ] **Step 6: 运行测试,确认通过**

Run(从 `platforms/vscode/`): `npm run test:webview -- export`
Expected: 新增两个标题测试 PASS,修改后的 "header checkbox visible and toggles" PASS,其余导出用例不回归。

- [ ] **Step 7: 提交(含 Task 1 改动)**

```bash
git add src/types/index.ts src/utils/blueprintDecorations.ts src/utils/blueprintDecorations.test.ts src/components/Export/ExportDialog.tsx platforms/vscode/tests/export.spec.ts
git commit -m "feat(export): blueprint header title from projectInfo.title; remove appDescription"
```

---

### Task 3: 导出时把填写的标题写回 `projectInfo.title`

**Files:**
- Modify: `src/components/Export/ExportDialog.tsx:96-99`(`handleExport` 内,`setIsExporting(true)` 之后)
- Test: `platforms/vscode/tests/export.spec.ts`

- [ ] **Step 1: 写失败的写回测试**

在 `export.spec.ts` 追加:

```ts
  test("title write-back: typed title saved to projectInfo on export", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await setStoreState(page, { projectInfo: {} });
    await openExportDialog(page);

    await page.getByPlaceholder(/填写后将保存到项目信息/).fill("犬夜叉");

    await stageReply(page, "showSaveDialog", "/out/title-writeback.png");
    await clearMessages(page);
    await page.getByRole("button", { name: /^导出$/ }).last().click();

    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "writeFile" && /title-writeback/.test(w.path)),
      null,
      { timeout: 10_000 }
    );

    const info = await getStoreState<{ title?: string }>(page, "projectInfo");
    expect(info?.title).toBe("犬夜叉");
    await dismissAppAlert(page);
  });

  test("title write-back: does not overwrite existing project title", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await setStoreState(page, { projectInfo: { title: "原标题" } });
    await openExportDialog(page);

    await stageReply(page, "showSaveDialog", "/out/title-keep.png");
    await clearMessages(page);
    await page.getByRole("button", { name: /^导出$/ }).last().click();

    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "writeFile" && /title-keep/.test(w.path)),
      null,
      { timeout: 10_000 }
    );

    const info = await getStoreState<{ title?: string }>(page, "projectInfo");
    expect(info?.title).toBe("原标题");
    await dismissAppAlert(page);
  });
```

- [ ] **Step 2: 运行测试,确认第一个失败**

Run(从 `platforms/vscode/`): `npm run test:webview -- export`
Expected: "title write-back: typed title saved..." FAIL(`projectInfo.title` 仍为 undefined);"does not overwrite..." 可能已 PASS(无写回逻辑时本就不改)。

- [ ] **Step 3: 在 handleExport 中加入写回**

在 `src/components/Export/ExportDialog.tsx` 的 `handleExport`,`setIsExporting(true);` 之后、`const cells = buildCells();` 一带的 try 块开头加入写回(放在 `saveWatermarkSettings(watermark);` 旁):

```ts
    setIsExporting(true);
    try {
      const cells = buildCells();
      saveWatermarkSettings(watermark);

      // Write the typed title back to project info when the project had none,
      // so it persists with the .pindou file (setProjectInfo marks dirty).
      const t = titleInput.trim();
      if (!hadProjectTitle && t) {
        setProjectInfo({ ...(projectInfo ?? {}), title: t });
      }

      const results: string[] = [];
```

(此处已越过图纸保存对话框的取消守卫;仅当用户确实开始导出时才写回。)

- [ ] **Step 4: 运行测试,确认通过**

Run(从 `platforms/vscode/`): `npm run test:webview -- export`
Expected: 两个写回测试均 PASS,其余导出用例不回归。

- [ ] **Step 5: 跑完整 webview 套件,确认无回归**

Run(从 `platforms/vscode/`): `npm run test:webview`
Expected: 全部 PASS(CLAUDE.md 要求发布前必跑此套件)。

- [ ] **Step 6: 提交**

```bash
git add src/components/Export/ExportDialog.tsx platforms/vscode/tests/export.spec.ts
git commit -m "feat(export): write typed blueprint title back to projectInfo on export"
```

---

## 验收

- 设了项目标题:导出对话框标题框只读显示该标题、提示"来自项目设置";导出 header 显示 `PindouVerse - <标题> - <作者>`。
- 未设项目标题:标题框可编辑;填写后导出,标题写入 `projectInfo.title` 并随项目保存落盘;`isDirty` 被置位。
- `ProjectInfo.description` 不受影响;`ExportWatermarkSettings.appDescription` 已删除。
- `npm run test:webview` 全绿;核心单测 `blueprintDecorations.test.ts` 全绿。
