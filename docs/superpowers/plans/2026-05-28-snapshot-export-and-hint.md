# Snapshot Export + Local-Only Hint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make snapshot local-only constraint visible in the 版本管理 dialog, and let users export any snapshot to a chosen `.pindou` path without disrupting the active editor.

**Architecture:** Add a new `writeProjectFile(path, project)` method to `PlatformAdapter` that always writes silently (no editor switch in VS Code). Wire it into a 「另存为」button in each snapshot row of the existing 版本管理 dialog. Add a one-line info pill at the top of the dialog plus an (i) tooltip showing the autosave directory path.

**Tech Stack:** TypeScript, React, Zustand, Tailwind CSS, Playwright (webview tests), VS Code Custom Editor API.

**Spec:** [docs/superpowers/specs/2026-05-28-snapshot-export-and-hint-design.md](../specs/2026-05-28-snapshot-export-and-hint-design.md)

---

## File Structure

**New files:**
- `platforms/vscode/tests/snapshot-export.spec.ts` — Playwright tests for the export flow and silent-write contract.

**Modified files:**
- `src/adapters/index.ts` — add `writeProjectFile` to `PlatformAdapter` interface.
- `src/adapters/tauri.ts` — implement `writeProjectFile` (mirrors `saveProject`).
- `src/adapters/browser.ts` — implement `writeProjectFile` (mirrors `saveProject`).
- `platforms/vscode/src/vscodeAdapter.ts` — implement `writeProjectFile` (raw `writeFile`, no `saveAs`).
- `src/App.tsx` — snapshot dialog JSX: add info pill + (i) tooltip + 另存为 button + state for resolved autosave dir.
- `platforms/vscode/CHANGELOG.md` — note the feature.
- `platforms/vscode/package.json` — bump to 0.9.5.

---

## Task 1: Add `writeProjectFile` to `PlatformAdapter` interface

**Files:**
- Modify: `src/adapters/index.ts:128-130`

- [ ] **Step 1: Edit the interface**

Add a new method declaration immediately after `saveProject`/`loadProject` in the `// Project I/O` block.

```typescript
  // Project I/O
  saveProject(path: string, project: ProjectFile): Promise<void>;
  loadProject(path: string): Promise<ProjectFile>;
  /**
   * Write a ProjectFile to `path` without any editor side effects.
   * Distinct from saveProject: in VS Code, saveProject routes through
   * saveAs (which disposes the current panel and opens the new file as
   * the active editor). writeProjectFile is for "export-only" flows
   * (snapshot export, backups) where the caller must NOT lose its
   * current editing context.
   */
  writeProjectFile(path: string, project: ProjectFile): Promise<void>;
```

- [ ] **Step 2: Verify TypeScript reports the three missing implementations**

Run from the repo root:

```bash
cd platforms/vscode && npx tsc -p tsconfig.json --noEmit 2>&1 | head -20
```

Expected: three "Property 'writeProjectFile' is missing in type" errors for `TauriAdapter`, `BrowserAdapter`, and `VScodeAdapter`. This confirms all three implementations need updating — they will be added in Tasks 2-4.

- [ ] **Step 3: Do NOT commit yet**

Interface and all three implementations land in a single commit at the end of Task 4 to keep the build green at every commit.

---

## Task 2: Implement `writeProjectFile` in the Tauri adapter

**Files:**
- Modify: `src/adapters/tauri.ts:17-19`

- [ ] **Step 1: Add the method after `saveProject`**

```typescript
  async saveProject(path: string, project: ProjectFile): Promise<void> {
    await invoke("save_project", { path, project });
  }

  async writeProjectFile(path: string, project: ProjectFile): Promise<void> {
    // Tauri has no editor concept — saveProject already does a plain disk
    // write via the save_project IPC command. Reuse it.
    await invoke("save_project", { path, project });
  }
```

- [ ] **Step 2: Do NOT commit yet** (see Task 1, Step 3)

---

## Task 3: Implement `writeProjectFile` in the browser adapter

