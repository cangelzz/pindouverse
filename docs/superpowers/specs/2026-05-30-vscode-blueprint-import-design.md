# VS Code Blueprint Import — Full TS Port

**Date**: 2026-05-30
**Status**: Approved, drafting plan
**Branch**: `feature/vscode-blueprint-import`
**Scope**: VS Code extension webview (+ browser as a bonus). Tauri desktop unchanged.

## Problem

The VS Code extension currently throws "not supported" for `importBlueprint` and `detectBlueprintDims`. The user wants the same blueprint-import workflow as the desktop app: metadata fast path, autocorrelation detection, draggable bbox, color sampling.

The desktop implementation lives in Rust (`src-tauri/src/commands/blueprint_import.rs`, ~1100 LOC). The VS Code webview has no Rust backend — needs a TypeScript port of the algorithm.

## Goal

Re-implement the blueprint import pipeline in TypeScript so the VS Code extension supports:

1. **PNG metadata fast path** — read `pindouverse-blueprint` tEXt chunk, sample at exact recorded coords, 100% accurate reconstruction of our own PNG exports.
2. **Detection path** — for third-party PNGs and JPEGs: `detect_grid_bbox` (per-axis dark-pixel density), `recover_grid_geometry` (autocorrelation + cross-axis sanity + snap-to-lines), float-precision cell sampling, CIELAB color matching, text detection.
3. **Same UI** — `BlueprintDimsConfirmDialog` (draggable bbox, editable dims, redetect, BETA badge) and `BlueprintImportDialog` (review preview) are already platform-neutral React; they should work in VS Code unchanged once the adapter returns valid results.
4. **Progress + cancel** — JS is slower than Rust, large grids may take 5-15s. Surface a progress bar with a cancel button. The work is fully cancellable mid-stream.

Bonus: while we're at it, the browser adapter gets the same TS implementation (currently also throws). One implementation, two consumers.

Success criteria:
- Open `temp/kagome_pindou_export.png` in VS Code → import reconstructs 100% accurate via metadata fast path.
- Open a third-party PNG (e.g. `samples/kagome2.pindou` re-exported without metadata) → detection succeeds with ≥99% cell accuracy (matching the desktop bar).
- Progress visible for any operation > 500 ms; cancellable cleanly without crashing.
- 73 existing webview Playwright tests keep passing.

## Non-Goals

- Tauri desktop changes. Desktop continues to use Rust (faster, already works).
- VS Code host-side image processing. Everything runs in the webview using browser APIs (`<img>`, OffscreenCanvas/Canvas, ImageData).
- Web Worker offloading. Single-threaded first; revisit if real-world perf demands it.
- Image preprocessing (cropping/recompression before processing). Use the source bytes as-is.
- Progress reporting on the Tauri path. Rust is fast enough; adapter accepts `onProgress` but Tauri implementation ignores it.

## Design

### Architecture overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  src/components/Import/BlueprintDimsConfirmDialog.tsx               │
│  - Platform-neutral React (unchanged)                                │
│  - Calls adapter.detectBlueprintDims / importBlueprint              │
│  - NEW: shows progress + cancel button during busy state            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ↓ adapter interface
┌─────────────────────────────────────────────────────────────────────┐
│  PlatformAdapter (src/adapters/index.ts)                            │
│  - importBlueprint(..., opts?: { onProgress?, signal? })            │
│  - detectBlueprintDims(..., opts?: { onProgress?, signal? })        │
└─────────────────────────────────────────────────────────────────────┘
            │                              │
            ↓                              ↓
   ┌────────────────┐              ┌──────────────────────────────┐
   │ TauriAdapter   │              │ VscodeAdapter / BrowserAdapter│
   │ - invokes Rust │              │ - calls importBlueprintTS(...) │
   │ - ignores opts │              │ - threads onProgress + signal  │
   └────────────────┘              └──────────────────────────────┘
                                                │
                                                ↓
                           ┌─────────────────────────────────────────┐
                           │  src/utils/blueprintImportTS.ts (NEW)   │
                           │  - Port of Rust blueprint_import.rs     │
                           │  - importBlueprintTS / detectBlueprintDimsTS │
                           │  - All steps yield to onProgress + check signal │
                           └─────────────────────────────────────────┘
                                                │
                                                ↓
                           ┌─────────────────────────────────────────┐
                           │  src/utils/pngMetadata.ts (NEW)         │
                           │  - readBlueprintMetadata(bytes)         │
                           │  - tiny PNG tEXt parser (~50 LOC)       │
                           └─────────────────────────────────────────┘
                           ┌─────────────────────────────────────────┐
                           │  src/utils/imageLoader.ts (NEW)         │
                           │  - loadImageData(path, adapter)         │
                           │  - bytes → Image → canvas → ImageData   │
                           └────���────────────────────────────────────┘
