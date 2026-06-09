# .pindou v3 compact format — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump the `.pindou` file format to v3 — cells become bare `null | number` (down from `{colorIndex: …}`) and JSON is no longer indented. Drops on-disk size 10–20× while keeping the in-memory shape, the renderer, the store, and old-file readability all untouched.

**Architecture:** A single pure-TS module (`projectSerialization.ts`) owns the schema translation. Every TS adapter that does `JSON.parse(content)` or `JSON.stringify(project)` for a `.pindou` payload routes through it. The Rust `ProjectFile` struct grows a serde-untagged cell enum that accepts both forms and a custom serializer that always emits flat. Loaders detect by `version` field — `>= 3` is flat, `< 3` (or missing) is verbose. Writers always emit `version: 3`.

**Tech Stack:** TypeScript (browser / VS Code webview / Tauri TS bridge), Rust serde, Vitest (unit + size regression), Playwright (VS Code webview integration).

**Reference spec:** `docs/superpowers/specs/2026-06-09-pindou-file-v3-compact.md`

---

## File map

**New:**
- `src/utils/projectSerialization.ts` — pure helpers (`normalizeProjectFromDisk`, `serializeProjectToV3`).
- `src/utils/projectSerialization.test.ts` — vitest unit specs for the above.
- `tests/core/projectSerializationSize.test.ts` — size regression on a real sample file.
- `platforms/vscode/tests/file-format-v3.spec.ts` — Playwright integration: v2 load → v3 save round-trip via the webview harness.

**Modified (TS):**
- `src/adapters/browser.ts` — `loadProject` + `saveProject`.
- `src/adapters/tauri.ts` — `saveProject` (loadProject already routes through Rust).
- `platforms/vscode/src/vscodeAdapter.ts` — `loadProject`, `saveProject`, `writeProjectFile` (autosave path).
- `platforms/vscode/webview/main.tsx` — inline `JSON.parse(content)` in `setDocumentLoadHandler`.

**Modified (Rust):**
- `src-tauri/src/commands/project.rs` — `ProjectFile` struct gains a `layers` field + cell repr that accepts both shapes on load; `save_project` writes v3 flat / no-indent.

**Bump:**
- `platforms/vscode/package.json` — version `1.0.6` → `1.0.7`.
- `platforms/vscode/CHANGELOG.md` — 1.0.7 entry.

---

## Task 1: TS serialization helpers

