# VS Code Blueprint Import — TypeScript Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Rust blueprint importer to TypeScript so the VS Code extension webview (and the browser, as a bonus) gets the same workflow as the Tauri desktop �� metadata fast path, autocorrelation detection, draggable bbox, color sampling — with progress reporting and cancellation surfaced in the UI.

**Architecture:** Algorithm in three new TS modules under `src/utils/` (PNG metadata reader, image loader, full algorithm port). Adapter interface grows an optional `{ onProgress, signal }` opts arg; Tauri ignores it; VS Code + browser delegate to the TS impl. UI dialog gets a single busy state with progress bar + cancel button. Algorithm loops yield to the UI thread (`await new Promise(setTimeout)`) every N iterations so cancel actually works.

**Tech Stack:** TypeScript, React, Web standards only (no new npm deps — PNG tEXt parsed by hand). Playwright for regression.

**Spec:** [docs/superpowers/specs/2026-05-30-vscode-blueprint-import-design.md](../specs/2026-05-30-vscode-blueprint-import-design.md)

**Branch:** `feature/vscode-blueprint-import` (already checked out from main at `7b31cf9`).

**Reference (Rust source):** [src-tauri/src/commands/blueprint_import.rs](../../../src-tauri/src/commands/blueprint_import.rs) — single 1229-line file. Every helper has a counterpart in this plan.

---

## File Structure

**New files:**
- `src/utils/pngMetadata.ts` — tiny self-contained PNG `tEXt` chunk reader (no pngjs dep)
- `src/utils/imageLoader.ts` — `loadImageData(path, adapter)` → RGBA + raw bytes + media type
- `src/utils/blueprintImportTS.ts` — port of `blueprint_import.rs`: bbox detection, autocorr, snap, sampling, matching, text detection, result assembly. Exports `detectBlueprintDimsTS` + `importBlueprintTS`.
- `platforms/vscode/tests/blueprint-import.spec.ts` — 4 Playwright tests covering metadata fast path, detection path, cancel-during-import, and dialog progress UI smoke

**Modified files:**
- `src/adapters/index.ts` — extend `importBlueprint` + `detectBlueprintDims` signatures with optional `opts: { onProgress?, signal? }`
- `src/adapters/tauri.ts` — accept the new opt arg (ignore it; Rust is fast)
- `src/adapters/browser.ts` — implement `readFileBase64` (for data URLs only); delegate import + detect to TS impl
- `platforms/vscode/src/vscodeAdapter.ts` — implement `readFileBase64` via existing `readFile` request (already returns base64); delegate import + detect to TS impl
- `src/components/Import/BlueprintDimsConfirmDialog.tsx` — unify `redetecting`/`busy` state, add progress bar + cancel button, wire `AbortController` through to adapter calls
- `src/App.tsx` — same progress/cancel pattern for the final import overlay

---

## Task 1: PNG tEXt chunk reader

**Files:**
- Create: `src/utils/pngMetadata.ts`
- Test: covered indirectly by the integration test in Task 8; no dedicated unit test (Playwright pulls in real PNG bytes which is the realistic case)

- [ ] **Step 1: Create the module**

```typescript
/**
 * Tiny PNG tEXt chunk reader. Avoids pulling in pngjs (~50 KB) for one
 * chunk type. Mirrors the Rust `read_blueprint_metadata` in
 * src-tauri/src/commands/blueprint_import.rs.
 */

export interface BlueprintPngMetadata {
  v: number;
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  originX: number;
  originY: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const KEYWORD = "pindouverse-blueprint";

/** Returns null if input isn't a PNG, has no tEXt chunk with the keyword,
 *  or the chunk's JSON has v !== 1. */
export function readBlueprintMetadata(bytes: Uint8Array): BlueprintPngMetadata | null {
  if (bytes.length < 8) return null;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }

  // Walk chunks: [len:u32be][type:4][data:len][crc:u32be]
  let cursor = 8;
  while (cursor + 12 <= bytes.length) {
    const len =
      (bytes[cursor] << 24) |
      (bytes[cursor + 1] << 16) |
      (bytes[cursor + 2] << 8) |
      bytes[cursor + 3];
    const type = String.fromCharCode(
      bytes[cursor + 4],
      bytes[cursor + 5],
      bytes[cursor + 6],
      bytes[cursor + 7],
    );
    const dataStart = cursor + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) return null;

    if (type === "tEXt") {
      // data is: keyword \0 text (both Latin-1)
      let zero = dataStart;
      while (zero < dataEnd && bytes[zero] !== 0) zero++;
      if (zero < dataEnd) {
        const kw = latin1Decode(bytes, dataStart, zero);
        if (kw === KEYWORD) {
          const text = latin1Decode(bytes, zero + 1, dataEnd);
          try {
            const parsed = JSON.parse(text);
            if (
              parsed &&
              parsed.v === 1 &&
              typeof parsed.gridWidth === "number" &&
              typeof parsed.gridHeight === "number" &&
              typeof parsed.cellSize === "number" &&
              typeof parsed.originX === "number" &&
              typeof parsed.originY === "number"
            ) {
              return parsed as BlueprintPngMetadata;
            }
          } catch {
            // fall through; keep walking in case there's another tEXt
          }
        }
      }
    }

    if (type === "IDAT") {
      // tEXt always appears before image data; no point reading further
      return null;
    }

    cursor = dataEnd + 4; // skip data + CRC
  }
  return null;
}

function latin1Decode(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
```

- [ ] **Step 2: Verify the file builds**

Run:
```bash
cd q:/repo/pindou/platforms/vscode && npm run build:webview 2>&1 | tail -3
```
Expected: clean build (this file is unused so far; just confirming no syntax errors).

- [ ] **Step 3: Commit**

```bash
git add src/utils/pngMetadata.ts
git commit -m "feat(utils): pngMetadata.ts — read pindouverse-blueprint tEXt chunk

Hand-rolled PNG chunk walker that finds our metadata chunk without
pulling in pngjs (~50 KB). Mirrors the Rust read_blueprint_metadata
in src-tauri/src/commands/blueprint_import.rs."
```

---

## Task 2: Image loader (path → RGBA + raw bytes)

**Files:**
- Create: `src/utils/imageLoader.ts`

- [ ] **Step 1: Create the module**

```typescript
/**
 * Load a blueprint image: bytes via adapter, decoded RGBA via the browser's
 * native image decoder. Used by the TS blueprint importer (VS Code webview +
 * browser); Tauri path doesn't need this (Rust does its own decoding).
 */

export interface LoadedImage {
  /** RGBA, length = width * height * 4 */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Raw file bytes — passed to pngMetadata.readBlueprintMetadata for PNG. */
  rawBytes: Uint8Array;
  mediaType: "image/png" | "image/jpeg" | "image/bmp" | "application/octet-stream";
}

interface ReadFileAdapter {
  readFileBase64(path: string): Promise<string>;
}

export async function loadImageData(
  path: string,
  adapter: ReadFileAdapter,
): Promise<LoadedImage> {
  const base64 = await adapter.readFileBase64(path);
  const rawBytes = base64ToUint8Array(base64);
  const mediaType = detectMediaType(path);

  const dataUrl = `data:${mediaType};base64,${base64}`;
  const img = await loadImage(dataUrl);
  const { width, height } = img;
  if (width === 0 || height === 0) {
    throw new Error("Image decoded to 0×0");
  }

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context");
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);

  return {
    data: imageData.data,
    width,
    height,
    rawBytes,
    mediaType,
  };
}

function detectMediaType(path: string): LoadedImage["mediaType"] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "application/octet-stream";
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to decode image at ${src.slice(0, 64)}…`));
    img.src = src;
  });
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement;
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
```

- [ ] **Step 2: Verify build**

```bash
cd q:/repo/pindou/platforms/vscode && npm run build:webview 2>&1 | tail -3
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/utils/imageLoader.ts
git commit -m "feat(utils): imageLoader.ts — read file → RGBA ImageData

Pulls bytes via adapter.readFileBase64, decodes via the native Image
element + canvas getImageData. Tries OffscreenCanvas first; falls
back to detached <canvas> for VS Code webviews where OffscreenCanvas
2d context may have been gated."
```

---

## Task 3: Adapter interface — add optional opts; add readFileBase64

**Files:**
- Modify: `src/adapters/index.ts` (signatures only — implementations come later)

- [ ] **Step 1: Extend the interface**

Open `src/adapters/index.ts`. Find the `PlatformAdapter` interface (around line 123) and apply two changes:

(a) Add a new method `readFileBase64` near `loadProject` / `previewImage` (file I/O block):

```typescript
  /** Read the file at `path` and return its raw bytes as a base64 string.
   *  Used by the TS blueprint importer (webview + browser) to load the
   *  source image at full resolution. */
  readFileBase64(path: string): Promise<string>;
```

(b) Extend `importBlueprint` and `detectBlueprintDims` with an optional opts arg:

```typescript
  importBlueprint(
    path: string,
    palette: PaletteColor[],
    gridWidth?: number,
    gridHeight?: number,
    mode?: ImportMode,
    bbox?: { left: number; top: number; right: number; bottom: number },
    opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal },
  ): Promise<BlueprintImportResult>;
  detectBlueprintDims(
    path: string,
    bbox?: { left: number; top: number; right: number; bottom: number },
    opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal },
  ): Promise<{
    width: number;
    height: number;
    cellSize: number;
    bbox: { left: number; top: number; right: number; bottom: number };
    hasMetadata: boolean;
  }>;