**Files:**
- Modify: `src/adapters/browser.ts:213-215`

- [ ] **Step 1: Add the method after `saveProject`**

```typescript
  async saveProject(path: string, project: ProjectFile): Promise<void> {
    await idbPut(STORE_PROJECTS, path, project);
  }

  async writeProjectFile(path: string, project: ProjectFile): Promise<void> {
    // Browser has no editor concept — store the file under the chosen
    // IndexedDB key, same as saveProject.
    await idbPut(STORE_PROJECTS, path, project);
  }
```

- [ ] **Step 2: Do NOT commit yet** (see Task 1, Step 3)

---

## Task 4: Implement `writeProjectFile` in the VS Code adapter

**Files:**
- Modify: `platforms/vscode/src/vscodeAdapter.ts:225-246`

- [ ] **Step 1: Add the method right after `saveProject`**

Place this immediately after the closing `}` of `saveProject`, before `loadProject` at line 248:

```typescript
  async writeProjectFile(path: string, project: ProjectFile): Promise<void> {
    // EXPORT-ONLY write: never route through saveAs/openWith. The caller
    // (e.g. snapshot 另存为) wants the file on disk without disturbing
    // the currently open editor. Always use raw writeFile.
    const content = JSON.stringify(project, null, 2);
    const data = btoa(unescape(encodeURIComponent(content)));
    await sendRequest("writeFile", { path, data });
  }
```

- [ ] **Step 2: Build the extension and confirm zero TS errors**

```bash
cd platforms/vscode && npm run build 2>&1 | tail -15
```

Expected: clean build, no TypeScript errors, both `dist/extension.js` and `dist/webview/assets/index.js` produced.

- [ ] **Step 3: Run the full webview test suite to confirm no regressions**

```bash
cd platforms/vscode && npx playwright test 2>&1 | tail -5
```

Expected: `58 passed`.

- [ ] **Step 4: Commit the adapter interface + all three implementations**

```bash
git add src/adapters/index.ts src/adapters/tauri.ts src/adapters/browser.ts platforms/vscode/src/vscodeAdapter.ts
git commit -m "feat(adapters): add writeProjectFile for silent export writes

Distinct from saveProject because VS Code's saveProject routes through
saveAs → vscode.openWith → disposes the active panel. writeProjectFile
is the export-only contract: write the file to disk and return, never
touch the editor. Tauri/browser implementations reuse their existing
disk/IndexedDB write paths."
```

---

## Task 5: Write the failing export-success test

**Files:**
- Create: `platforms/vscode/tests/snapshot-export.spec.ts`

- [ ] **Step 1: Create the new spec file**