**Files:**
- Create: `Q:/repo/pindou/src/utils/projectSerialization.ts`
- Test: `Q:/repo/pindou/src/utils/projectSerialization.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/utils/projectSerialization.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeProjectFromDisk,
  serializeProjectToV3,
} from "./projectSerialization";

describe("normalizeProjectFromDisk", () => {
  it("loads a v3 flat-cell project as in-memory {colorIndex} cells", () => {
    const raw = JSON.stringify({
      version: 3,
      canvasSize: { width: 2, height: 2 },
      canvasData: [[null, 5], [3, null]],
      createdAt: "t1",
      updatedAt: "t1",
    });
    const p = normalizeProjectFromDisk(raw);
    expect(p.version).toBe(3);
    expect(p.canvasData).toEqual([
      [{ colorIndex: null }, { colorIndex: 5 }],
      [{ colorIndex: 3 }, { colorIndex: null }],
    ]);
  });

  it("loads a v2 verbose-cell project unchanged", () => {
    const raw = JSON.stringify({
      version: 2,
      canvasSize: { width: 2, height: 1 },
      canvasData: [[{ colorIndex: null }, { colorIndex: 7 }]],
      createdAt: "t1",
      updatedAt: "t1",
    });
    const p = normalizeProjectFromDisk(raw);
    expect(p.canvasData).toEqual([[{ colorIndex: null }, { colorIndex: 7 }]]);
  });

  it("treats missing version as legacy verbose", () => {
    const raw = JSON.stringify({
      canvasSize: { width: 1, height: 1 },
      canvasData: [[{ colorIndex: 4 }]],
      createdAt: "t1",
      updatedAt: "t1",
    });
    const p = normalizeProjectFromDisk(raw);
    expect(p.canvasData).toEqual([[{ colorIndex: 4 }]]);
  });

  it("treats unknown future version (>=4) as v3", () => {
    const raw = JSON.stringify({
      version: 99,
      canvasSize: { width: 1, height: 1 },
      canvasData: [[2]],
      createdAt: "t1",
      updatedAt: "t1",
    });
    const p = normalizeProjectFromDisk(raw);
    expect(p.canvasData).toEqual([[{ colorIndex: 2 }]]);
  });

  it("normalises layers' data on v3", () => {
    const raw = JSON.stringify({
      version: 3,
      canvasSize: { width: 2, height: 1 },
      canvasData: [[null, 5]],
      layers: [{
        id: "l1", name: "底", visible: true, opacity: 1,
        data: [[null, 5]],
      }],
      createdAt: "t1",
      updatedAt: "t1",
    });
    const p = normalizeProjectFromDisk(raw);
    expect(p.layers?.[0].data).toEqual([
      [{ colorIndex: null }, { colorIndex: 5 }],
    ]);
  });

  it("normalises layers' data on v2 (verbose)", () => {
    const raw = JSON.stringify({
      version: 2,
      canvasSize: { width: 1, height: 1 },
      canvasData: [[{ colorIndex: null }]],
      layers: [{
        id: "l1", name: "底", visible: true, opacity: 1,
        data: [[{ colorIndex: 9 }]],
      }],
      createdAt: "t1",
      updatedAt: "t1",
    });
    const p = normalizeProjectFromDisk(raw);
    expect(p.layers?.[0].data).toEqual([[{ colorIndex: 9 }]]);
  });

  it("throws on malformed JSON", () => {
    expect(() => normalizeProjectFromDisk("{ not json")).toThrow();
  });

  it("throws when a cell is neither null/number nor {colorIndex}", () => {
    const raw = JSON.stringify({
      version: 3,
      canvasSize: { width: 1, height: 1 },
      canvasData: [["banana"]],
      createdAt: "t1",
      updatedAt: "t1",
    });
    expect(() => normalizeProjectFromDisk(raw)).toThrow(/cell/i);
  });
});

describe("serializeProjectToV3", () => {
  it("produces compact JSON (no whitespace/newlines)", () => {
    const out = serializeProjectToV3({
      version: 2,
      canvasSize: { width: 1, height: 1 },
      canvasData: [[{ colorIndex: null }]],
      createdAt: "t",
      updatedAt: "t",
    } as any);
    expect(out).not.toMatch(/\n/);
    expect(out).not.toMatch(/  /);
  });

  it("collapses cells to flat null|number and stamps version: 3", () => {
    const out = serializeProjectToV3({
      version: 2,
      canvasSize: { width: 2, height: 1 },
      canvasData: [[{ colorIndex: null }, { colorIndex: 5 }]],
      createdAt: "t",
      updatedAt: "t",
    } as any);
    const back = JSON.parse(out);
    expect(back.version).toBe(3);
    expect(back.canvasData).toEqual([[null, 5]]);
  });

  it("collapses layers' data too", () => {
    const out = serializeProjectToV3({
      version: 2,
      canvasSize: { width: 1, height: 1 },
      canvasData: [[{ colorIndex: 3 }]],
      layers: [{
        id: "l1", name: "底", visible: true, opacity: 1,
        data: [[{ colorIndex: 3 }]],
      }],
      createdAt: "t",
      updatedAt: "t",
    } as any);
    const back = JSON.parse(out);
    expect(back.layers[0].data).toEqual([[3]]);
  });

  it("round-trip is logically idempotent for a v3 in-memory object", () => {
    const original = {
      version: 2,
      canvasSize: { width: 3, height: 2 },
      canvasData: [
        [{ colorIndex: null }, { colorIndex: 1 }, { colorIndex: null }],
        [{ colorIndex: 2 }, { colorIndex: null }, { colorIndex: 7 }],
      ],
      createdAt: "t", updatedAt: "t",
    } as any;
    const s = serializeProjectToV3(original);
    const back = normalizeProjectFromDisk(s);
    expect(back.canvasData).toEqual(original.canvasData);
    expect(back.version).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd Q:/repo/pindou && npx vitest run src/utils/projectSerialization.test.ts`

Expected: All fail with `Cannot find module './projectSerialization'`.

