# .pindou v3 — compact on-disk format

**Status:** approved (2026-06-09)
**Owners:** xiaofeicheng

## Problem

`.pindou` project files are stored as pretty-printed JSON with each cell wrapped in `{ "colorIndex": null | number }`. For a 72×82 canvas with 3 layers that's 17 712 cells × ~25 chars each, dominated by indent/braces/key text — the recently-added `samples/shinzo_wo_sasageyo.pindou` (3 layers, ~95% empty cells) ended up at **1.3 MB / 73 680 lines**. Loading via VS Code's `TextDocument` is slow at that size and the file diff is unreadable.

The goal: shrink the on-disk footprint by 10–20× without:

- Adding any new dependency in any platform (Tauri / VS Code / browser / weapp).
- Changing in-memory representation (so store / render / undo paths are untouched).
- Breaking the ability to open older `.pindou` files written by 1.0.6 and earlier.

## Solution: schema bump to v3

### Disk format

Per cell, replace `{ "colorIndex": X }` with the literal `X` itself (`null` or a number). Combine with `JSON.stringify(project)` (no indent).

```json
{
  "version": 3,
  "canvasSize": { "width": 72, "height": 82 },
  "canvasData": [[null, null, 5, null, /* … */], /* … */],
  "layers": [
    {
      "id": "...",
      "name": "拼豆层",
      "visible": true,
      "opacity": 1,
      "data": [[null, null, 5, /* … */], /* … */]
    }
  ],
  "projectInfo": { /* unchanged */ },
  "gridConfig": { /* unchanged */ },
  "createdAt": "...",
  "updatedAt": "..."
}
```