```typescript
import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  callAction,
  setStoreState,
  stageReply,
  clearMessages,
  getMessages,
  getWrites,
} from "./helpers";

test.describe("Snapshot export (另存为)", () => {
  test.afterAll(() => cleanupHarness());

  test("clicking 另存为 writes the snapshot project via writeFile, not saveAs", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Seed the store with one synthetic snapshot. The mock harness intercepts
    // adapter.loadSnapshot via the generic ack reply path — but loadSnapshot
    // isn't stubbed in helpers.ts, so we instead stub via stageReply on
    // readFile (the adapter loads snapshots through readFile).
    const fakeProject = {
      version: 2,
      canvasSize: { width: 4, height: 4 },
      canvasData: [
        [{ colorIndex: 1 }, { colorIndex: null }, { colorIndex: null }, { colorIndex: null }],
        [{ colorIndex: null }, { colorIndex: null }, { colorIndex: null }, { colorIndex: null }],
        [{ colorIndex: null }, { colorIndex: null }, { colorIndex: null }, { colorIndex: null }],
        [{ colorIndex: null }, { colorIndex: null }, { colorIndex: null }, { colorIndex: null }],
      ],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const base64 = Buffer.from(JSON.stringify(fakeProject), "utf-8").toString("base64");
    await stageReply(page, "readFile", { data: base64 });

    // Inject a snapshot row into the store so the 版本管理 dialog renders it.
    await setStoreState(page, {
      snapshots: [
        { path: "/fake/.pindou_autosave/snapshot_123_test.pindou", name: "测试快照", modified: "2026-05-28 12:00" },
      ],
    });

    // Open the 版本管理 dialog. The toolbar button is labeled "版本".
    await page.getByRole("button", { name: /^版本$/ }).click();
    await page.getByRole("heading", { name: "版本管理" }).waitFor({ state: "visible" });

    // Stage the showSaveDialog reply (where the user picks the target path).
    const target = "/exported/my-snapshot.pindou";
    await stageReply(page, "showSaveDialog", target);

    await clearMessages(page);

    // Click the 另存为 button in the snapshot row.
    await page.getByRole("button", { name: /^另存为$/ }).click();

    // Wait for the writeFile to land.
    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "writeFile"),
      null,
      { timeout: 5_000 }
    );

    const messages = await getMessages(page);
    const writeFileMsg = messages.find((m: any) => m.type === "writeFile" && m.path === target);
    const saveAsMsg = messages.find((m: any) => m.type === "saveAs");

    // CRITICAL: export must use writeFile, never saveAs (which would
    // dispose the current panel and swap to the exported file).
    expect(writeFileMsg).toBeTruthy();
    expect(saveAsMsg).toBeFalsy();

    // Verify the exported file content is the snapshot's ProjectFile.
    const writes = await getWrites(page);
    const exportedWrite = writes.find((w: any) => w.kind === "writeFile" && w.path === target);
    expect(exportedWrite).toBeTruthy();
    const decoded = decodeURIComponent(
      escape(Buffer.from(exportedWrite.data, "base64").toString("binary"))
    );
    const exportedProject = JSON.parse(decoded);
    expect(exportedProject.canvasSize).toEqual({ width: 4, height: 4 });
    expect(exportedProject.canvasData[0][0].colorIndex).toBe(1);

    // Dismiss the success modal so the dialog stays clean for any later steps.
    const modal = page.locator("div.fixed.inset-0").filter({ hasText: /确定/ }).last();
    await modal.waitFor({ state: "visible" });
    await modal.getByRole("button", { name: /^确定$/ }).click();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd platforms/vscode && npx playwright test tests/snapshot-export.spec.ts 2>&1 | tail -20
```

Expected: FAIL. The 另存为 button does not exist in the dialog yet, so `page.getByRole("button", { name: /^另存为$/ }).click()` will time out. This proves the test is real before we implement.

- [ ] **Step 3: Do NOT commit yet**

The test commits together with the implementation in Task 8.

---

## Task 6: Add the cancel-path test

**Files:**
- Modify: `platforms/vscode/tests/snapshot-export.spec.ts` (append a second test)

- [ ] **Step 1: Append a second test inside the existing `describe` block**

Add this test directly above the closing `});` of the describe block:

```typescript
  test("cancel showSaveDialog → no writeFile, no editor change", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const fakeProject = {
      version: 2,
      canvasSize: { width: 2, height: 2 },
      canvasData: [
        [{ colorIndex: 3 }, { colorIndex: null }],
        [{ colorIndex: null }, { colorIndex: null }],
      ],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const base64 = Buffer.from(JSON.stringify(fakeProject), "utf-8").toString("base64");
    await stageReply(page, "readFile", { data: base64 });

    await setStoreState(page, {
      snapshots: [
        { path: "/fake/.pindou_autosave/snapshot_999_x.pindou", name: "X", modified: "2026-05-28 12:00" },
      ],
    });

    await page.getByRole("button", { name: /^版本$/ }).click();
    await page.getByRole("heading", { name: "版本管理" }).waitFor({ state: "visible" });

    // User cancels the save dialog.
    await stageReply(page, "showSaveDialog", null);

    await clearMessages(page);
    await page.getByRole("button", { name: /^另存为$/ }).click();

    // Wait a brief moment to let any erroneous writes fire.
    await page.waitForTimeout(300);

    const writes = await getWrites(page);
    expect(writes.find((w: any) => w.kind === "writeFile")).toBeFalsy();

    const messages = await getMessages(page);
    expect(messages.find((m: any) => m.type === "saveAs")).toBeFalsy();
  });
```