- [ ] **Step 3: Implement the helpers**

Create `Q:/repo/pindou/src/utils/projectSerialization.ts`:

```ts
import type { ProjectFile, CanvasCell, BeadLayer } from "../types";

/** A cell as it appears on disk: either the verbose v2 form `{colorIndex}` or
 *  the flat v3 form (`null | number`). */
type DiskCell = number | null | { colorIndex: number | null };

function expandCell(cell: DiskCell, ctx: string): CanvasCell {
  if (cell === null) return { colorIndex: null };
  if (typeof cell === "number") return { colorIndex: cell };
  if (typeof cell === "object" && "colorIndex" in cell) {
    return { colorIndex: cell.colorIndex };
  }
  throw new Error(`Invalid cell at ${ctx}: ${JSON.stringify(cell)}`);
}

function expandRow(row: unknown, ctx: string): CanvasCell[] {
  if (!Array.isArray(row)) throw new Error(`Expected array at ${ctx}`);
  return row.map((c, i) => expandCell(c as DiskCell, `${ctx}[${i}]`));
}

function expandGrid(grid: unknown, ctx: string): CanvasCell[][] {
  if (!Array.isArray(grid)) throw new Error(`Expected 2D array at ${ctx}`);
  return grid.map((row, i) => expandRow(row, `${ctx}[${i}]`));
}

function collapseCell(cell: CanvasCell): number | null {
  return cell.colorIndex;
}

function collapseGrid(grid: CanvasCell[][]): (number | null)[][] {
  return grid.map((row) => row.map(collapseCell));
}

/**
 * Parse raw JSON text from disk and produce a fully-normalised in-memory
 * ProjectFile. The disk format is auto-detected from the `version` field:
 *   - version >= 3 : cells are flat (`null | number`).
 *   - version < 3 or missing : cells are verbose (`{colorIndex}`).
 *   - unknown future version : treated as v3.
 *
 * After this call, every cell in `canvasData` and every layer's `data` is
 * a `CanvasCell = { colorIndex: number | null }` regardless of source.
 */
export function normalizeProjectFromDisk(rawJson: string): ProjectFile {
  const raw = JSON.parse(rawJson) as any;
  const ver = typeof raw.version === "number" ? raw.version : 1;
  const isFlat = ver >= 3;

  const canvasData = isFlat
    ? expandGrid(raw.canvasData, "canvasData")
    : expandGrid(raw.canvasData, "canvasData"); // expandCell handles both shapes

  const layers: BeadLayer[] | undefined = Array.isArray(raw.layers)
    ? raw.layers.map((l: any, i: number): BeadLayer => ({
        id: String(l.id),
        name: String(l.name ?? "图层"),
        visible: l.visible !== false,
        opacity: typeof l.opacity === "number" ? l.opacity : 1,
        data: expandGrid(l.data, `layers[${i}].data`),
      }))
    : undefined;

  return {
    version: raw.version ?? 1,
    canvasSize: raw.canvasSize,
    canvasData,
    layers,
    gridConfig: raw.gridConfig,
    projectInfo: raw.projectInfo,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/**
 * Serialise an in-memory ProjectFile as compact v3 JSON. Always stamps
 * `version: 3`, collapses every cell to `null | number`, and uses
 * `JSON.stringify` with no indent.
 */
export function serializeProjectToV3(project: ProjectFile): string {
  const out: any = {
    ...project,
    version: 3,
    canvasData: collapseGrid(project.canvasData),
  };
  if (project.layers) {
    out.layers = project.layers.map((l) => ({
      ...l,
      data: collapseGrid(l.data),
    }));
  }
  return JSON.stringify(out);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Q:/repo/pindou && npx vitest run src/utils/projectSerialization.test.ts`

Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
cd Q:/repo/pindou
git add src/utils/projectSerialization.ts src/utils/projectSerialization.test.ts
git commit -m "feat: projectSerialization helpers for .pindou v3"
```

---

## Task 2: Wire browser adapter

**Files:**
- Modify: `Q:/repo/pindou/src/adapters/browser.ts` (loadProject + saveProject)

- [ ] **Step 1: Locate the existing JSON.parse / JSON.stringify calls**

Run: `cd Q:/repo/pindou && grep -n "JSON.parse\|JSON.stringify" src/adapters/browser.ts`

Expected: two hits — one in `loadProject`, one in `saveProject`.

- [ ] **Step 2: Replace `loadProject`'s parse with `normalizeProjectFromDisk`**

In `src/adapters/browser.ts`, add to imports:

```ts
import { normalizeProjectFromDisk, serializeProjectToV3 } from "../utils/projectSerialization";
```

Find the `loadProject` body, replace `JSON.parse(text)` with:

```ts
return normalizeProjectFromDisk(text);
```

- [ ] **Step 3: Replace `saveProject`'s stringify with `serializeProjectToV3`**

Find the line that does `JSON.stringify(project, null, 2)` (or similar) in `saveProject`. Replace with:

```ts
const content = serializeProjectToV3(project);
```

- [ ] **Step 4: Run the existing root vitest suite to confirm no regressions**

Run: `cd Q:/repo/pindou && npm test`

Expected: all PASS, including the new `projectSerialization.test.ts`.

- [ ] **Step 5: Commit**

```bash
cd Q:/repo/pindou
git add src/adapters/browser.ts
git commit -m "feat(browser): route project I/O through v3 serializer"
```

---

## Task 3: Wire VS Code adapter (load + save + writeProjectFile)

**Files:**
- Modify: `Q:/repo/pindou/platforms/vscode/src/vscodeAdapter.ts`

- [ ] **Step 1: Add import**

In `platforms/vscode/src/vscodeAdapter.ts`, add:

```ts
import {
  normalizeProjectFromDisk,
  serializeProjectToV3,
} from "../../../src/utils/projectSerialization";
```

- [ ] **Step 2: Replace `loadProject`**

Find the `loadProject` method (it reads via `sendRequest("readFile", { path })` then `JSON.parse(atob(result.data))`). Replace the parse line:

```ts
async loadProject(_path: string): Promise<ProjectFile> {
  const result = await sendRequest("readFile", { path: _path });
  const content = atob(result.data);
  return normalizeProjectFromDisk(content);
}
```

- [ ] **Step 3: Replace `saveProject`'s stringify**

In `saveProject`, find `const content = JSON.stringify(project, null, 2);` and replace with:

```ts
const content = serializeProjectToV3(project);
```

(Both the in-place save and the saveAs branch use the same `content`. There is one `JSON.stringify` call to replace.)

- [ ] **Step 4: Replace `writeProjectFile`'s stringify**

Find `writeProjectFile`. Replace `const content = JSON.stringify(project, null, 2);` with:

```ts
const content = serializeProjectToV3(project);
```

- [ ] **Step 5: Build the webview to confirm TS compiles**

Run: `cd Q:/repo/pindou/platforms/vscode && npm run build`

Expected: `built in ~2s` with no TS errors.

- [ ] **Step 6: Commit**

```bash
cd Q:/repo/pindou
git add platforms/vscode/src/vscodeAdapter.ts
git commit -m "feat(vscode): route project I/O through v3 serializer"
```

---

## Task 4: Wire VS Code webview entry point

**Files:**
- Modify: `Q:/repo/pindou/platforms/vscode/webview/main.tsx`

The webview parses the `loadDocument` payload inline. Route it through the helper too.

- [ ] **Step 1: Add import**

At the top of `webview/main.tsx`:

```ts
import { normalizeProjectFromDisk } from "../../../src/utils/projectSerialization";
```

- [ ] **Step 2: Replace the inline parse**

Find the `setDocumentLoadHandler` callback. Current code does `const project = JSON.parse(content);`. Replace with:

```ts
const project = normalizeProjectFromDisk(content);
```

Everything below that line (the `if (project.canvasSize && project.canvasData)` block) keeps working because `normalizeProjectFromDisk` already returns the in-memory shape.

- [ ] **Step 3: Build + run webview tests**

Run: `cd Q:/repo/pindou/platforms/vscode && npm run test:webview`

Expected: all PASS (older tests inject v2-shaped payloads which the normaliser handles).

- [ ] **Step 4: Commit**

```bash
cd Q:/repo/pindou
git add platforms/vscode/webview/main.tsx
git commit -m "feat(vscode-webview): normalise loadDocument payload through v3 helper"
```

---

## Task 5: Wire Tauri TS bridge (save only)

**Files:**
- Modify: `Q:/repo/pindou/src/adapters/tauri.ts`

`tauri.ts`'s `loadProject` invokes Rust and gets back an already-parsed object (no JSON.parse in TS land), so it doesn't need changes here — the Rust loader (Task 6) handles both shapes. `saveProject` sends the in-memory project to Rust, which serialises it. Both ends being symmetrical is the safest; we'll update Rust to emit v3 in Task 6.

For now, just verify there's nothing to do in `tauri.ts`:

- [ ] **Step 1: Verify tauri.ts has no direct JSON.parse / JSON.stringify of project payloads**

Run: `cd Q:/repo/pindou && grep -n "JSON\." src/adapters/tauri.ts`

Expected: no hits (or unrelated hits that don't touch project content).

- [ ] **Step 2: No code change. Skip commit for this task.**

(Rust-side work follows in Task 6.)

---

## Task 6: Rust ProjectFile — accept both shapes on load, emit v3 on save

**Files:**
- Modify: `Q:/repo/pindou/src-tauri/src/commands/project.rs`

Two changes here: the cell type must deserialize from EITHER the v2 verbose form OR the v3 flat form, and `save_project` must write compact JSON with `version: 3` and flat cells. We also add a `layers` field so the struct round-trips multi-layer projects (the existing struct silently drops them on save — a pre-existing bug we fix incidentally so v3 saves don't make it worse).

- [ ] **Step 1: Update the `CellData` deserialization to accept both shapes**

In `src-tauri/src/commands/project.rs`, replace the existing `CellData` struct (currently a one-field struct with `color_index`) with a custom-deserialised wrapper. The serializer always writes the flat form.

```rust
use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Debug, Clone, Copy)]
pub struct CellData {
    pub color_index: Option<u32>,
}