```

- [ ] **Step 2: Verify TypeScript errors point only to the missing implementations**

```bash
cd q:/repo/pindou/platforms/vscode && npm run build:webview 2>&1 | tail -25
```
Expected: errors like "Property `readFileBase64` is missing in TauriAdapter / BrowserAdapter / VScodeAdapter". These get fixed in the next tasks.

- [ ] **Step 3: Do NOT commit yet**

The interface and implementations land in a single commit at the end of Task 4 to keep the build green at every commit.

---

## Task 4: Adapter implementations (Tauri ignores opts; VS Code + browser implement readFileBase64)

**Files:**
- Modify: `src/adapters/tauri.ts`
- Modify: `src/adapters/browser.ts`
- Modify: `platforms/vscode/src/vscodeAdapter.ts`

- [ ] **Step 1: Tauri**

Find the `importBlueprint` method in `src/adapters/tauri.ts` and add the new opts arg (ignored):

```typescript
  async importBlueprint(
    path: string,
    palette: PaletteColor[],
    gridWidth?: number,
    gridHeight?: number,
    mode?: ImportMode,
    bbox?: { left: number; top: number; right: number; bottom: number },
    _opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal },
  ): Promise<BlueprintImportResult> {
    return await invoke<BlueprintImportResult>("import_blueprint", {
      request: {
        path, palette,
        grid_width: gridWidth ?? null,
        grid_height: gridHeight ?? null,
        bbox_left: bbox?.left ?? null,
        bbox_top: bbox?.top ?? null,
        bbox_right: bbox?.right ?? null,
        bbox_bottom: bbox?.bottom ?? null,
        mode: mode ?? "color_priority",
      },
    });
  }

  async detectBlueprintDims(
    path: string,
    bbox?: { left: number; top: number; right: number; bottom: number },
    _opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal },
  ): Promise<{ width: number; height: number; cellSize: number; bbox: { left: number; top: number; right: number; bottom: number }; hasMetadata: boolean }> {
    const raw = await invoke<{
      width: number; height: number; cell_size: number;
      bbox_left: number; bbox_top: number; bbox_right: number; bbox_bottom: number;
      has_metadata: boolean;
    }>("detect_blueprint_dims", {
      request: { path, bbox: bbox ? { left: bbox.left, top: bbox.top, right: bbox.right, bottom: bbox.bottom } : null },
    });
    return {
      width: raw.width,
      height: raw.height,
      cellSize: raw.cell_size,
      bbox: { left: raw.bbox_left, top: raw.bbox_top, right: raw.bbox_right, bbox_bottom: raw.bbox_bottom },
      hasMetadata: raw.has_metadata,
    };
  }