- [ ] **Step 2: Run both tests and watch them fail**

```bash
cd platforms/vscode && npx playwright test tests/snapshot-export.spec.ts 2>&1 | tail -20
```

Expected: both tests FAIL on the same `Locator.click: Timeout` error for the missing 另存为 button.

- [ ] **Step 3: Do NOT commit yet** (lands with implementation in Task 8)

---

## Task 7: Add the hint-visibility test

**Files:**
- Modify: `platforms/vscode/tests/snapshot-export.spec.ts` (append a third test)

- [ ] **Step 1: Append a third test inside the existing `describe` block**

```typescript
  test("local-only hint is visible when 版本管理 dialog opens", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await page.getByRole("button", { name: /^版本$/ }).click();
    await page.getByRole("heading", { name: "版本管理" }).waitFor({ state: "visible" });

    // The persistent info pill must be visible.
    await expect(
      page.getByText("快照保存在本地应用数据目录，换设备或重装应用会丢失")
    ).toBeVisible();
  });
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd platforms/vscode && npx playwright test tests/snapshot-export.spec.ts -g "local-only hint" 2>&1 | tail -10
```

Expected: FAIL with `expect(locator).toBeVisible()` timeout — the hint text doesn't exist yet.

- [ ] **Step 3: Do NOT commit yet** (lands with implementation in Task 8)

---

## Task 8: Add the hint UI + 另存为 button to the 版本管理 dialog

**Files:**
- Modify: `src/App.tsx` — three locations:
  - Imports / hooks: add `useEffect`-based fetch of autosave dir.
  - Local state declaration near line 115.
  - JSX inside the 版本管理 dialog (lines 1082–1176).

- [ ] **Step 1: Add an `autosaveDir` state and an effect to fetch it**

In `src/App.tsx`, locate the existing snapshot state at line 115:

```typescript
  const [snapshotLabel, setSnapshotLabel] = useState("");
```

Insert a new state line directly after it:

```typescript
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [autosaveDir, setAutosaveDir] = useState<string>("");
```

Then, locate the existing `useEffect` for auto-save at lines 236-240 (the block that ends with `}, [autoSaveEnabled]);`). Add a NEW `useEffect` right after that block to fetch the autosave directory whenever the snapshot dialog opens:

```typescript
  // Resolve the autosave directory path lazily, so the (i) tooltip in the
  // snapshot dialog can show the actual on-disk location.
  useEffect(() => {
    if (!showSnapshots) return;
    if (autosaveDir) return;
    let cancelled = false;
    getAdapter()
      .getAutosaveDir()
      .then((dir) => {
        if (!cancelled) setAutosaveDir(dir || "");
      })
      .catch(() => {
        if (!cancelled) setAutosaveDir("");
      });
    return () => {
      cancelled = true;
    };
  }, [showSnapshots, autosaveDir]);
```

- [ ] **Step 2: Insert the info pill + (i) tooltip in the dialog body**

Locate the 版本管理 dialog JSX. The existing structure (around line 1094) is:

```tsx
            <div className="p-4 flex flex-col gap-3 overflow-y-auto">
              {/* Create snapshot */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={snapshotLabel}
                  ...
```

Replace it with this expanded version that adds the persistent notice and changes the create row to include the (i) tooltip:

```tsx
            <div className="p-4 flex flex-col gap-3 overflow-y-auto">
              {/* Local-only notice (persistent, info-pill style) */}
              <div className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1">
                📍 快照保存在本地应用数据目录，换设备或重装应用会丢失
              </div>

              {/* Create snapshot */}
              <div className="flex gap-2 items-center">
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
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 text-gray-500 text-[10px] cursor-help select-none"
                  title={
                    autosaveDir
                      ? `保存位置：${autosaveDir}\n如需长期保存请用列表中的「另存为」`
                      : "快照保存在本机的应用数据目录。如需长期保存请用列表中的「另存为」"
                  }
                  aria-label="快照存储位置说明"
                >
                  i
                </span>
              </div>
```

