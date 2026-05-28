# Snapshot Export + Local-Only Hint

**Date**: 2026-05-28
**Status**: Approved, ready for plan
**Scope**: VS Code extension + cross-platform store/adapter changes

## Problem

Two related user gaps in the existing snapshot ("版本管理") feature:

1. **No indication that snapshots are local-only.** Snapshots live in the autosave directory (`%APPDATA%/.../.pindou_autosave/` on Windows, similar on macOS/Linux). They are not synced or persisted with the project file. Users can lose them silently by switching machines or reinstalling the extension. The UI gives no warning.
2. **No way to extract a snapshot as a standalone file.** Users who want to keep a snapshot long-term must manually copy files out of the autosave directory. There's no in-app export.

## Goals

- Make the local-only constraint visible in the snapshot dialog so users don't accidentally rely on snapshots as primary persistence.
- Let users export any snapshot to a `.pindou` file at a user-chosen location, **without disrupting the currently open editor**.

## Non-Goals

- Cloud sync of snapshots.
- Bulk export (export-all). Single snapshot at a time is enough.
- Changing the snapshot creation/storage location.

## Design

### 1. Hint UI in 版本管理 dialog

Two complementary surfaces, both in [App.tsx:1082](../../../src/App.tsx#L1082):

**A. Top persistent notice** (below dialog title bar, above 创建快照 row)
- Small gray text, one line: `📍 快照保存在本地应用数据目录，换设备或重装应用会丢失`
- Styled as a muted info pill: `text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1` (matches existing dialog muted text patterns).

**B. (i) hover affordance** (next to 创建快照 button)
- Inline icon button (`title=""` native tooltip is fine — minimal scope).
- Tooltip shows the resolved autosave directory path so a user can locate the files manually.
- Path is fetched once on dialog open via `adapter.getAutosaveDir()` and cached in component state. If the call fails or returns empty, the icon still renders but the tooltip falls back to: `快照保存在本机的应用数据目录。如需长期保存请用列表中的「另存为」`.

### 2. 「另存为」 button per snapshot row

- Inserted between **恢复** and **🗑** in each row.
- Text button, same height/style as the others.
- Click handler:
  1. `const project = await getAdapter().loadSnapshot(s.path)`
  2. `const target = await adapter.showSaveDialog([{name: "PinDou Project", extensions: ["pindou"]}], suggestedName)` where `suggestedName` = `${s.name.replace(/[\\/:*?"<>|]/g, "_")}.pindou` (strip filesystem-illegal characters; the snapshot label is otherwise preserved).
  3. If user cancels, no-op.
  4. `await adapter.writeProjectFile(target, project)` — **silent write**, no editor switch.
  5. On success: `appAlert("已导出到: <target>", { title: "导出成功" })`. The path is shown verbatim; long paths wrap inside the modal (existing AppDialog renders `whitespace-pre-wrap`). On failure: `appAlert("导出失败: <error.message>", { title: "导出失败" })`.

### 3. New adapter method `writeProjectFile(path, project)`

Added to the `PlatformAdapter` interface in [src/adapters/index.ts](../../../src/adapters/index.ts). Distinct from `saveProject` because:

- `saveProject(path, ...)` is intended for the editor's own "save to current document" / "save as a new editing target" flow. In the VS Code adapter that path triggers `saveAs` → `vscode.openWith` → disposes current panel. That side-effect is **wrong** for an export-only action (would discard the user's in-progress work).
- `writeProjectFile(path, project)` always writes the file and returns; no editor mutation, no panel swap.

Implementations:
- **Tauri** ([src/adapters/tauri.ts](../../../src/adapters/tauri.ts)): same as `saveProject` — `invoke("save_project", { path, project })`. No editor concept exists.
- **Browser** ([src/adapters/browser.ts](../../../src/adapters/browser.ts)): same as `saveProject` — `idbPut(STORE_PROJECTS, path, project)`. No editor concept.
- **VS Code** ([platforms/vscode/src/vscodeAdapter.ts](../../../platforms/vscode/src/vscodeAdapter.ts)): serialize the project, base64-encode, send `writeFile` message to host. **Never** routes to `saveAs`.

## Testing

Playwright tests in [platforms/vscode/tests/](../../../platforms/vscode/tests/):

1. **`snapshot-export.spec.ts` — happy path**
   - Stage a snapshot in store, open 版本管理, click 另存为, stage a `showSaveDialog` reply with a target path, assert: (a) `writeFile` was posted with the chosen path, (b) the payload decodes to JSON containing the snapshot's `canvasData`, (c) `saveAs` was NOT posted (no editor switch).

2. **`snapshot-export.spec.ts` — cancel path**
   - Stage `showSaveDialog` reply of `null`. Click 另存为. Assert no `writeFile` posted.

3. **Hint visibility regression**
   - 版本管理 dialog opens, the local-only notice text is visible. Skipped if it complicates other suites; the hint is a one-line static element with little regression risk.

Existing 58 webview tests must continue to pass.

## Backwards compatibility

- Adding a method to `PlatformAdapter` is a typed change. All three platform implementations must update (Tauri, browser, VS Code) — the build catches it.
- No file-format change. Exported `.pindou` is exactly the same format as a normal saved project — snapshots already use `ProjectFile`.

## Open questions

None — answered during brainstorming:
- Hint location: top notice + (i) icon (both).
- Export button style: text button labeled 「另存为」.

## Out of scope for this change

- A history/comparison of exports (which snapshots have been exported, when).
- Auto-cleanup of old snapshots from the autosave directory.