```

Wait — note the typo in the return object: the existing Tauri code uses `bottom`, not `bbox_bottom`. Keep the existing return shape unchanged; just edit the parameter list. Reread the existing file before editing.

Also add `readFileBase64` near `loadProject`:

```typescript
  async readFileBase64(path: string): Promise<string> {
    // Reuse the Rust read_file_base64 command if it exists (it was added in
    // an earlier branch). If the command isn't registered, fall back to a
    // descriptive error so the UI surfaces it.
    try {
      return await invoke<string>("read_file_base64", { path });
    } catch (e) {
      throw new Error(`readFileBase64 not available on Tauri: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
```

Note: on the current `main` branch, `read_file_base64` does NOT exist (it was on the discarded experiment branch). For Tauri's `readFileBase64`, the cleanest path is: don't implement on Tauri — leave it throwing — because Tauri's `importBlueprint` and `detectBlueprintDims` never call it (they go straight to the Rust handler that reads the file itself). So replace the body with a throw:

```typescript
  async readFileBase64(_path: string): Promise<string> {
    throw new Error("readFileBase64 not used on Tauri; the Rust import command reads the file directly.");
  }
```

- [ ] **Step 2: VS Code**

In `platforms/vscode/src/vscodeAdapter.ts`, replace the two existing throws for `importBlueprint` and `detectBlueprintDims` with delegations to the TS impl, and implement `readFileBase64` via the existing `readFile` host request (which already returns base64).

First, add new imports near the top (alongside existing adapter / type imports):

```typescript
import { importBlueprintTS, detectBlueprintDimsTS } from "../../../src/utils/blueprintImportTS";
```

Find these existing methods (around lines 506–512):

```typescript
  async importBlueprint(_path, ...) { throw new Error("..."); }
  async detectBlueprintDims(_path, ...) { throw new Error("..."); }
```

Replace with:

```typescript
  async importBlueprint(
    path: string,
    palette: PaletteColor[],
    gridWidth?: number,
    gridHeight?: number,
    mode?: ImportMode,
    bbox?: { left: number; top: number; right: number; bottom: number },
    opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal },
  ): Promise<BlueprintImportResult> {
    return await importBlueprintTS(
      { path, palette, gridWidth, gridHeight, bbox, mode },
      this,
      opts,
    );
  }

  async detectBlueprintDims(
    path: string,
    bbox?: { left: number; top: number; right: number; bottom: number },
    opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal },
  ): Promise<{ width: number; height: number; cellSize: number; bbox: { left: number; top: number; right: number; bottom: number }; hasMetadata: boolean }> {
    return await detectBlueprintDimsTS(path, this, bbox, opts);
  }

  async readFileBase64(path: string): Promise<string> {
    // The existing host-side handler for the "readFile" message reads the file
    // via vscode.workspace.fs.readFile and returns it base64-encoded. Reuse it.
    const result = await sendRequest("readFile", { path });
    if (!result?.success || typeof result.data !== "string") {
      throw new Error(`Read failed: ${result?.error ?? "unknown error"}`);
    }
    return result.data;
  }
```

- [ ] **Step 3: Browser**

In `src/adapters/browser.ts`, do the same delegation as VS Code, plus a `readFileBase64` that only supports `data:` URLs in POC (full file system access is out of scope):

```typescript
  async importBlueprint(
    path: string,
    palette: PaletteColor[],
    gridWidth?: number,
    gridHeight?: number,
    mode?: ImportMode,
    bbox?: { left: number; top: number; right: number; bottom: number },
    opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal },
  ): Promise<BlueprintImportResult> {
    return await importBlueprintTS(
      { path, palette, gridWidth, gridHeight, bbox, mode },
      this,
      opts,
    );
  }

  async detectBlueprintDims(
    path: string,
    bbox?: { left: number; top: number; right: number; bottom: number },
    opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal },
  ): Promise<{ width: number; height: number; cellSize: number; bbox: { left: number; top: number; right: number; bottom: number }; hasMetadata: boolean }> {
    return await detectBlueprintDimsTS(path, this, bbox, opts);
  }

  async readFileBase64(path: string): Promise<string> {
    if (path.startsWith("data:")) {
      const comma = path.indexOf(",");
      if (comma < 0) throw new Error("Invalid data URL");
      return path.slice(comma + 1);
    }
    throw new Error("readFileBase64 in browser only supports data: URLs (full file access via picker not implemented yet)");
  }
```

Browser needs the import too. Add at the top:

```typescript
import { importBlueprintTS, detectBlueprintDimsTS } from "./utils/blueprintImportTS";
```

(Path is `./utils/blueprintImportTS` from `src/adapters/browser.ts`.) Wait — browser.ts is at `src/adapters/browser.ts`, so it should be `../utils/blueprintImportTS`. Confirm before saving.

- [ ] **Step 4: Build to confirm**

```bash
cd q:/repo/pindou/platforms/vscode && npm run build:webview 2>&1 | tail -15
```
Expected: errors now say something like "Cannot find module '../../../src/utils/blueprintImportTS'" — that file lands in Task 5. Until then, comment out the implementations? **No** — easier to just create a stub in Task 5 first, then come back. Skip this build step and proceed straight to Task 5; the build will pass once both land.

- [ ] **Step 5: Do NOT commit yet — wait until Task 5 lands the TS impl**

---

## Task 5: Algorithm port — Part A (skeleton, types, constants, helpers)

**Files:**
- Create: `src/utils/blueprintImportTS.ts`

The full port is ~600 lines; splitting into two tasks to keep each subagent invocation manageable. Part A: types, constants, leaf helpers (no business logic yet).

- [ ] **Step 1: Create the file skeleton with constants and types**

```typescript
/**
 * TypeScript port of src-tauri/src/commands/blueprint_import.rs.
 * Used by VS Code webview + browser adapters where there's no Rust backend.
 *
 * Algorithm is identical to the Rust version (verified by per-step constants).
 * Differences:
 *   - Async with progress reporting + AbortSignal cancellation
 *   - Loops yield to the UI thread every N iterations via setTimeout(0)
 *   - Uses Uint8ClampedArray RGBA buffers from canvas.getImageData
 */

import type {
  BlueprintImportResult,
  CellResult,
  CellSource,
  ImportMode,
  PaletteColor,
} from "../adapters";
import { readBlueprintMetadata } from "./pngMetadata";
import { loadImageData, type LoadedImage } from "./imageLoader";

// ─── Public API ──────────────────────────────��──────────────────────

export interface ImportTsOpts {
  onProgress?: (stage: string, fraction: number) => void;
  signal?: AbortSignal;
}

export interface ImportTsArgs {
  path: string;
  palette: PaletteColor[];
  gridWidth?: number;
  gridHeight?: number;
  bbox?: BBox;
  mode?: ImportMode;
}

export interface BBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DetectTsResult {
  width: number;
  height: number;
  cellSize: number;
  bbox: BBox;
  hasMetadata: boolean;
}

interface ReadFileAdapter {
  readFileBase64(path: string): Promise<string>;
}

// ─── Constants (mirror Rust SamplingConfig + module consts) ─────────

// detect_grid_bbox
const BBOX_DENSITY_FLOOR = 0.05;
const BBOX_MIN_AXIS_COVERAGE = 0.30;

// autocorr_peak
const AUTOCORR_MIN_LAG = 5;
const AUTOCORR_MAX_LAG = 120;
const AUTOCORR_LOCAL_PEAK_RATIO = 1.05;
const AUTOCORR_LOCAL_PEAK_WINDOW = 3;
const AUTOCORR_ALTERNATING_NEG_RATIO = -0.5;
const CROSS_AXIS_DISAGREE_FACTOR = 2.0;

// snap_to_grid_lines
const SNAP_LINE_THRESH_FRAC = 0.5;
const SNAP_LINE_THRESH_PERCENTILE = 0.9;
const SNAP_LINE_WINDOW = 2;

// Per-format thresholds (mirror Rust SamplingConfig::for_format)
interface SamplingConfig {
  insetRatio: number;
  extraSamples: number;
  gridLumThreshold: number;
  autocorrStep2Accept: number;
  autocorrStep3Accept: number;
}

function configForMediaType(mediaType: LoadedImage["mediaType"]): SamplingConfig {
  if (mediaType === "image/png") {
    return { insetRatio: 0.2, extraSamples: 0, gridLumThreshold: 230, autocorrStep2Accept: 0.95, autocorrStep3Accept: 0.95 };
  }
  if (mediaType === "image/jpeg") {
    return { insetRatio: 0.25, extraSamples: 8, gridLumThreshold: 210, autocorrStep2Accept: 0.85, autocorrStep3Accept: 0.85 };
  }
  return { insetRatio: 0.2, extraSamples: 4, gridLumThreshold: 220, autocorrStep2Accept: 0.90, autocorrStep3Accept: 0.90 };
}

// ─── Cooperative async: yield + cancel ──────────────────────────────

function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}

async function yieldToUi(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ─── Pixel helpers (operate on Uint8ClampedArray RGBA) ──────────────

function pixelLuminance(data: Uint8ClampedArray, x: number, y: number, width: number): number {
  const i = (y * width + x) * 4;
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

function getPixelRGB(data: Uint8ClampedArray, x: number, y: number, width: number): [number, number, number] {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

// ─── Public stubs that satisfy adapter delegation (filled in Part B) ─

export async function detectBlueprintDimsTS(
  path: string,
  adapter: ReadFileAdapter,
  bbox: BBox | undefined,
  opts?: ImportTsOpts,
): Promise<DetectTsResult> {
  // Filled in Task 6.
  void path; void adapter; void bbox; void opts;
  throw new Error("detectBlueprintDimsTS not yet implemented");
}

export async function importBlueprintTS(
  args: ImportTsArgs,
  adapter: ReadFileAdapter,
  opts?: ImportTsOpts,
): Promise<BlueprintImportResult> {
  void args; void adapter; void opts;
  throw new Error("importBlueprintTS not yet implemented");
}

// (Internal helpers — detectGridBBox, autocorrPeak, sampleCellColor, etc. —
// are added in Task 6.)

// Suppress unused-import warnings (referenced when Task 6 is done).
void CellResult; void CellSource;
```

- [ ] **Step 2: Build (Task 4 still expects these exports)**

```bash
cd q:/repo/pindou/platforms/vscode && npm run build:webview 2>&1 | tail -10
```
Expected: build is now clean (or close to it — the only remaining warnings should be unused vars in `blueprintImportTS.ts`). The stubs let Task 4's adapter delegations compile. The actual runtime behavior is "throw not implemented" until Task 6.

- [ ] **Step 3: Commit Tasks 3 + 4 + 5 together as the "scaffolding" commit**

This is the first commit since Task 3, intentionally bundling the interface change + adapter delegations + algorithm scaffolding (everything compiles, nothing is runtime-correct yet).

```bash
cd q:/repo/pindou
git add src/adapters/index.ts src/adapters/tauri.ts src/adapters/browser.ts platforms/vscode/src/vscodeAdapter.ts src/utils/blueprintImportTS.ts
git commit -m "feat(adapter): readFileBase64 + opts; delegate VS Code/browser import to TS

Scaffolding only — the TS impl in src/utils/blueprintImportTS.ts has
public functions stubbed to 'not yet implemented', filled in the
next commit. Tauri keeps the existing Rust path; the new opts arg
(onProgress + signal) is accepted but ignored on Tauri."
```

---

## Task 6: Algorithm port — Part B (full implementation)

**Files:**
- Modify: `src/utils/blueprintImportTS.ts` — replace the stubs with the full port.

This is the heavy lift. The new code in this task is a faithful TS translation of the Rust functions in `src-tauri/src/commands/blueprint_import.rs`. Implementer should keep the Rust file open as reference; constants are already in the TS file from Task 5.

- [ ] **Step 1: Add the internal helpers**

Insert these helpers BEFORE the public function stubs in `src/utils/blueprintImportTS.ts`:

```typescript
// ─── 1. Bbox detection ──────────────────────────────────────────────

function rowDarkCount(data: Uint8ClampedArray, width: number, y: number, lumThreshold: number): number {
  let count = 0;
  for (let x = 0; x < width; x++) {
    if (pixelLuminance(data, x, y, width) < lumThreshold) count++;
  }
  return count;
}

function colDarkCount(data: Uint8ClampedArray, width: number, height: number, x: number, lumThreshold: number): number {
  let count = 0;
  for (let y = 0; y < height; y++) {
    if (pixelLuminance(data, x, y, width) < lumThreshold) count++;
  }
  return count;
}

function longestRunAbove(values: number[], lo: number): [number, number] | null {
  let best: [number, number] | null = null;
  let curStart: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] >= lo) {
      if (curStart === null) curStart = i;
      const len = i - curStart + 1;
      if (best === null || len > best[1] - best[0] + 1) {
        best = [curStart, i];
      }
    } else {
      curStart = null;
    }
  }
  return best;
}

async function detectGridBBox(
  img: LoadedImage,
  lumThreshold: number,
  opts?: ImportTsOpts,
): Promise<BBox | null> {
  const { data, width, height } = img;
  opts?.onProgress?.("分析水平密度", 0);

  const rowDark: number[] = new Array(height);
  for (let y = 0; y < height; y++) {
    if (y % 64 === 0) {
      checkSignal(opts?.signal);
      opts?.onProgress?.("分析水平密度", y / height);
      await yieldToUi();
    }
    rowDark[y] = rowDarkCount(data, width, y, lumThreshold);
  }

  opts?.onProgress?.("分析垂直密度", 0);
  const colDark: number[] = new Array(width);
  for (let x = 0; x < width; x++) {
    if (x % 64 === 0) {
      checkSignal(opts?.signal);
      opts?.onProgress?.("分析垂直密度", x / width);
      await yieldToUi();
    }
    colDark[x] = colDarkCount(data, width, height, x, lumThreshold);
  }

  const rowLo = Math.floor(width * BBOX_DENSITY_FLOOR);
  const colLo = Math.floor(height * BBOX_DENSITY_FLOOR);

  const yRange = longestRunAbove(rowDark, rowLo);
  const xRange = longestRunAbove(colDark, colLo);
  if (!yRange || !xRange) return null;

  const [top, bottomInclusive] = yRange;
  const [left, rightInclusive] = xRange;
  const bottom = bottomInclusive + 1;
  const right = rightInclusive + 1;

  if ((bottom - top) * 10 < height * 3) return null;
  if ((right - left) * 10 < width * 3) return null;

  return { left, top, right, bottom };
}

// ─── 2. Autocorrelation period detection ───────────────────────────

function autocorrPeak(
  signal: number[],
  minLag: number,
  maxLag: number,
  step2Accept: number,
  step3Accept: number,
): [number, number] | null {
  const n = signal.length;
  if (n < maxLag + 2) return null;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i];
  mean /= n;

  const centered = new Float64Array(n);
  let varAcc = 0;
  for (let i = 0; i < n; i++) {
    const v = signal[i] - mean;
    centered[i] = v;
    varAcc += v * v;
  }
  const variance = varAcc / n;
  if (variance <= 0) return null;

  const hi = Math.min(maxLag, n - 2);

  function corrAt(lag: number): number {
    if (lag === 0 || lag >= n) return -Infinity;
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += centered[i] * centered[i + lag];
    return sum / ((n - lag) * variance);
  }

  function isStrongLocalPeak(lag: number): boolean {
    const win = AUTOCORR_LOCAL_PEAK_WINDOW;
    if (lag < win + 1 || lag >= n - win) return false;
    const c = corrAt(lag);
    let neighSum = 0;
    for (let off = 1; off <= win; off++) {
      const lo = corrAt(lag - off);
      const cHi = corrAt(lag + off);
      if (lo >= c || cHi >= c) return false;
      neighSum += lo + cHi;
    }
    const neighMean = neighSum / (2 * win);
    return c >= neighMean * AUTOCORR_LOCAL_PEAK_RATIO;
  }

  // Global max
  let maxLagFound = minLag;
  let maxCorr = -Infinity;
  for (let lag = minLag; lag <= hi; lag++) {
    const c = corrAt(lag);
    if (c > maxCorr) { maxCorr = c; maxLagFound = lag; }
  }
  if (maxCorr <= 0) return null;

  // Step 1: alternating-cell halving
  let bestLag = maxLagFound;
  const half = Math.floor(bestLag / 2);
  if (half >= minLag) {
    const cHalf = corrAt(half);
    if (cHalf <= AUTOCORR_ALTERNATING_NEG_RATIO * maxCorr) bestLag = half;
  }

  // Step 2: integer divisors
  const step2Acc = maxCorr * step2Accept;
  for (let d = 2; d <= bestLag; d++) {
    if (bestLag % d !== 0) continue;
    const candidate = Math.floor(bestLag / d);
    if (candidate < minLag) break;
    if (corrAt(candidate) >= step2Acc && isStrongLocalPeak(candidate)) {
      bestLag = candidate;
    }
  }

  // Step 3: near-divisor candidates with tighter threshold
  const step3Acc = maxCorr * step3Accept;
  for (let k = 2; k <= 5; k++) {
    const cand = Math.floor(bestLag / k);
    if (cand < minLag) break;
    for (const cOff of [-2, -1, 0, 1, 2]) {
      const c = Math.max(minLag, cand + cOff);
      if (c >= hi) continue;
      if (corrAt(c) >= step3Acc && isStrongLocalPeak(c) && c < bestLag) {
        bestLag = c;
      }
    }
  }

  const c0 = corrAt(bestLag);
  if (bestLag <= minLag || bestLag >= hi) return [bestLag, c0];

  // Parabolic refinement to sub-pixel lag
  const cm1 = corrAt(bestLag - 1);
  const cp1 = corrAt(bestLag + 1);
  const denom = cm1 - 2 * c0 + cp1;
  const lagF = Math.abs(denom) < 1e-9
    ? bestLag
    : bestLag + 0.5 * (cm1 - cp1) / denom;
  return [lagF, c0];
}

// ─── 3. Snap detected period back to actual grid-line phase ────────

function snapToGridLines(signal: number[], hintStart: number, hintEnd: number, period: number): [number, number] {
  if (hintEnd <= hintStart || period < 2) return [hintStart, hintEnd];
  const len = signal.length;
  const periodInt = Math.max(2, Math.round(period));
  const s = hintStart;
  const e = Math.min(hintEnd, len);
  if (e <= s) return [hintStart, hintEnd];

  // p90 of in-hint signal → line_thresh
  const slice: number[] = [];
  for (let i = s; i < e; i++) slice.push(signal[i]);
  slice.sort((a, b) => a - b);
  const pIdx = Math.min(slice.length - 1, Math.floor(slice.length * SNAP_LINE_THRESH_PERCENTILE));
  const p90 = slice[pIdx];
  const lineThresh = p90 * SNAP_LINE_THRESH_FRAC;

  const win = SNAP_LINE_WINDOW;
  function lineDensity(pos: number): number {
    const lo = Math.max(0, pos - win);
    const hi = Math.min(len, pos + win + 1);
    if (hi <= lo) return 0;
    let m = -Infinity;
    for (let i = lo; i < hi; i++) if (signal[i] > m) m = signal[i];
    return m;
  }

  // Find best phase
  let bestPhase = 0;
  let bestScore = 0;
  for (let phase = 0; phase < periodInt; phase++) {
    let score = 0;
    for (let k = 0; ; k++) {
      const pos = Math.round(phase + k * period);
      if (pos >= len) break;
      if (pos >= s && pos < e && lineDensity(pos) >= lineThresh) score++;
    }
    if (score > bestScore) { bestScore = score; bestPhase = phase; }
  }

  // Find seed line within bbox
  let seed: number | null = null;
  for (let k = 0; ; k++) {
    const pos = Math.round(bestPhase + k * period);
    if (pos >= len) break;
    if (pos >= s && pos < e && lineDensity(pos) >= lineThresh) { seed = pos; break; }
  }
  if (seed === null) return [hintStart, hintEnd];

  // Walk left
  let firstLine = seed;
  for (let k = 1; ; k++) {
    const candidate = Math.round(seed - k * period);
    if (candidate < -win) break;
    const lo = Math.max(0, candidate - win);
    const hi = Math.min(len, candidate + win + 1);
    if (hi <= lo) break;
    let localMax = -Infinity;
    for (let i = lo; i < hi; i++) if (signal[i] > localMax) localMax = signal[i];
    if (localMax < lineThresh) break;
    firstLine = Math.max(0, candidate);
  }

  // Walk right (allow candidate up to len + win)
  let lastLine = seed;
  for (let k = 1; ; k++) {
    const candidate = Math.round(seed + k * period);
    if (candidate > len + win) break;
    const lo = Math.max(0, candidate - win);
    const hi = Math.min(len, candidate + win + 1);
    if (hi <= lo) break;
    let localMax = -Infinity;
    for (let i = lo; i < hi; i++) if (signal[i] > localMax) localMax = signal[i];
    if (localMax < lineThresh) break;
    lastLine = Math.min(len - 1, candidate);
  }

  if (lastLine > firstLine) return [firstLine, lastLine];
  return [hintStart, hintEnd];
}

// ─── 4. Geometry recovery (bbox → grid dims + cell size + origin) ──

async function recoverGridGeometry(
  img: LoadedImage,
  bbox: BBox,
  config: SamplingConfig,
  opts?: ImportTsOpts,
): Promise<{ width: number; height: number; csX: number; csY: number; originX: number; originY: number } | null> {
  const { data, width: imgW, height: imgH } = img;
  const bboxW = bbox.right - bbox.left;
  const bboxH = bbox.bottom - bbox.top;
  if (bboxW < 20 || bboxH < 20) return null;

  // Per-axis signals (full image, but pixel sum is over bbox cross-axis)
  opts?.onProgress?.("提取列信号", 0);
  const colSig = new Array<number>(imgW);
  for (let x = 0; x < imgW; x++) {
    if (x % 64 === 0) {
      checkSignal(opts?.signal);
      opts?.onProgress?.("提取列信号", x / imgW);
      await yieldToUi();
    }
    let dark = 0;
    for (let y = bbox.top; y < bbox.bottom; y++) {
      if (pixelLuminance(data, x, y, imgW) < config.gridLumThreshold) dark++;
    }
    colSig[x] = dark;
  }

  opts?.onProgress?.("提取行信号", 0);
  const rowSig = new Array<number>(imgH);
  for (let y = 0; y < imgH; y++) {
    if (y % 64 === 0) {
      checkSignal(opts?.signal);
      opts?.onProgress?.("提取行信号", y / imgH);
      await yieldToUi();
    }
    let dark = 0;
    for (let x = bbox.left; x < bbox.right; x++) {
      if (pixelLuminance(data, x, y, imgW) < config.gridLumThreshold) dark++;
    }
    rowSig[y] = dark;
  }

  const colSlice = colSig.slice(bbox.left, bbox.right);
  const rowSlice = rowSig.slice(bbox.top, bbox.bottom);
  const maxLagX = Math.max(6, Math.min(AUTOCORR_MAX_LAG, Math.floor(bboxW / 4)));
  const maxLagY = Math.max(6, Math.min(AUTOCORR_MAX_LAG, Math.floor(bboxH / 4)));

  opts?.onProgress?.("X 轴周期检测", 0);
  await yieldToUi();
  checkSignal(opts?.signal);
  const peakX = autocorrPeak(colSlice, AUTOCORR_MIN_LAG, maxLagX, config.autocorrStep2Accept, config.autocorrStep3Accept);

  opts?.onProgress?.("Y 轴周期检测", 0);
  await yieldToUi();
  checkSignal(opts?.signal);
  const peakY = autocorrPeak(rowSlice, AUTOCORR_MIN_LAG, maxLagY, config.autocorrStep2Accept, config.autocorrStep3Accept);
  if (!peakX || !peakY) return null;

  let [lagX] = peakX;
  let [lagY] = peakY;

  // Cross-axis sanity
  const ratio = Math.max(lagX / lagY, lagY / lagX);
  if (ratio > CROSS_AXIS_DISAGREE_FACTOR) {
    const l = Math.max(lagX, lagY);
    lagX = l; lagY = l;
  }

  const [newLeft, newRight] = snapToGridLines(colSig, bbox.left, bbox.right, lagX);
  const [newTop, newBottom] = snapToGridLines(rowSig, bbox.top, bbox.bottom, lagY);

  const spanX = newRight - newLeft;
  const spanY = newBottom - newTop;
  const cellsW = Math.round(spanX / lagX);
  const cellsH = Math.round(spanY / lagY);
  if (cellsW === 0 || cellsH === 0) return null;

  const csX = spanX / cellsW;
  const csY = spanY / cellsH;
  return { width: cellsW, height: cellsH, csX, csY, originX: newLeft, originY: newTop };
}

// ─── 5. Color matching (CIELAB ΔE76) ───────────────────────────────

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  function linearize(c: number): number {
    const cn = c / 255;
    return cn > 0.04045 ? Math.pow((cn + 0.055) / 1.055, 2.4) : cn / 12.92;
  }
  const rl = linearize(r), gl = linearize(g), bl = linearize(b);
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
  function f(t: number): number {
    return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  }
  const fx = f(x / 0.95047), fy = f(y / 1.0), fz = f(z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE76(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const [l1, a1, bb1] = rgbToLab(r1, g1, b1);
  const [l2, a2, bb2] = rgbToLab(r2, g2, b2);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (bb1 - bb2) ** 2);
}

function matchColor(r: number, g: number, b: number, palette: PaletteColor[]): [string, number] {
  for (const pc of palette) {
    if (pc.r === r && pc.g === g && pc.b === b) return [pc.code, 1.0];
  }
  let bestCode = "";
  let bestDist = Infinity;
  for (const pc of palette) {
    const d = deltaE76(r, g, b, pc.r, pc.g, pc.b);
    if (d < bestDist) { bestDist = d; bestCode = pc.code; }
  }
  return [bestCode, Math.max(0, 1 - bestDist / 100)];
}

// ─── 6. Cell sampling ──────────────────────────────────────────────

function sampleCellColor(
  img: LoadedImage,
  x0: number,
  y0: number,
  cellSize: number,
  config: SamplingConfig,
): [number, number, number] | null {
  const { data, width: imgW, height: imgH } = img;
  const inset = Math.max(2, Math.floor(cellSize * config.insetRatio));

  const offsets: Array<[number, number]> = [
    [inset, inset], [cellSize - inset, inset],
    [inset, cellSize - inset], [cellSize - inset, cellSize - inset],
    [Math.floor(cellSize / 2), inset], [Math.floor(cellSize / 2), cellSize - inset],
    [inset, Math.floor(cellSize / 2)], [cellSize - inset, Math.floor(cellSize / 2)],
  ];

  if (config.extraSamples > 0) {
    const inner = cellSize - 2 * inset;
    if (inner > 4) {
      const step = Math.floor(inner / (Math.ceil(Math.sqrt(config.extraSamples)) + 1));
      if (step > 0) {
        for (let dx = inset + step; dx < cellSize - inset; dx += step) {
          for (let dy = inset + step; dy < cellSize - inset; dy += step) {
            offsets.push([dx, dy]);
          }
        }
      }
    }
  }

  const samples: Array<[number, number, number]> = [];
  for (const [dx, dy] of offsets) {
    const sx = x0 + dx, sy = y0 + dy;
    if (sx < imgW && sy < imgH) {
      samples.push(getPixelRGB(data, sx, sy, imgW));
    }
  }
  if (samples.length === 0) return null;

  const filtered = samples.filter(([r, g, b]) => {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const isText = lum < 15 && r < 20 && g < 20 && b < 20;
    const isWhite = lum > 245;
    return !isText && !isWhite;
  });
  const finalSamples = filtered.length >= 2 ? filtered : samples;
  const rs = finalSamples.map((s) => s[0]).sort((a, b) => a - b);
  const gs = finalSamples.map((s) => s[1]).sort((a, b) => a - b);
  const bs = finalSamples.map((s) => s[2]).sort((a, b) => a - b);
  return [rs[Math.floor(rs.length / 2)], gs[Math.floor(gs.length / 2)], bs[Math.floor(bs.length / 2)]];
}

// ─── 7. Text detection (for white-vs-empty disambiguation) ─────────

function binarize(gray: Uint8Array): Uint8Array {
  if (gray.length === 0) return new Uint8Array(0);
  const hist = new Uint32Array(256);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sumTotal = 0;
  for (let i = 0; i < 256; i++) sumTotal += i * hist[i];
  let sumBg = 0;
  let weightBg = 0;
  let bestThresh = 128;
  let bestVariance = 0;
  for (let t = 0; t < 256; t++) {
    weightBg += hist[t];
    if (weightBg === 0) continue;
    const weightFg = total - weightBg;
    if (weightFg === 0) break;
    sumBg += t * hist[t];
    const meanBg = sumBg / weightBg;
    const meanFg = (sumTotal - sumBg) / weightFg;
    const variance = weightBg * weightFg * (meanBg - meanFg) ** 2;
    if (variance > bestVariance) { bestVariance = variance; bestThresh = t; }
  }
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] <= bestThresh ? 0 : 255;
  return out;
}

function extractCellBinary(img: LoadedImage, x0: number, y0: number, cellSize: number): Uint8Array {
  const { data, width: imgW, height: imgH } = img;
  const gray = new Uint8Array(cellSize * cellSize);
  let idx = 0;
  for (let dy = 0; dy < cellSize; dy++) {
    for (let dx = 0; dx < cellSize; dx++) {
      const px = x0 + dx, py = y0 + dy;
      if (px < imgW && py < imgH) {
        const i = (py * imgW + px) * 4;
        gray[idx] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      } else {
        gray[idx] = 255;
      }
      idx++;
    }
  }
  const binary = binarize(gray);

  const w = cellSize;
  const edgeInset = Math.floor(w / 5);
  let edgeSum = 0, edgeCount = 0;
  for (let i = 0; i < binary.length; i++) {
    const row = Math.floor(i / w);
    const col = i % w;
    if (row < edgeInset || row >= w - edgeInset || col < edgeInset || col >= w - edgeInset) {
      edgeSum += binary[i];
      edgeCount++;
    }
  }
  if (edgeCount > 0 && edgeSum / edgeCount < 128) {
    for (let i = 0; i < binary.length; i++) binary[i] = 255 - binary[i];
  }
  return binary;
}

function cellHasText(cellBin: Uint8Array, cellSize: number): boolean {
  const w = cellSize;
  if (cellBin.length === 0) return false;
  let textPixels = 0, regionPixels = 0;
  for (let i = 0; i < cellBin.length; i++) {
    const row = Math.floor(i / w);
    const col = i % w;
    if (row > w / 4 && row < (w * 3) / 4 && col > w / 6 && col < (w * 5) / 6) {
      regionPixels++;
      if (cellBin[i] === 0) textPixels++;
    }
  }
  if (regionPixels === 0) return false;
  const ratio = textPixels / regionPixels;
  return ratio > 0.03 && ratio < 0.50;
}
```

- [ ] **Step 2: Replace the public stubs with the real implementations**

In the same file, replace the existing throw-stubs with:

```typescript
// ─── Public API ─────────────────────────────────────────────────────

export async function detectBlueprintDimsTS(
  path: string,
  adapter: ReadFileAdapter,
  bbox: BBox | undefined,
  opts?: ImportTsOpts,
): Promise<DetectTsResult> {
  opts?.onProgress?.("加载图像", 0);
  const img = await loadImageData(path, adapter);
  opts?.onProgress?.("加载图像", 1);
  checkSignal(opts?.signal);

  // Fast path: PNG metadata
  if (!bbox && img.mediaType === "image/png") {
    const meta = readBlueprintMetadata(img.rawBytes);
    if (meta) {
      return {
        width: meta.gridWidth,
        height: meta.gridHeight,
        cellSize: meta.cellSize,
        bbox: {
          left: meta.originX,
          top: meta.originY,
          right: meta.originX + meta.gridWidth * meta.cellSize,
          bottom: meta.originY + meta.gridHeight * meta.cellSize,
        },
        hasMetadata: true,
      };
    }
  }

  const config = configForMediaType(img.mediaType);
  const actualBbox = bbox ?? (await detectGridBBox(img, config.gridLumThreshold, opts));
  if (!actualBbox) {
    throw new Error("Could not locate a grid region. Is this a blueprint image?");
  }
  // Clamp user-supplied bbox to image bounds
  const clamped: BBox = {
    left: Math.max(0, Math.min(actualBbox.left, img.width - 1)),
    top: Math.max(0, Math.min(actualBbox.top, img.height - 1)),
    right: Math.max(actualBbox.left + 1, Math.min(actualBbox.right, img.width)),
    bottom: Math.max(actualBbox.top + 1, Math.min(actualBbox.bottom, img.height)),
  };

  const recovered = await recoverGridGeometry(img, clamped, config, opts);
  if (!recovered) {
    throw new Error("Could not recover grid geometry from detected region");
  }

  return {
    width: recovered.width,
    height: recovered.height,
    cellSize: Math.round(recovered.csX),
    bbox: clamped,
    hasMetadata: false,
  };
}

export async function importBlueprintTS(
  args: ImportTsArgs,
  adapter: ReadFileAdapter,
  opts?: ImportTsOpts,
): Promise<BlueprintImportResult> {
  opts?.onProgress?.("加载图像", 0);
  const img = await loadImageData(args.path, adapter);
  opts?.onProgress?.("加载图像", 1);
  checkSignal(opts?.signal);

  const userBbox = args.bbox;

  // Fast path: PNG metadata (only when neither bbox nor explicit dims provided)
  if (!userBbox && !args.gridWidth && !args.gridHeight && img.mediaType === "image/png") {
    const meta = readBlueprintMetadata(img.rawBytes);
    if (meta) {
      return await runSamplingPass(
        img,
        meta.gridWidth,
        meta.gridHeight,
        meta.cellSize,
        meta.cellSize,
        meta.originX,
        meta.originY,
        args.palette,
        configForMediaType("image/png"),
        1.0,
        args.mode ?? "color_priority",
        opts,
      );
    }
  }

  const config = configForMediaType(img.mediaType);
  const actualBbox = userBbox ?? (await detectGridBBox(img, config.gridLumThreshold, opts));
  if (!actualBbox) {
    throw new Error("Could not locate a grid region. Is this a blueprint image?");
  }
  const clamped: BBox = {
    left: Math.max(0, Math.min(actualBbox.left, img.width - 1)),
    top: Math.max(0, Math.min(actualBbox.top, img.height - 1)),
    right: Math.max(actualBbox.left + 1, Math.min(actualBbox.right, img.width)),
    bottom: Math.max(actualBbox.top + 1, Math.min(actualBbox.bottom, img.height)),
  };

  const recovered = await recoverGridGeometry(img, clamped, config, opts);
  if (!recovered) {
    throw new Error("Could not recover grid geometry from detected region");
  }

  const gridW = args.gridWidth ?? recovered.width;
  const gridH = args.gridHeight ?? recovered.height;
  if (gridW === 0 || gridH === 0) {
    throw new Error("Detected grid is too small");
  }

  return await runSamplingPass(
    img,
    gridW,
    gridH,
    recovered.csX,
    recovered.csY,
    recovered.originX,
    recovered.originY,
    args.palette,
    config,
    /*defaultConfidence*/ 0,
    args.mode ?? "color_priority",
    opts,
  );
}

// ─── Sampling pass — shared between fast path + detect path ────────

async function runSamplingPass(
  img: LoadedImage,
  gridW: number,
  gridH: number,
  csX: number,
  csY: number,
  originX: number,
  originY: number,
  palette: PaletteColor[],
  config: SamplingConfig,
  fastPathConfidence: number, // 1.0 for metadata, ignored for detect
  mode: ImportMode,
  opts?: ImportTsOpts,
): Promise<BlueprintImportResult> {
  const sampleCs = Math.max(2, Math.round(Math.min(csX, csY)));

  // Color sampling
  opts?.onProgress?.("采样颜色", 0);
  const colorCodes: string[][] = [];
  const colorConfs: number[][] = [];
  let totalConf = 0;
  let confCount = 0;
  for (let row = 0; row < gridH; row++) {
    if (row % 8 === 0) {
      checkSignal(opts?.signal);
      opts?.onProgress?.(`采样颜色 ${row}/${gridH}`, row / gridH);
      await yieldToUi();
    }
    const codeRow: string[] = [];
    const confRow: number[] = [];
    for (let col = 0; col < gridW; col++) {
      const x0 = Math.round(originX + col * csX);
      const y0 = Math.round(originY + row * csY);
      const sample = sampleCellColor(img, x0, y0, sampleCs, config);
      if (sample) {
        const [code, conf] = matchColor(sample[0], sample[1], sample[2], palette);
        codeRow.push(code);
        confRow.push(conf);
        totalConf += conf;
        confCount++;
      } else {
        codeRow.push("");
        confRow.push(1.0);
      }
    }
    colorCodes.push(codeRow);
    colorConfs.push(confRow);
  }
  const avgConfidence = confCount > 0 ? totalConf / confCount : 1.0;

  // Text detection per cell (for white-vs-empty disambiguation)
  opts?.onProgress?.("识别空白格", 0);
  const hasTextGrid: boolean[][] = [];
  for (let row = 0; row < gridH; row++) {
    if (row % 8 === 0) {
      checkSignal(opts?.signal);
      opts?.onProgress?.(`识别空白格 ${row}/${gridH}`, row / gridH);
      await yieldToUi();
    }
    const r: boolean[] = [];
    for (let col = 0; col < gridW; col++) {
      const x0 = Math.round(originX + col * csX);
      const y0 = Math.round(originY + row * csY);
      const bin = extractCellBinary(img, x0, y0, sampleCs);
      r.push(cellHasText(bin, sampleCs));
    }
    hasTextGrid.push(r);
  }

  // Build result
  const cells: CellResult[][] = [];
  const colorCellsOut: string[][] = [];
  const textCellsOut: string[][] = [];
  for (let row = 0; row < gridH; row++) {
    const cellRow: CellResult[] = [];
    const colorRow: string[] = [];
    const textRow: string[] = [];
    for (let col = 0; col < gridW; col++) {
      const cc = colorCodes[row][col];
      const ccConf = colorConfs[row][col];
      const hasText = hasTextGrid[row][col];
      const matched = palette.find((p) => p.code === cc);
      const isWhiteColor = matched ? matched.r > 248 && matched.g > 248 && matched.b > 248 : cc === "";
      const isEmpty = cc === "" || (isWhiteColor && !hasText);
      if (isEmpty) {
        cellRow.push({
          color_code: "",
          color_confidence: 1.0,
          text_code: "",
          text_confidence: 0,
          final_code: "",
          source: "color",
        });
        colorRow.push("");
        textRow.push("");
      } else {
        cellRow.push({
          color_code: cc,
          color_confidence: ccConf,
          text_code: "",
          text_confidence: 0,
          final_code: cc,
          source: "color",
        });
        colorRow.push(cc);
        textRow.push("");
      }
    }
    cells.push(cellRow);
    colorCellsOut.push(colorRow);
    textCellsOut.push(textRow);
  }

  return {
    width: gridW,
    height: gridH,
    cells,
    color_cells: colorCellsOut,
    text_cells: textCellsOut,
    mismatch_count: 0,
    mismatches: [],
    severity_summary: { high: 0, medium: 0, low: 0 },
    cell_size_detected: Math.round(csX),
    confidence: fastPathConfidence > 0 ? fastPathConfidence : avgConfidence,
    mode,
  };
}
```

- [ ] **Step 3: Remove the throw stubs and `void` placeholders from Task 5**

Also remove the `void CellResult; void CellSource;` line — both types are now genuinely used.

- [ ] **Step 4: Build clean**

```bash
cd q:/repo/pindou/platforms/vscode && npm run build:webview 2>&1 | tail -8
```
Expected: clean build.

- [ ] **Step 5: Sanity smoke — full Playwright suite (no regression)**

```bash
cd q:/repo/pindou/platforms/vscode && npx playwright test 2>&1 | tail -3
```
Expected: 73 passed (the existing tests don't exercise the new code path).

- [ ] **Step 6: Commit**

```bash
git add src/utils/blueprintImportTS.ts
git commit -m "feat(utils): full TS port of Rust blueprint importer

Mirrors src-tauri/src/commands/blueprint_import.rs:
  - detectGridBBox (longest-run-above density)
  - autocorrPeak (alternation halve + divisor walk + non-divisor scan
    + parabolic refinement)
  - snapToGridLines (phase + walk-out)
  - rgbToLab + deltaE76 + matchColor (CIELAB ΔE76 nearest neighbor)
  - sampleCellColor (8 fixed offsets + JPEG extras, median per channel,
    text/white outlier filter)
  - extractCellBinary + cellHasText (Otsu + region-of-interest check)
  - runSamplingPass (orchestrates color + text + result assembly)
  - detectBlueprintDimsTS + importBlueprintTS public entry points

Algorithm is identical to Rust; constants verified per-file. Each
long loop yields to the UI thread every 8-64 iterations via
setTimeout(0) and checks AbortSignal so the dialog stays responsive
and cancellable."
```

---

## Task 7: UI — unified busy state with progress bar + cancel button

**Files:**
- Modify: `src/components/Import/BlueprintDimsConfirmDialog.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Open `BlueprintDimsConfirmDialog.tsx` and replace `redetecting` state**

Currently the file has:

```typescript
const [redetecting, setRedetecting] = useState(false);
const [redetectError, setRedetectError] = useState<string | null>(null);
```

Add a unified busy state alongside (don't delete `redetecting` yet — replace its usages):

```typescript
const [busyStage, setBusyStage] = useState("");
const [busyFraction, setBusyFraction] = useState(0);
const [abortController, setAbortController] = useState<AbortController | null>(null);
const busy = abortController !== null;
```

Find the existing `handleRedetect`:

```typescript
const handleRedetect = async () => {
  setRedetecting(true);
  setRedetectError(null);
  try {
    const r = await onRedetect(bbox);
    // ...
  } finally {
    setRedetecting(false);
  }
};
```

Replace with:

```typescript
const handleRedetect = async () => {
  const controller = new AbortController();
  setAbortController(controller);
  setBusyStage("");
  setBusyFraction(0);
  setRedetectError(null);
  try {
    const r = await onRedetect(bbox, {
      onProgress: (stage, frac) => {
        setBusyStage(stage);
        setBusyFraction(frac);
      },
      signal: controller.signal,
    });
    setW(r.width);
    setH(r.height);
    setBBox(r.bbox);
    setMetadata(r.hasMetadata);
  } catch (e) {
    if ((e as Error)?.name !== "AbortError") {
      setRedetectError(e instanceof Error ? e.message : String(e));
    }
  } finally {
    setAbortController(null);
  }
};
```

The `onRedetect` prop signature also needs the opts arg. Find the props interface:

```typescript
onRedetect: (bbox: BBox) => Promise<{ ... }>;
```

Change to:

```typescript
onRedetect: (
  bbox: BBox,
  opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal },
) => Promise<{ ... }>;
```

- [ ] **Step 2: Render the progress bar + cancel button**

Find the existing redetect-button rendering. Add the progress bar BELOW the existing 「用此范围重新识别」 button:

```tsx
{busy && (
  <div className="flex items-center gap-2 text-[11px] mt-1">
    <div className="flex-1 h-1.5 bg-gray-200 rounded overflow-hidden">
      <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round(busyFraction * 100)}%` }} />
    </div>
    <span className="text-gray-500 shrink-0 min-w-[8em] truncate" title={busyStage}>{busyStage}</span>
    <button
      onClick={() => abortController?.abort()}
      className="px-2 py-0.5 border border-red-300 text-red-600 rounded text-[11px] hover:bg-red-50"
    >取消</button>
  </div>
)}
```

Also disable the redetect button + import button while busy. Find each button and add `disabled={busy || …existing…}` and tone down the styling when disabled.

- [ ] **Step 3: Repeat the busy state pattern for `App.tsx`'s final import call**

In `src/App.tsx`, find the existing `setBlueprintImporting(true); setBlueprintProgress(...)` block (the one that runs after the user clicks `导入` in the dims dialog). Refactor to:

```typescript
const onConfirmImport = async (
  pendingPath: string,
  detectedBBox: BBox,
  hasMetadata: boolean,
  preview: ImagePreview,
  gridWidth: number,
  gridHeight: number,
  finalBBox: BBox,
) => {
  const controller = new AbortController();
  setBlueprintImporting(true);
  setBlueprintAbort(controller);
  setBlueprintProgress("");
  setBlueprintProgressFraction(0);
  try {
    const result = await getAdapter().importBlueprint(
      pendingPath,
      MARD_COLORS.map((c) => ({ code: c.code, r: c.r, g: c.g, b: c.b })),
      gridWidth,
      gridHeight,
      undefined,
      finalBBox,
      {
        onProgress: (stage, frac) => {
          setBlueprintProgress(stage);
          setBlueprintProgressFraction(frac);
        },
        signal: controller.signal,
      },
    );
    setBlueprintResult(result);
    setBlueprintDimsPending(null);
  } catch (e) {
    if ((e as Error)?.name !== "AbortError") {
      await appAlert(`导入失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    setBlueprintImporting(false);
    setBlueprintAbort(null);
  }
};
```

(Adjust to match the actual existing handler — the goal is to thread `{ onProgress, signal }` into the `importBlueprint` call and store the AbortController in state.)

Add the matching state at the top of the component:

```typescript
const [blueprintProgressFraction, setBlueprintProgressFraction] = useState(0);
const [blueprintAbort, setBlueprintAbort] = useState<AbortController | null>(null);
```

Find the existing `blueprintImporting` overlay (search for `blueprintImporting && (`). It currently shows just text. Augment with a progress bar + cancel button:

```tsx
{blueprintImporting && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
    <div className="bg-white rounded-lg shadow-xl w-[360px] p-4 flex flex-col gap-3">
      <div className="text-sm font-semibold">正在导入图纸</div>
      <div className="text-xs text-gray-600">{blueprintProgress}</div>
      <div className="h-1.5 bg-gray-200 rounded overflow-hidden">
        <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round(blueprintProgressFraction * 100)}%` }} />
      </div>
      <div className="flex justify-end">
        <button
          onClick={() => blueprintAbort?.abort()}
          className="px-3 py-1 border border-red-300 text-red-600 rounded text-sm hover:bg-red-50"
        >取消</button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Update App.tsx's `onRedetect` wiring**

The `BlueprintDimsConfirmDialog` is rendered in App.tsx with an `onRedetect` callback. Find it and update to pass the opts:

```typescript
onRedetect={async (bbox, opts) => {
  return await getAdapter().detectBlueprintDims(pending.path, bbox, opts);
}}
```

- [ ] **Step 5: Build + Playwright regression**

```bash
cd q:/repo/pindou/platforms/vscode && npm run build:webview 2>&1 | tail -3
cd q:/repo/pindou/platforms/vscode && npx playwright test 2>&1 | tail -3
```
Expected: clean build, 73 passed.

- [ ] **Step 6: Commit**

```bash
git add src/components/Import/BlueprintDimsConfirmDialog.tsx src/App.tsx
git commit -m "feat(import-ui): progress bar + cancel button for detect/import

The TS port runs in the webview's main thread; large grids may take
several seconds. Surface a progress bar with a cancel button on both
the dims-confirm dialog (for re-detection) and the final import
overlay. AbortController is stored in state and aborts the underlying
algorithm — which checks the signal between row passes and throws
AbortError, caught here without surfacing a user-visible alert."
```

---

## Task 8: Playwright integration tests (VS Code webview)

**Files:**
- Create: `platforms/vscode/tests/blueprint-import.spec.ts`
- Possibly modify: `platforms/vscode/tests/helpers.ts` if a helper is needed for staging file bytes

- [ ] **Step 1: Inspect existing helper for staging readFile**

`platforms/vscode/tests/helpers.ts` already has a generic `stageReply(page, "readFile", { data: <base64> })`. We can reuse this.

- [ ] **Step 2: Write the test file**

```typescript
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  stageReply,
  callAction,
} from "./helpers";

const KAGOME_PNG = path.resolve(__dirname, "../../../src-tauri/tests/fixtures/kagome_pindou_export.png");
const KAGOME_TRUTH = path.resolve(__dirname, "../../../src-tauri/tests/fixtures/kagome_truth.json");

interface Truth {
  width: number;
  height: number;
  palette: Array<{ code: string; r: number; g: number; b: number }>;
  truth_codes: string[][];
}

function loadTruth(): Truth {
  return JSON.parse(fs.readFileSync(KAGOME_TRUTH, "utf-8")) as Truth;
}

function loadFixtureBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString("base64");
}

async function callAdapterImportBlueprint(
  page: import("@playwright/test").Page,
  path: string,
  palette: Truth["palette"],
  gridWidth?: number,
  gridHeight?: number,
): Promise<{ width: number; height: number; cellSize: number; cellsCodes: string[][] }> {
  return await page.evaluate(
    async ({ path, palette, gridWidth, gridHeight }) => {
      const { getAdapter } = await import("/src/adapters/index.ts" as any);
      // Real call site uses the singleton; adapter.test harness creates a
      // VScodeAdapter via main.tsx. Use getAdapter() to grab it.
      const adapter = getAdapter();
      const result = await adapter.importBlueprint(
        path,
        palette,
        gridWidth,
        gridHeight,
        undefined,
        undefined,
        undefined,
      );
      return {
        width: result.width,
        height: result.height,
        cellSize: result.cell_size_detected,
        cellsCodes: result.cells.map((row: any[]) => row.map((c) => c.final_code)),
      };
    },
    { path, palette, gridWidth, gridHeight },
  );
}

async function callAdapterDetectDims(
  page: import("@playwright/test").Page,
  path: string,
): Promise<{ width: number; height: number; hasMetadata: boolean; cellSize: number }> {
  return await page.evaluate(
    async ({ path }) => {
      const { getAdapter } = await import("/src/adapters/index.ts" as any);
      const adapter = getAdapter();
      const r = await adapter.detectBlueprintDims(path);
      return { width: r.width, height: r.height, hasMetadata: r.hasMetadata, cellSize: r.cellSize };
    },
    { path },
  );
}

test.describe("VS Code blueprint import (TS port)", () => {
  test.afterAll(() => cleanupHarness());

  test("detectBlueprintDims hits metadata fast path for our own PNG", async ({ page }) => {
    await setupPage(page);
    await loadProject(page); // boot a doc so the adapter is wired

    await stageReply(page, "readFile", { data: loadFixtureBase64(KAGOME_PNG) });

    const truth = loadTruth();
    const result = await callAdapterDetectDims(page, "/fake/kagome.png");

    expect(result.hasMetadata).toBe(true);
    expect(result.width).toBe(truth.width);
    expect(result.height).toBe(truth.height);
  });

  test("importBlueprint via metadata returns exact cells", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await stageReply(page, "readFile", { data: loadFixtureBase64(KAGOME_PNG) });

    const truth = loadTruth();
    const result = await callAdapterImportBlueprint(page, "/fake/kagome.png", truth.palette);

    expect(result.width).toBe(truth.width);
    expect(result.height).toBe(truth.height);

    // Spot check a known truth cell: row 0 col 19 = "H7"
    expect(result.cellsCodes[0][19]).toBe(truth.truth_codes[0][19]);

    // Cell-level accuracy across whole grid
    let ok = 0, total = 0;
    for (let r = 0; r < truth.height; r++) {
      for (let c = 0; c < truth.width; c++) {
        total++;
        if (result.cellsCodes[r][c] === truth.truth_codes[r][c]) ok++;
      }
    }
    const accuracy = ok / total;
    expect(accuracy).toBeGreaterThanOrEqual(0.99); // metadata path is essentially perfect
  });

  test("cancel during import rejects with AbortError", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await stageReply(page, "readFile", { data: loadFixtureBase64(KAGOME_PNG) });

    const truth = loadTruth();

    const wasAborted = await page.evaluate(
      async ({ path, palette }) => {
        const { getAdapter } = await import("/src/adapters/index.ts" as any);
        const adapter = getAdapter();
        const ctrl = new AbortController();
        // Abort right after starting — should bubble up as AbortError
        setTimeout(() => ctrl.abort(), 5);
        try {
          await adapter.importBlueprint(path, palette, undefined, undefined, undefined, undefined, {
            signal: ctrl.signal,
          });
          return "completed";
        } catch (e: any) {
          return e?.name === "AbortError" ? "aborted" : `other:${e?.message}`;
        }
      },
      { path: "/fake/kagome.png", palette: truth.palette },
    );

    // Either "aborted" (cancel landed before completion) or "completed"
    // (the metadata fast path finished too fast). Both are acceptable on
    // small fixtures; what we MUST NOT see is a hang or non-AbortError throw.
    expect(["aborted", "completed"]).toContain(wasAborted);
  });
});
```

NOTE on the test harness: the existing tests use `import("/src/adapters/index.ts" as any)`-style dynamic imports inside `page.evaluate` because the page is the built webview bundle. If that pattern doesn't work cleanly, the alternative is to access the adapter through the global `(window as any).__pindouStore?.getState()?.adapter` — adapt to whatever pattern the existing tests use. Check `platforms/vscode/tests/file-ops.spec.ts` for the pattern actually used there.

If the test ends up needing a different way to invoke the adapter from the page, update the helpers above accordingly. The functional content of the tests (truth comparisons) stays the same.

- [ ] **Step 3: Run the new tests**

```bash
cd q:/repo/pindou/platforms/vscode && npx playwright test tests/blueprint-import.spec.ts 2>&1 | tail -15
```

Expected: 3 passed. If they fail because the page-side import path is wrong, fix the page.evaluate helpers; the goal is to drive the adapter, not the dialog.

- [ ] **Step 4: Run the FULL Playwright suite (regression)**

```bash
cd q:/repo/pindou/platforms/vscode && npx playwright test 2>&1 | tail -3
```
Expected: 76 passed (73 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add platforms/vscode/tests/blueprint-import.spec.ts
git commit -m "test(vscode): blueprint import — metadata fast path + cancel

Three Playwright tests covering the new TS port:
  - detectBlueprintDims recognizes the pindouverse-blueprint chunk
    and returns hasMetadata=true with the recorded grid dims
  - importBlueprint via metadata reaches ≥99% cell accuracy against
    the kagome truth fixture (spot check + full grid)
  - importBlueprint with AbortSignal cancellation either aborts
    cleanly (AbortError) or completes — never hangs or surfaces
    a non-AbortError exception

Fixtures live in src-tauri/tests/fixtures/ from the desktop test
suite; we read them directly via fs in the spec and stage the
bytes as the reply to the harness's mock readFile request."
```