```

### 1. New `src/utils/blueprintImportTS.ts`

TypeScript port of `src-tauri/src/commands/blueprint_import.rs`. Public API:

```typescript
export interface ProgressCallback {
  (stage: string, fraction: number): void; // fraction 0..1, stage is short human-readable
}

export interface ImportTsOpts {
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

export async function detectBlueprintDimsTS(
  path: string,
  adapter: { readFileBase64(path: string): Promise<string> },
  bbox?: { left: number; top: number; right: number; bottom: number },
  opts?: ImportTsOpts,
): Promise<{
  width: number;
  height: number;
  cellSize: number;
  bbox: { left: number; top: number; right: number; bottom: number };
  hasMetadata: boolean;
}>;

export async function importBlueprintTS(
  args: {
    path: string;
    palette: PaletteColor[];
    gridWidth?: number;
    gridHeight?: number;
    bbox?: { left: number; top: number; right: number; bottom: number };
  },
  adapter: { readFileBase64(path: string): Promise<string> },
  opts?: ImportTsOpts,
): Promise<BlueprintImportResult>;
```

Internal modules (one file but logical sections):

- **`readBlueprintMetadata(bytes: Uint8Array)`** → `{ gridWidth, gridHeight, cellSize, originX, originY } | null`. Parses PNG chunks looking for `tEXt` keyword `pindouverse-blueprint`. Returns null for non-PNG, missing chunk, or v !== 1.

- **`detectGridBBox(img: ImageData, lumThreshold: number)`** → `GridBBox | null`. Iterates rows/cols computing dark pixel count; uses `longestRunAbove(values, lo)` to find the contiguous run; sanity-checks ≥30% axis coverage.

- **`recoverGridGeometry(img, bbox, config)`** → `{ width, height, cellSizeX, cellSizeY, originX, originY } | null`. Computes per-axis dark signals, runs `autocorrPeak` with per-format thresholds, cross-axis sanity check, `snapToGridLines` to extend bbox to true edges.

- **`autocorrPeak(signal, minLag, maxLag, step2Accept, step3Accept)`** → `[lag, corr] | null`. Mirror of Rust impl: alternation halve, smallest-divisor walk, k=2..5 non-divisor scan, parabolic refinement. **Each step calls onProgress + checks signal.**

- **`sampleCellColor(img, x0, y0, cellSize, config)`** → `[r, g, b] | null`. 8 fixed offsets + extra for JPEG, median per channel, filter near-black (text) and near-white (grid lines) outliers.

- **`matchColor(r, g, b, palette)`** → `[code, confidence]`. RGB → CIELAB → ΔE76 min, confidence = `max(0, 1 - dE/100)`.

- **`extractCellBinary` + `cellHasText`** → for the white-color empty-vs-H2 disambiguation. Just the binary mass + perimeter heuristic from Rust.

- **`buildImportResult(...)`** → assembles `BlueprintImportResult` matching the existing TS type from `src/adapters/index.ts`.

**Progress / cancel pattern**:

```typescript
function checkSignal(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}

// Inside per-row sampling loop:
for (let row = 0; row < gridH; row++) {
  if (row % 8 === 0) {
    checkSignal(opts?.signal);
    opts?.onProgress?.(`采样颜色 ${row}/${gridH}`, row / gridH);
    await new Promise(r => setTimeout(r, 0)); // yield to UI thread
  }
  // ... sample
}
```

Yielding `await new Promise(r => setTimeout(r, 0))` every N iterations is what makes JS actually re-render and process the cancel click. Without it the dialog freezes during the whole compute.

### 2. New `src/utils/pngMetadata.ts`

Tiny standalone PNG tEXt chunk reader. Avoids pulling in `pngjs` (~50 KB minified) for one chunk type.

```typescript
export interface BlueprintPngMetadata {
  v: number;
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  originX: number;
  originY: number;
}

/** Returns null if input isn't a PNG, has no tEXt chunk with keyword
 *  "pindouverse-blueprint", or the chunk's JSON has v !== 1. */
export function readBlueprintMetadata(bytes: Uint8Array): BlueprintPngMetadata | null;
```

Implementation: validate PNG signature (8 bytes), walk chunks: `[len:u32be][type:4][data:len][crc:u32be]`. Stop at IDAT (no chunks of interest after image data starts). For `tEXt`: data is `keyword \0 text` (Latin-1). Match keyword, JSON.parse the text, validate shape.

### 3. New `src/utils/imageLoader.ts`

```typescript
export interface LoadedImage {
  data: Uint8ClampedArray; // RGBA, length = width * height * 4
  width: number;
  height: number;
  /** Raw file bytes — used by readBlueprintMetadata for PNG inputs */
  rawBytes: Uint8Array;
  /** "image/png" / "image/jpeg" — detected from file extension */
  mediaType: "image/png" | "image/jpeg" | "image/bmp" | "application/octet-stream";
}

export async function loadImageData(
  path: string,
  adapter: { readFileBase64(path: string): Promise<string> },
): Promise<LoadedImage>;
```

Steps:
1. `adapter.readFileBase64(path)` → base64 string.
2. Base64 → Uint8Array (rawBytes).
3. Detect media type from extension (`.png` → image/png, `.jpg`/`.jpeg` → image/jpeg, `.bmp` → image/bmp, else octet-stream).
4. Build a data URL → assign to a new `Image`, await `onload`.
5. Draw to a 2D canvas (Offscreen if available, fallback to detached `<canvas>`), `getImageData(0, 0, w, h)` → `data: Uint8ClampedArray`.

This module is webview-only (uses `Image`, `OffscreenCanvas`/`document.createElement`). The Tauri adapter doesn't import it — Rust does its own decoding.

### 4. Adapter interface change

`src/adapters/index.ts`:

```typescript
// Existing types unchanged. Add optional opts to two methods:
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
): Promise<{ width: number; height: number; cellSize: number; bbox: {...}; hasMetadata: boolean }>;
```

Implementations:
- **Tauri** ([src/adapters/tauri.ts](../../../src/adapters/tauri.ts)): ignore `opts` (Rust is fast); existing invoke unchanged.
- **VS Code** ([platforms/vscode/src/vscodeAdapter.ts](../../../platforms/vscode/src/vscodeAdapter.ts)): implement `readFileBase64` (currently throws) by using the existing `readFile` host message which already returns base64. Then `importBlueprint` and `detectBlueprintDims` delegate to `importBlueprintTS` / `detectBlueprintDimsTS`, passing `this` as the adapter and the opts straight through.
- **Browser** ([src/adapters/browser.ts](../../../src/adapters/browser.ts)): same as VS Code — `readFileBase64` via IndexedDB / file picker (next milestone — for now keep throw, or implement only if path is a data URL). `importBlueprint` / `detectBlueprintDims` delegate to the TS impl.

### 5. UI changes

**`BlueprintDimsConfirmDialog.tsx`** (single file edit):

Replace the current `redetecting` and `aiBusy` booleans with a unified busy state:

```typescript
type BusyKind = "redetecting" | "importing-via-bbox" | null;
const [busy, setBusy] = useState<BusyKind>(null);
const [busyStage, setBusyStage] = useState("");
const [busyFraction, setBusyFraction] = useState(0);
const [abortController, setAbortController] = useState<AbortController | null>(null);
```

Each long operation:
1. Create AbortController, store it, set busy.
2. Call adapter with `{ onProgress: (stage, frac) => { setBusyStage(stage); setBusyFraction(frac); }, signal: controller.signal }`.
3. On settle (success/fail/abort), clear busy state.

Render progress: when `busy !== null`, show inline a small progress bar above the buttons:

```tsx
{busy && (
  <div className="flex items-center gap-2 text-[11px]">
    <div className="flex-1 h-1.5 bg-gray-200 rounded overflow-hidden">
      <div className="h-full bg-blue-500 transition-all" style={{ width: `${busyFraction * 100}%` }} />
    </div>
    <span className="text-gray-500 shrink-0 min-w-[10em]">{busyStage}</span>
    <button onClick={() => abortController?.abort()} className="px-2 py-0.5 border border-red-300 text-red-600 rounded text-[11px]">取消</button>
  </div>
)}
```

The existing 「用此范围重新识别」 and 「导入」 buttons disable during busy.

**`App.tsx`** (existing `blueprintImporting` + `blueprintProgress` state):

Also accept progress fraction; same overlay component but with the new progress bar + cancel. The final `import` call also passes the opts.

### 6. Removed AI 识别 UI

The dialog still has the `aiBusy` / `aiError` / `showConsent` / `aiMismatch` / model picker leftovers from the discarded AI experiment branch — main is clean of these per `git log`, so this section is a non-issue for THIS spec. Just confirming the dialog in main doesn't have any AI button to preserve or wire.

### 7. Testing

`platforms/vscode/tests/blueprint-import.spec.ts` (new):

Three Playwright tests against the webview harness:

1. **`metadata fast path`**: read `samples/kagome2.pindou` (or any sample where we ALSO have a PNG export — actually use `temp/kagome_pindou_export.png` if it's reachable from the harness via stageReply). Stage `readFile` to return the file bytes as base64. Call `adapter.detectBlueprintDims(path)` → assert `hasMetadata === true`, `width === 73`, `height === 98`, cellSize plausible.
2. **`import via metadata returns expected cells`**: same fixture + `adapter.importBlueprint(...)`. Assert `result.cells` has the right H×W and a known cell has the right code (e.g., row 0 col 19 is `H2` or whatever truth says).
3. **`cancel aborts import`**: start an import on a moderately large image, abort after 100 ms, assert the promise rejects with `AbortError` and the dialog/state recovers.

The kagome fixture lives at `src-tauri/tests/fixtures/kagome_pindou_export.png` (already in the repo for desktop tests). The Playwright harness needs to read this directly from disk (just `fs.readFileSync` in the spec file, base64-encode, stage it as the reply to `readFile`).

Existing 73 webview tests must keep passing.

### 8. Performance budget

Target: kagome 1920×2663, 63×78 cells, metadata fast path. JS workload:
- Image decode + getImageData: ~50 ms
- Read metadata chunk: ~5 ms
- Sample 63×78 = 4914 cells × 8 sample points = ~40k pixel reads + median: ~50 ms
- Build result: < 10 ms

Fast path total: < 200 ms — feels instant, no progress bar needed.

Detection path (no metadata) on same image:
- Image decode: 50 ms
- detectGridBBox: ~150 ms (pixel scan with luminance compute for each of ~5M pixels)
- recoverGridGeometry: ~300 ms (autocorr on ~2000-element signal, lag 5..120, both axes)
- sampleCellColor: ~50 ms
- has-text per cell: ~50 ms
- buildResult: 10 ms

Detection total: ~600 ms — borderline; progress bar useful for psychological feedback.

For 100×100 grids on 3000×3000 images, scale ~2.5×. Worst case ~2s. Still acceptable single-threaded.

If real measurements show > 5s for typical inputs, add downsampling to `detectGridBBox` (process every-2nd pixel) as the first optimization — it's exactly the kind of step that doesn't need pixel precision.

### 9. Browser support (bonus)

`src/adapters/browser.ts` currently throws for blueprint import. With this PR:
- `readFileBase64(path)`: if `path` starts with `data:`, decode the data URL; otherwise throw (full file system access in browser needs a picker, separate milestone).
- `importBlueprint` / `detectBlueprintDims` delegate to TS impl.

This isn't reachable from the current browser UI (the import dialog wires through `showOpenDialog → path` which doesn't produce data URLs in browser), so it's plumbing-only. Next milestone is wiring a `<input type="file">` picker in the browser flow.

## Testing

Manual (in addition to Playwright):
- Install the new vsix, open a `.pindou` editor, click 导入图纸, pick the kagome PNG → confirm 100% accurate.
- Pick a third-party JPEG → see progress bar tick → confirm detection runs and produces sensible cells.
- During an import, click 取消 → confirm dialog state resets cleanly, no orphan errors.

## Out of scope

- Web Worker offloading (v2 if needed)
- File picker for browser adapter (v2)
- Progress reporting on Tauri (Rust is fast enough)
- Algorithm improvements beyond port (any tuning goes back to Rust first for consistency)
