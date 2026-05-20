# Snapshot Compare & Delete — Design

**Date**: 2026-05-18
**Status**: Draft, awaiting user review
**Scope**: Extend the snapshot version-management dialog with two new actions per snapshot row: **对比** (compare current canvas against the snapshot) and **删除** (remove the snapshot from storage).

---

## Goal

Make snapshots a more practical version-control tool. Today users can only restore a snapshot — they cannot see what changed since, and they cannot prune obsolete snapshots.

## Decisions (already agreed with user)

1. **Compare**: reuse the existing `ChangesCompareDialog` (side-by-side preview with synced zoom/pan + added/removed/modified stats). The component is generalized to accept the baseline as a prop so it can serve both its current "changes since save" use and the new "diff against snapshot" use.
2. **Delete**: removes the snapshot from the snapshot store (the standalone `.pindou` files on Tauri / IndexedDB records in browser) — not from any in-project storage. The project file is untouched.
3. **Delete confirmation**: native `confirm()` prompt before the delete fires.
4. **Canvas-size mismatch**: when the snapshot's canvas size differs from the current canvas, the compare dialog still works — it aligns both views to `max(W, H)`, treats out-of-bounds cells as empty, and shows a small inline note in the header about the size change.

## Component Changes

### `ChangesCompareDialog` generalization

Today the dialog reads `baselineCanvasData` + `canvasSize` directly from the store. Generalize it to accept the baseline as an optional set of props; the store-read path becomes the default fallback for backwards compatibility.

```ts
interface Props {
  onClose: () => void;
  // Optional override. When provided, dialog compares current vs this data.
  // When omitted, falls back to store.baselineCanvasData (existing behavior).
  baselineData?: CanvasData;
  baselineSize?: CanvasSize;
  baselineLabel?: string;  // default: "基准版本"
  currentLabel?: string;   // default: "当前版本"
  title?: string;          // default: "变更对比"
}
```

Existing call site in `src/App.tsx` continues to work without changes (props are optional, defaults preserve current behavior).

### Canvas-size mismatch handling

The dialog already takes one `canvasSize` for both views. Change so it accepts a baseline size separately and aligns both views to the union:

```ts
const viewW = Math.max(currentSize.width, baselineSize.width);
const viewH = Math.max(currentSize.height, baselineSize.height);
```

`renderView` is unchanged — it already iterates by grid bounds and skips empty cells. We just feed it the union W/H so both views render against the same axes.

Stats loop walks `viewW × viewH`; cells outside one of the two sources are treated as `null`. So a smaller-grid snapshot vs larger current canvas produces accurate added counts on the perimeter.

A one-line note appears in the dialog header when sizes differ:
> `尺寸 64×72 → 80×100`

## Adapter Interface

Add `deleteSnapshot` to `PlatformAdapter`:

```ts
deleteSnapshot(path: string): Promise<void>;
```

### Tauri implementation

New `delete_snapshot` command in `src-tauri/src/commands/project.rs`:

```rust
#[tauri::command]
pub fn delete_snapshot(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("Delete failed: {}", e))
}
```

Registered in `src-tauri/src/lib.rs` alongside the other snapshot commands. The path is the absolute snapshot file path returned by `list_snapshots`.

### Browser implementation

New `idbDelete(store, key)` helper in `src/adapters/browser.ts`:

```ts
function idbDelete(store: string, key: string): Promise<void> {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
```

`deleteSnapshot(path)` calls `idbDelete(STORE_SNAPSHOTS, path)`.

### VSCode and Mobile adapters

Both throw `"Snapshot delete not yet supported on this platform"`. The snapshot UI is only reachable in contexts where snapshots can be created (currently Tauri + browser); VSCode webview and the mobile platform don't create snapshots so they don't need delete either.

## Store

Add a new action to `editorStore.ts`:

```ts
deleteSnapshot: async (path: string) => {
  const adapter = getAdapter();
  await adapter.deleteSnapshot(path);
  await get().loadSnapshots();
}
```

## UI Changes — `src/App.tsx`

### Snapshot dialog row

Each snapshot row's right side gains a compact button group with three actions: 对比, 恢复, 删除. The button area expands; the dialog width grows from `w-[420px]` to `w-[480px]`.