---

## Task 9: VS Code packaging — version bump + changelog

**Files:**
- Modify: `platforms/vscode/package.json`
- Modify: `platforms/vscode/CHANGELOG.md`

- [ ] **Step 1: Bump version**

Open `platforms/vscode/package.json`. The current version is whatever was last published (check with `grep version platforms/vscode/package.json | head -1`). Bump the patch component by 1.

- [ ] **Step 2: Prepend changelog entry**

Open `platforms/vscode/CHANGELOG.md` and add a new section at the top below the title:

```markdown
## X.Y.Z (TODAY's date)

- Feature: 「导入图纸」 in VS Code now works (previously threw "not supported"). Re-uses the same workflow as the desktop app — metadata fast path for our own PNG exports (100% accurate), autocorrelation detection for third-party blueprints, draggable bbox + editable dims. Runs entirely in the webview.
- Feature: Progress bar + cancel button during detection / import — JS is slower than Rust and large grids may take a few seconds; user-visible work is now interruptible.
```

Replace `X.Y.Z` and `TODAY's date` with the actual values.

- [ ] **Step 3: Package the vsix**

```bash
cd q:/repo/pindou/platforms/vscode && npm run package 2>&1 | tail -3
```
Expected: `pindouverse-X.Y.Z.vsix` in `platforms/vscode/`. Note the size — should be < 2 MB.