impl Serialize for CellData {
    /// v3 flat form: `null` or a number.
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self.color_index {
            Some(n) => s.serialize_u32(n),
            None => s.serialize_none(),
        }
    }
}

impl<'de> Deserialize<'de> for CellData {
    /// Accepts either the v2 verbose form `{ "colorIndex": null | number }`
    /// or the v3 flat form `null | number`.
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Repr {
            Flat(Option<u32>),
            Verbose {
                #[serde(rename = "colorIndex")]
                color_index: Option<u32>,
            },
        }
        Ok(match Repr::deserialize(d)? {
            Repr::Flat(v) => CellData { color_index: v },
            Repr::Verbose { color_index } => CellData { color_index },
        })
    }
}
```

- [ ] **Step 2: Add a `BeadLayer` struct + `layers` field on ProjectFile**

In the same file, add:

```rust
#[derive(Serialize, Deserialize)]
pub struct BeadLayer {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub opacity: f64,
    pub data: Vec<Vec<CellData>>,
}
```

Update `ProjectFile`:

```rust
#[derive(Serialize, Deserialize)]
pub struct ProjectFile {
    pub version: u32,
    #[serde(rename = "canvasSize")]
    pub canvas_size: CanvasSize,
    #[serde(rename = "canvasData")]
    pub canvas_data: Vec<Vec<CellData>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub layers: Option<Vec<BeadLayer>>,
    #[serde(rename = "gridConfig", skip_serializing_if = "Option::is_none", default)]
    pub grid_config: Option<GridConfig>,
    #[serde(rename = "projectInfo", skip_serializing_if = "Option::is_none", default)]
    pub project_info: Option<ProjectInfo>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
```

- [ ] **Step 3: Update `save_project` to write v3 compact**

Replace the body of `save_project`:

```rust
#[tauri::command]
pub fn save_project(path: String, mut project: ProjectFile) -> Result<(), String> {
    project.version = 3;
    let json = serde_json::to_string(&project)
        .map_err(|e| format!("Serialize failed: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Write failed: {}", e))?;
    Ok(())
}
```

(`load_project` needs no body change — serde's untagged enum on `CellData` handles both shapes transparently.)

- [ ] **Step 4: cargo check**

Run: `cd Q:/repo/pindou/src-tauri && cargo check`

Expected: `Finished dev profile` with no errors.

- [ ] **Step 5: Commit**

```bash
cd Q:/repo/pindou
git add src-tauri/src/commands/project.rs
git commit -m "feat(tauri): ProjectFile accepts v2/v3 cells, writes v3"
```

---

## Task 7: Rust round-trip test

**Files:**
- Modify: `Q:/repo/pindou/src-tauri/src/commands/project.rs` (append `#[cfg(test)] mod tests`)

- [ ] **Step 1: Append the test module**

At the bottom of `project.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialises_v2_verbose_cells() {
        let json = r#"{
            "version": 2,
            "canvasSize": { "width": 2, "height": 1 },
            "canvasData": [[{"colorIndex": null}, {"colorIndex": 5}]],
            "createdAt": "t", "updatedAt": "t"
        }"#;
        let p: ProjectFile = serde_json::from_str(json).unwrap();
        assert_eq!(p.canvas_data[0][0].color_index, None);
        assert_eq!(p.canvas_data[0][1].color_index, Some(5));
    }

    #[test]
    fn deserialises_v3_flat_cells() {
        let json = r#"{
            "version": 3,
            "canvasSize": { "width": 2, "height": 1 },
            "canvasData": [[null, 7]],
            "createdAt": "t", "updatedAt": "t"
        }"#;
        let p: ProjectFile = serde_json::from_str(json).unwrap();
        assert_eq!(p.canvas_data[0][0].color_index, None);
        assert_eq!(p.canvas_data[0][1].color_index, Some(7));
    }

    #[test]
    fn serialises_to_flat_v3_no_indent() {
        let p = ProjectFile {
            version: 2,
            canvas_size: CanvasSize { width: 2, height: 1 },
            canvas_data: vec![vec![
                CellData { color_index: None },
                CellData { color_index: Some(5) },
            ]],
            layers: None,
            grid_config: None,
            project_info: None,
            created_at: "t".into(),
            updated_at: "t".into(),
        };
        let mut p = p;
        p.version = 3;
        let s = serde_json::to_string(&p).unwrap();
        assert!(!s.contains('\n'));
        assert!(s.contains("\"canvasData\":[[null,5]]"));
        assert!(s.contains("\"version\":3"));
    }

    #[test]
    fn round_trips_with_layers() {
        let json = r#"{
            "version": 3,
            "canvasSize": { "width": 1, "height": 1 },
            "canvasData": [[3]],
            "layers": [{
                "id": "l1", "name": "底", "visible": true, "opacity": 1.0,
                "data": [[3]]
            }],
            "createdAt": "t", "updatedAt": "t"
        }"#;
        let p: ProjectFile = serde_json::from_str(json).unwrap();
        assert_eq!(p.layers.as_ref().unwrap().len(), 1);
        let s = serde_json::to_string(&p).unwrap();
        assert!(s.contains("\"data\":[[3]]"));
    }
}
```

- [ ] **Step 2: Run cargo test for the module**

Run: `cd Q:/repo/pindou/src-tauri && cargo test --lib commands::project::tests`

Expected: 4 passed.

- [ ] **Step 3: Commit**

```bash
cd Q:/repo/pindou
git add src-tauri/src/commands/project.rs
git commit -m "test(tauri): ProjectFile v2/v3 round-trip"
```

---

## Task 8: VS Code webview integration test

**Files:**
- Create: `Q:/repo/pindou/platforms/vscode/tests/file-format-v3.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";
import {
  setupPage,
  cleanupHarness,
  loadProject,
  getStoreState,
  getWrites,
  clearMessages,
} from "./helpers";
import * as path from "path";
import * as fs from "fs";

const SAMPLES_DIR = path.resolve(__dirname, "../../../samples");

test.describe(".pindou v3 file-format", () => {
  test.afterAll(() => cleanupHarness());

  test("loading a v2 file populates in-memory cells correctly", async ({ page }) => {
    await setupPage(page);
    // asuka71x100.pindou is currently a v2 file (verbose cells).
    await loadProject(page, { samplePath: path.join(SAMPLES_DIR, "asuka71x100.pindou") });
    const cs = await getStoreState<{ width: number; height: number }>(page, "canvasSize");
    expect(cs).toEqual({ width: 71, height: 100 });
    const data = await getStoreState<any[][]>(page, "canvasData");
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(100);
    expect(data[0].length).toBe(71);
    expect(typeof data[0][0]).toBe("object");
    expect("colorIndex" in data[0][0]).toBe(true);
  });

  test("saving emits v3 (flat cells, no indent, version: 3)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page, { samplePath: path.join(SAMPLES_DIR, "asuka71x100.pindou") });

    await clearMessages(page);
    // Trigger save via the store action (no dialog).
    await page.evaluate(() => (window as any).__pindouStore.getState().saveProject());

    // Wait for the harness to capture the save payload.
    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "save"),
      null, { timeout: 5_000 }
    );

    const writes = await getWrites(page);
    const save = writes.find((w: any) => w.kind === "save");
    expect(save).toBeTruthy();
    expect(save.content).not.toMatch(/\n/);            // no indent

    const parsed = JSON.parse(save.content);
    expect(parsed.version).toBe(3);
    expect(Array.isArray(parsed.canvasData)).toBe(true);
    // First row's first cell should be null OR a bare number (v3), NOT an object.
    const firstCell = parsed.canvasData[0][0];
    expect(typeof firstCell === "number" || firstCell === null).toBe(true);
  });
});
```

- [ ] **Step 2: Build then run the spec**

Run: `cd Q:/repo/pindou/platforms/vscode && npm run test:webview`

Expected: all PASS (the existing 93 + the 2 new ones = 95).

- [ ] **Step 3: Commit**

```bash
cd Q:/repo/pindou
git add platforms/vscode/tests/file-format-v3.spec.ts
git commit -m "test(vscode): v3 file-format round-trip via webview harness"
```

---

## Task 9: Size regression test on a real sample

**Files:**
- Create: `Q:/repo/pindou/tests/core/projectSerializationSize.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import {
  normalizeProjectFromDisk,
  serializeProjectToV3,
} from "../../src/utils/projectSerialization";
import * as fs from "fs";
import * as path from "path";

describe(".pindou v3 size regression", () => {
  it("shinzo_wo_sasageyo.pindou re-saves to under 250 KB", () => {
    const samplePath = path.resolve(
      __dirname, "../../samples/shinzo_wo_sasageyo.pindou"
    );
    const raw = fs.readFileSync(samplePath, "utf8");
    const project = normalizeProjectFromDisk(raw);
    const compact = serializeProjectToV3(project);
    // Current v2 file is ~1.3 MB. v3 target: well under 250 KB.
    expect(compact.length).toBeLessThan(250 * 1024);
    // Sanity: not absurdly small either (would indicate data loss).
    expect(compact.length).toBeGreaterThan(20 * 1024);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd Q:/repo/pindou && npx vitest run tests/core/projectSerializationSize.test.ts`

Expected: PASS. Log the actual size for reference.

- [ ] **Step 3: Commit**

```bash
cd Q:/repo/pindou
git add tests/core/projectSerializationSize.test.ts
git commit -m "test: v3 serialiser shrinks shinzo sample under 250 KB"
```

---

## Task 10: Bump VS Code extension version + CHANGELOG

**Files:**
- Modify: `Q:/repo/pindou/platforms/vscode/package.json`
- Modify: `Q:/repo/pindou/platforms/vscode/CHANGELOG.md`

- [ ] **Step 1: Bump version**

In `platforms/vscode/package.json`, change `"version": "1.0.6"` → `"version": "1.0.7"`.

- [ ] **Step 2: Add CHANGELOG entry**

In `platforms/vscode/CHANGELOG.md`, insert after the `# Changelog` line:

```markdown
## 1.0.7

- Change: `.pindou` 文件格式升级 v3 — cell 从 `{"colorIndex":null}` 改成裸 `null` 或数字,配合 `JSON.stringify` 无 indent,典型文件磁盘体积降 10–20×(`shinzo_wo_sasageyo.pindou` 从 1.3 MB → 估计 ~80–100 KB)。
- 老 v1/v2 文件可正常打开,下次保存自动升级 v3。Tauri 桌面端 + VS Code/browser/weapp 同步支持。
- Rust `ProjectFile` 顺手补了 `layers` 字段(之前桌面端 save_project 会静默丢图层)。
```

- [ ] **Step 3: Commit**

```bash
cd Q:/repo/pindou
git add platforms/vscode/package.json platforms/vscode/CHANGELOG.md
git commit -m "chore(vscode): bump to 1.0.7 for v3 file format"
```

---

## Task 11: Final verification — all suites + package + manual sanity

**Files:** none (verification only)

- [ ] **Step 1: Root vitest suite**

Run: `cd Q:/repo/pindou && npm test`

Expected: 0 failures. (Previous total was 144; now ~155 with serialization + size tests.)

- [ ] **Step 2: VS Code webview Playwright suite**

Run: `cd Q:/repo/pindou/platforms/vscode && npm run test:webview`

Expected: 0 failures. (Previous total was 93; now 95 with file-format spec.)

- [ ] **Step 3: Rust cargo test**

Run: `cd Q:/repo/pindou/src-tauri && cargo test --lib`

Expected: all PASS, including the 4 new project_v3 specs.

- [ ] **Step 4: Build + package the VS Code extension**

Run: `cd Q:/repo/pindou/platforms/vscode && npm run build && npm run package`

Expected: `pindouverse-1.0.7.vsix` produced, 14 files, ~265 KB.

- [ ] **Step 5: Manual sanity — load existing sample, save, inspect**

In a scratch shell:

```bash
cd Q:/repo/pindou
node -e "
const { normalizeProjectFromDisk, serializeProjectToV3 } = require('./src/utils/projectSerialization.ts');
"
```

Actually node can't import TS directly. Alternative: write a tiny one-shot script `scripts/check-v3.mjs`:

```js
import { readFileSync } from 'fs';
import { normalizeProjectFromDisk, serializeProjectToV3 } from '../src/utils/projectSerialization.ts';
const raw = readFileSync('samples/shinzo_wo_sasageyo.pindou', 'utf8');
const p = normalizeProjectFromDisk(raw);
const out = serializeProjectToV3(p);
console.log(`Original: ${(raw.length / 1024).toFixed(1)} KB`);
console.log(`Compact:  ${(out.length / 1024).toFixed(1)} KB`);
console.log(`Ratio:    ${(raw.length / out.length).toFixed(1)}x`);
```

Skip this if node can't resolve TS — the size test in Task 9 covers it and logs nothing extra.

- [ ] **Step 6: Stop and hand off to user for install + testing**

Per memory rule [[feedback_vscode_publish_needs_confirmation]]: do NOT publish. Print:

```
.vsix at platforms/vscode/pindouverse-1.0.7.vsix
Install: code --install-extension <path> --force
Test: open an old .pindou file, save, confirm file size dropped and content survives.
```

---

## Self-review

**Spec coverage:**
- Disk schema v3 → Task 1 (helpers), Tasks 2–5 (TS wiring), Task 6 (Rust)
- Compatibility matrix (v1/v2 read, v3 write) → Task 1 tests + Task 7 Rust tests + Task 8 integration
- `normalizeProjectFromDisk` + `serializeProjectToV3` API → Task 1
- Adapter callers (browser, tauri, vscode, webview main.tsx) → Tasks 2–5
- Rust struct changes + always-v3 write → Task 6
- Tests: pure unit, size regression, vscode integration, rust round-trip → Tasks 1, 7, 8, 9
- 1.0.7 bump + CHANGELOG → Task 10
- Final acceptance → Task 11

**Placeholder scan:** no TBDs / TODOs / vague directives. Each step has either concrete code or a concrete command.

**Type consistency:**
- `normalizeProjectFromDisk` returns `ProjectFile` in Tasks 1, 2, 3, 4 ✓
- `serializeProjectToV3` takes `ProjectFile`, returns `string` in Tasks 1, 2, 3, 5 ✓
- Rust `CellData { color_index: Option<u32> }` — same in struct + tests ✓
- Rust `BeadLayer` field names match what TS emits (`id`, `name`, `visible`, `opacity`, `data`) ✓
- VS Code adapter's `loadProject(_path: string): Promise<ProjectFile>` signature unchanged ✓

**Scope:** single feature, single spec, ~11 small tasks. Plan is appropriately sized for one execution session.