(Keep everything that comes after this block — `{/* Snapshot list */}` and below — untouched in this step.)

- [ ] **Step 3: Add the 另存为 button to each snapshot row**

Locate the snapshot-row buttons at lines 1145-1168. The current structure is:

```tsx
                      <button onClick={async () => { ... 对比 ... }}> 对比 </button>
                      <button onClick={async () => { ... 恢复 ... }}> 恢复 </button>
                      <button onClick={async () => { ... 删除 ... }}> 🗑 </button>
```

Insert a new 另存为 button between 恢复 and 🗑. Place it as a sibling within the same row container. Find the existing 恢复 button (it has the class `bg-green-500 text-white rounded hover:bg-green-600 shrink-0`) and insert this directly AFTER its closing `</button>`:

```tsx
                      <button
                        onClick={async () => {
                          try {
                            const project = await getAdapter().loadSnapshot(s.path);
                            const suggested = `${s.name.replace(/[\\/:*?"<>|]/g, "_")}.pindou`;
                            const target = await getAdapter().showSaveDialog(
                              [{ name: "PinDou Project", extensions: ["pindou"] }],
                              suggested,
                            );
                            if (!target) return;
                            await getAdapter().writeProjectFile(target, project);
                            await appAlert(`已导出到: ${target}`, { title: "导出成功" });
                          } catch (e) {
                            await appAlert(
                              `导出失败: ${e instanceof Error ? e.message : String(e)}`,
                              { title: "导出失败" },
                            );
                          }
                        }}
                        className="px-2 py-1 border border-blue-300 text-blue-600 rounded hover:bg-blue-50 shrink-0"
                        title="导出为独立 .pindou 文件"
                      >
                        另存为
                      </button>
```

- [ ] **Step 4: Build the webview**

```bash
cd platforms/vscode && npm run build:webview 2>&1 | tail -8
```

Expected: clean build, no errors.

- [ ] **Step 5: Run only the new spec to confirm it passes now**

```bash
cd platforms/vscode && npx playwright test tests/snapshot-export.spec.ts 2>&1 | tail -10
```

Expected: `3 passed` (the three tests from Tasks 5-7).

- [ ] **Step 6: Run the full webview test suite to confirm no regressions**

```bash
cd platforms/vscode && npx playwright test 2>&1 | tail -5
```

Expected: `61 passed` (58 existing + 3 new).

- [ ] **Step 7: Commit the UI + tests together**

```bash
git add src/App.tsx platforms/vscode/tests/snapshot-export.spec.ts
git commit -m "feat: snapshot 另存为 export + local-only hint in 版本管理

- Top info pill: '快照保存在本地应用数据目录，换设备或重装应用会丢失'
- (i) tooltip next to 创建快照 shows the resolved autosave directory
- 另存为 button per snapshot row uses adapter.writeProjectFile (silent
  write, never saveAs → never disposes the active panel)
- Playwright coverage: success path, cancel path, hint visibility"
```

---

## Task 9: Update CHANGELOG and bump VS Code extension version

**Files:**
- Modify: `platforms/vscode/CHANGELOG.md`
- Modify: `platforms/vscode/package.json`

- [ ] **Step 1: Bump the version**

In `platforms/vscode/package.json`, change:

```json
  "version": "0.9.4",
```

to:

```json
  "version": "0.9.5",
```

- [ ] **Step 2: Prepend the 0.9.5 entry in the changelog**

Open `platforms/vscode/CHANGELOG.md` and prepend a new section right after the `# Changelog` heading, before `## 0.9.4`:

```markdown
## 0.9.5

- Feature: 「版本管理」对话框新增提示：快照只保存在本地应用数据目录，换设备或重装应用会丢失。同时显示一个 (i) 图标，hover 可查看实际存储路径。
- Feature: 每条快照新增「另存为」按钮，可把任意快照导出为独立 `.pindou` 文件到用户选择的位置。VS Code 下走静默 `writeFile`，不会切换当前编辑器（区别于 `saveProject` 的 `saveAs` 行为）。
- Internal: 新增 `PlatformAdapter.writeProjectFile(path, project)` 接口，作为「只写文件、不动编辑器」的导出语义；与 `saveProject` 区分开。
```

- [ ] **Step 3: Package the vsix**

```bash
cd platforms/vscode && npm run package 2>&1 | tail -5
```

Expected: `Packaged: Q:\repo\pindou\platforms\vscode\pindouverse-0.9.5.vsix`.

- [ ] **Step 4: Commit the version bump + changelog**

```bash
git add platforms/vscode/CHANGELOG.md platforms/vscode/package.json
git commit -m "vscode: release 0.9.5 — snapshot 另存为 + local-only hint"
```

---

## Task 10: Finalize on main via squash-merge

**Files:** none (git operations only)

- [ ] **Step 1: Verify all commits on the feature branch**

```bash
git log --oneline main..HEAD
```

Expected: three commits:
1. `feat(adapters): add writeProjectFile for silent export writes`
2. `feat: snapshot 另存为 export + local-only hint in 版本管理`
3. `vscode: release 0.9.5 — snapshot 另存为 + local-only hint`

- [ ] **Step 2: Switch to main and squash-merge**

Per [CLAUDE.md](../../../CLAUDE.md) workflow:

```bash
git checkout main
git merge --squash feature/snapshot-export-and-hint
```

Then commit the squashed change:

```bash
git commit -m "feat: snapshot 另存为 export + local-only hint

Adds a per-snapshot 另存为 button in 版本管理 that exports any snapshot
to a user-chosen .pindou path. Adds a persistent info pill and an (i)
tooltip explaining that snapshots are stored locally in the app data
directory and would be lost on device change / reinstall.

Introduces a new PlatformAdapter.writeProjectFile method whose contract
is 'write to disk, do not touch the editor'. Distinct from saveProject
because VS Code's saveProject routes through saveAs → vscode.openWith,
which disposes the current panel — wrong for export-only flows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Delete the feature branch**

```bash
git branch -D feature/snapshot-export-and-hint
```

- [ ] **Step 4: Confirm the vsix is present for install**

```bash
ls -la platforms/vscode/pindouverse-0.9.5.vsix
```

Expected: file exists, ~243 KB.

---

## Self-Review

**Spec coverage:**
- Spec §1 (top notice + (i) hover) → Task 8 Steps 1-2.
- Spec §2 (另存为 button + cancel/success flow) → Task 8 Step 3, tested in Tasks 5-6.
- Spec §3 (new `writeProjectFile` adapter method, all three implementations) → Tasks 1-4.
- Spec Testing (3 Playwright tests) → Tasks 5-7.
- Spec Backwards compatibility (typed adapter change) → enforced by Task 1 Step 2's TS error check.

**Placeholder scan:** no TBD / TODO / "implement later" / vague error-handling instructions. Every code block is final.

**Type consistency:** the new method `writeProjectFile(path: string, project: ProjectFile): Promise<void>` uses identical signature across `index.ts`, `tauri.ts`, `browser.ts`, `vscodeAdapter.ts`. Same name in the consumer call site (Task 8 Step 3).

**Risk areas:**
- The test in Task 5 stubs `readFile` to feed the synthetic snapshot through `adapter.loadSnapshot`. If `vscodeAdapter.loadSnapshot` ever changes its message protocol (currently calls `readFile` via `sendRequest`), the test needs an update. This is intentional — the test exercises the real adapter wiring rather than mocking the adapter directly.
- The CHANGELOG / version bump must come AFTER the feature commit, not before, so a half-built feature can't ship under the new version number.