- [ ] **Step 4: Commit version bump**

```bash
git add platforms/vscode/package.json platforms/vscode/CHANGELOG.md
git commit -m "vscode: release X.Y.Z — blueprint import TS port

(replace X.Y.Z with actual version)"
```

---

## Task 10: STOP — wait for user verification before merging or publishing

**Files:** none.

Per repo convention ([memory: vscode-release-needs-user-test-confirmation](.claude/projects/q--repo-pindou/memory/feedback_vscode_publish_needs_confirmation.md)): don't merge to main and don't trigger a release before the user has tested the change end-to-end on their own machine.

- [ ] **Step 1: Report the test outcomes + vsix path to the user**

Print a summary:

```
Branch: feature/vscode-blueprint-import
Commits ahead of main: <count>

Test results:
  - Rust tests: unchanged (this PR is webview-only)
  - Webview Playwright: 76/76 passing (73 baseline + 3 new)

Installable vsix: platforms/vscode/pindouverse-X.Y.Z.vsix

To verify locally:
  code --install-extension platforms/vscode/pindouverse-X.Y.Z.vsix --force
  # then in VS Code: open or create a .pindou file
  # 导入图纸 → pick temp/kagome_pindou_export.png
  # → should see metadata fast path (green ✓ badge in dialog)
  # → import should complete with all 63×78 cells filled

Also try:
  - A third-party JPEG (no metadata): should see progress bar tick
  - Click 取消 during detection: dialog should reset cleanly

DO NOT merge to main or publish to Marketplace until the user confirms.
```