All non-cell fields (`projectInfo`, `gridConfig`, timestamps, ids, etc.) keep their existing shape — the change is scoped to the two cell-grid fields (`canvasData` + each layer's `data`).

### Compatibility matrix

| File `version` field | Reader behaviour |
| --- | --- |
| `>= 3` | Cells parsed as `number \| null`, normalised to `{ colorIndex }` in memory. |
| `1`, `2`, or missing | Cells parsed as `{ colorIndex }` directly (legacy verbose form). |
| Unknown future (`>= 4`) | Treated as `>= 3`; we log a warning but don't refuse to load — forward-compat is best-effort. |

Writers always emit v3. On the first save of a previously-v2 file, it is silently upgraded — there is no "save as legacy" escape hatch.

### In-memory representation

Unchanged: `CanvasCell = { colorIndex: number | null }`, `CanvasData = CanvasCell[][]`. Zustand store, renderer, history stack, import/export pipelines, gist sync, snapshots — none of them know the disk format changed.

## Module layout

### New: `src/utils/projectSerialization.ts`

Pure functions, fully unit-testable, used by every adapter:

```ts
/** Parse raw JSON text and produce an in-memory ProjectFile. Detects format
 *  version and normalises cells to { colorIndex } regardless of source. */
export function normalizeProjectFromDisk(rawJson: string): ProjectFile;

/** Serialize an in-memory ProjectFile as compact v3 JSON (no indent). */
export function serializeProjectToV3(project: ProjectFile): string;
```

Internals:

- `expandRowV3(row: (number | null)[]): CanvasCell[]` — fast `map`.
- `collapseRowToV3(row: CanvasCell[]): (number | null)[]` — fast `map`.
- `isFlatCellRow(row: unknown): row is (number | null)[]` — type guard used in normalisation.

### Modified callers (TS)

All point at the new helpers; their existing JSON.parse / JSON.stringify calls go away.

- `src/adapters/tauri.ts` — `loadProject` already routes through Rust; only `saveProject` calls `JSON.stringify`. Update to use `serializeProjectToV3`.
- `src/adapters/browser.ts` — both `loadProject` and `saveProject`.
- `platforms/vscode/src/vscodeAdapter.ts` — `loadProject` and `saveProject`. Note: the autosave path (`writeProjectFile` writing into `.pindou_autosave/`) also serialises; use the same helper.
- `platforms/vscode/webview/main.tsx` — the `loadDocument` handler currently does `JSON.parse(content)` inline; route through `normalizeProjectFromDisk`.
- `src/store/editorStore.ts` — `loadCanvasData(...)` and `loadProjectLayers(...)` currently accept the in-memory shape, so they're unaffected. The store does NOT parse JSON itself.

### Modified Rust

`src-tauri/src/commands/project.rs`:

- `ProjectFile` struct's cell-grid fields (`canvas_data` + `layers[i].data`) become a custom-deserialized type that accepts either form:
  - Use a serde `untagged` enum `CellSerdeRepr { Object { color_index: Option<i32> }, Flat(Option<i32>) }` deserialized into the same in-memory `CanvasCell { color_index: Option<i32> }`.
- `save_project` always writes v3:
  - Bump `version: u32 = 3` on serialisation.
  - Pre-walk the grids and replace each cell with the flat repr via a wrapper struct that serializes the flat form.
  - Use `serde_json::to_string` (no `_pretty`).
- `load_project` is unchanged at the call site — serde's untagged enum handles both shapes transparently.

The change is type-only inside serde; the rest of the Rust pipeline operates on in-memory `CanvasCell` as before.

## Data flow

```
[disk: .pindou]
   │
   ▼
normalizeProjectFromDisk(raw)  ── detects version, expands flat → {colorIndex}
   │
   ▼
ProjectFile (in memory, same shape as today)
   │
   ▼ (user edits, store actions, …)
   │
   ▼
serializeProjectToV3(project)  ── collapses {colorIndex} → flat, no indent
   │
   ▼
[disk: .pindou (always v3)]
```

## Testing

### Pure-function unit tests (`src/utils/projectSerialization.test.ts`)

- Round-trip a v3 file (`compact → expand → collapse → compact`) is byte-identical.
- v2 input → expand → re-collapse produces compact v3 with same logical content.
- v1 input (`version: 1` or absent) → same as v2 (treated as verbose).
- A row mixing `null` and integers parses correctly.
- Unknown `version` field (e.g. `99`) → parses as v3 (most permissive), no throw.
- Malformed cells (string in place of number, missing row) → throws with a useful message.
- Pretty-printed v3 input (whitespace, manual edit) → still parses.

### Cross-format size regression (`tests/core/projectSerializationSize.test.ts`)

- Load `samples/shinzo_wo_sasageyo.pindou` (currently v2, 1.3 MB) via `normalizeProjectFromDisk`.
- Serialise via `serializeProjectToV3`.
- Assert resulting string length is at most 250 KB (room for variance from project growth without flapping the test).

### VS Code webview integration (`platforms/vscode/tests/file-format-v3.spec.ts`)

- Inject a v2 project into the webview via the harness; verify in-memory canvas is correct.
- Trigger Save (via store action); intercept the saved bytes; assert they parse back to a v3 project with the same logical data.

### Rust round-trip (`src-tauri/src/commands/project_v3_test.rs`)

- Construct a sample `ProjectFile`, serialise via `save_project`, read back via `load_project`, deep-equal.
- Hand-craft a v2 JSON string, run through `load_project`, assert in-memory result matches a v3 round-trip.

## Failure modes

- **Old reader, new file:** Users who didn't upgrade open a v3 file from someone who did. The reader will see `version: 3` and try to parse cells as `{colorIndex}`, fail at the first flat cell, and surface a generic JSON parse error. This is an acceptable migration cost — the change ships behind a single extension version bump (1.0.7).
- **Save mid-stream crash:** Same risk as today (we don't write atomically anywhere). Out of scope.
- **Corrupted file on disk:** Loader throws, caller surfaces "failed to open .pindou file" — unchanged from today.

## Out of scope

- RLE encoding (option C in brainstorm) — wins are marginal beyond v3 for typical files.
- gzip / DEFLATE — adds a Rust dep and binary format complexity; v3 alone is sufficient.
- In-memory representation change — would force a sweeping refactor for no win.
- Versioning of import/export PNG/JSON paths — those formats are different concerns.

## Acceptance

- A v2 `.pindou` file opens, edits, saves to v3, then re-opens as v3 with identical content.
- `samples/shinzo_wo_sasageyo.pindou` (current 1.3 MB) re-saves at < 250 KB.
- All existing tests (root vitest + VS Code webview Playwright + Rust unit) pass.
- VS Code extension bumps to 1.0.7 in the same commit.