```
┌─────────────────────────────────────────────────────────┐
│ <name>                            [对比] [恢复] [🗑]    │
│ <modified>                                              │
└─────────────────────────────────────────────────────────┘
```

Visual styling:
- **对比** — outline button, gray border, `text-blue-600`
- **恢复** — existing solid green button, unchanged
- **删除** — outline button, red border, trash icon `🗑` (icon only, no label)

### Click handlers

- **对比**: `loadSnapshot(path)` → store the result in a local component state `compareTarget`, open `ChangesCompareDialog` with snapshot data passed as `baselineData` prop. Closing the compare dialog clears `compareTarget` and returns the user to the snapshot list (the snapshot dialog stays open).
- **恢复**: unchanged.
- **删除**: `if (!confirm(\`确认删除快照「${s.name}」？此操作不可撤销。\`)) return; await deleteSnapshot(s.path);`. Errors caught and displayed via `alert`.

## Testing

### Vitest

- `editorStore.deleteSnapshot` calls the adapter and refreshes the list — covered with a mock adapter.
- `ChangesCompareDialog` stat computation with mismatched canvas sizes: a 4×4 baseline vs 5×5 current with one extra column of filled cells should report `added: 5` (one for each row of the extra column).

### Playwright (VSCode webview)

VSCode adapter throws on `deleteSnapshot`, so the delete button in the VSCode webview should be disabled or hidden. **Design choice**: hide both 对比 and 删除 buttons when the adapter throws. To keep the implementation simple, we render the buttons unconditionally and rely on the adapter to throw with a user-visible error.

Since VSCode currently has no snapshot dialog access (snapshots only work in Tauri / browser per the existing implementation), no new Playwright coverage is added.

### Manual smoke test

1. Tauri: create 3 snapshots → confirm each row has the three buttons.
2. Click 对比 on the oldest snapshot → confirm the diff dialog opens, shows the baseline, and stats are accurate.
3. Edit the canvas, then 对比 again → confirm stats reflect the new diff.
4. Click 删除 on a snapshot → confirm the native confirm prompt appears → confirm the snapshot disappears from the list after OK.
5. Click 删除 → cancel the confirm → snapshot remains.

## Implementation Plan

### New files
- None.

### Modified files
- `src/types/index.ts` — no change (already has `CanvasSize`, `CanvasData`)
- `src/adapters/index.ts` — add `deleteSnapshot` to the `PlatformAdapter` interface
- `src/adapters/browser.ts` — implement `deleteSnapshot` + `idbDelete` helper
- `src/adapters/tauri.ts` — wire `deleteSnapshot` invoke
- `src/adapters/mobile.ts` — throw not-supported
- `platforms/vscode/src/vscodeAdapter.ts` — throw not-supported
- `src/store/editorStore.ts` — add `deleteSnapshot` action
- `src/components/Canvas/ChangesCompareDialog.tsx` — generalize with optional props, handle canvas-size mismatch
- `src/App.tsx` — three-button row in the snapshot dialog, wire compare and delete handlers, widen dialog
- `src-tauri/src/commands/project.rs` — add `delete_snapshot` command
- `src-tauri/src/lib.rs` — register `delete_snapshot`
- Existing Vitest suites for the snapshot store and compare dialog — add the new test cases described above

## Risks / Trade-offs

- **Generalized `ChangesCompareDialog`**: adding optional props vs creating a second component. Chose to generalize because the rendering logic is non-trivial (synced zoom/pan, resize handle) and duplicating it would create a maintenance burden.
- **Canvas-size mismatch**: aligning to the union is the simplest semantically meaningful default. The alternative (refusing to compare different sizes) would be more conservative but less useful.
- **Native `confirm()`** for delete: simple and matches the existing pattern in the app (other destructive ops use `alert` and `confirm`). A custom modal would be more polished but is out of scope.

## Out of Scope

- Bulk-delete (e.g., "delete all snapshots older than 30 days") — single-row delete only.
- Snapshot rename / re-label.
- Storing snapshots inside the `.pindou` project file.
- Per-snapshot thumbnails.
- Snapshot diff highlighting overlaid on the live canvas.