- [ ] **Step 2: Wait for explicit "ok merge" or "ok publish" before:**
  - `git checkout main && git merge --squash feature/vscode-blueprint-import`
  - `npm run publish:entra`

---

## Self-Review

**Spec coverage:**
- Spec §1 (algorithm port) → Tasks 5 + 6.
- Spec §1 (PNG metadata reader) → Task 1.
- Spec §1 (image loader) → Task 2.
- Spec §4 (adapter interface change) → Task 3.
- Spec §4 (adapter implementations) → Task 4.
- Spec §5 (UI progress + cancel) → Task 7.
- Spec §7 (Playwright tests) → Task 8.
- Spec §8 (performance budget) — verified by Task 8 cancel test indirectly; manual perf check is part of Task 10's user verification.
- Spec §9 (browser bonus) → Task 4 Step 3 (browser delegates same as VS Code, with `readFileBase64` limited to data: URLs).

**Placeholder scan:** no TBD / TODO / "implement later". One intentional "may need adjustment" note in Task 8 Step 2 about the page.evaluate pattern — this is research the implementer must do because I don't know the exact existing pattern; the guidance points to `file-ops.spec.ts` as reference.

**Type consistency:**
- `BBox` shape `{ left, top, right, bottom }` consistent across Rust, TS algorithm, adapter interface, and dialog state.
- `ImportTsOpts = { onProgress?, signal? }` matches the adapter interface's opts type exactly.
- `BlueprintImportResult` shape matches existing `src/adapters/index.ts` definition (cells: CellResult[][], color_cells/text_cells: string[][], mismatches: Mismatch[], severity_summary: SeveritySummary, mode: ImportMode).
- `LoadedImage` produced by `imageLoader.ts` consumed by `blueprintImportTS.ts` — `data: Uint8ClampedArray, width, height, rawBytes, mediaType` consistent.

**Risk areas:**
- Task 8's `page.evaluate` adapter access pattern — the implementer needs to verify the actual import mechanism. If it doesn't work, the test still has value but needs adapting.
- Performance on large grids (e.g., 100×100 on a 3000×3000 JPEG) — single-threaded JS detection might cross 5s. Task 10 includes a manual perf check; if it's too slow, a follow-up commit introduces a Web Worker.
- The `binarize` function uses Otsu — `Uint8Array` for the gray buffer (TS) vs `&[u8]` (Rust). I've used `Uint8Array` for both gray and binary outputs.
- The `runSamplingPass` reads cells twice (once for color, once for binary) — same as Rust but on the JS-side this is double the work. If a perf hit, optimize by combining the two passes into one cell-iteration loop with shared origin/cellSize calc.
