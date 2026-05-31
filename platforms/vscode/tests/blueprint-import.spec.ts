import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  stageReply,
} from "./helpers";

const KAGOME_TRUTH = path.resolve(__dirname, "../../../src-tauri/tests/fixtures/kagome_truth.json");

interface TruthPaletteEntry {
  code: string;
  r: number;
  g: number;
  b: number;
}

interface Truth {
  width: number;
  height: number;
  palette: TruthPaletteEntry[];
  truth_codes: string[][];
}

function loadTruth(): Truth {
  return JSON.parse(fs.readFileSync(KAGOME_TRUTH, "utf-8")) as Truth;
}

// ─── PNG construction helpers ─────────────────────────────────────
// Build a tiny, self-consistent metadata-bearing PNG for the fast-path tests.
// The fixture `kagome_pindou_export.png` intentionally has its tEXt chunk
// stripped (it's the Rust detection-path test fixture, see
// src-tauri/tests/blueprint_real_image.rs). To exercise the metadata fast
// path we synthesize a PNG with known cells AND an embedded
// pindouverse-blueprint chunk pointing at them — same approach the Rust
// `blueprint_all_samples` test uses.

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

interface SynthSpec {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  originX: number;
  originY: number;
  marginRight: number;
  marginBottom: number;
  /** rows of palette codes — must match gridHeight × gridWidth */
  cellCodes: string[][];
  palette: TruthPaletteEntry[];
}

/** Build a minimal RGB PNG with solid-color cells and an embedded
 *  pindouverse-blueprint tEXt chunk. */
function buildMetadataPng(spec: SynthSpec): { png: Buffer; expectedCodes: string[][] } {
  const w = spec.originX + spec.gridWidth * spec.cellSize + spec.marginRight;
  const h = spec.originY + spec.gridHeight * spec.cellSize + spec.marginBottom;

  const paletteByCode = new Map(spec.palette.map((p) => [p.code, p]));

  // Build RGBA raster — white background, solid cells.
  const rowStride = w * 3 + 1; // +1 for filter byte per row
  const raster = Buffer.alloc(h * rowStride, 0xFF); // background white
  // Filter bytes already implicit (0 = None, default in Buffer.alloc=0)
  for (let y = 0; y < h; y++) raster[y * rowStride] = 0; // filter type None
  // Fill cells
  for (let r = 0; r < spec.gridHeight; r++) {
    for (let c = 0; c < spec.gridWidth; c++) {
      const code = spec.cellCodes[r][c];
      const color = paletteByCode.get(code);
      if (!color) throw new Error(`Palette missing code ${code}`);
      const x0 = spec.originX + c * spec.cellSize;
      const y0 = spec.originY + r * spec.cellSize;
      for (let dy = 0; dy < spec.cellSize; dy++) {
        const rowOff = (y0 + dy) * rowStride + 1; // +1 skip filter byte
        for (let dx = 0; dx < spec.cellSize; dx++) {
          const off = rowOff + (x0 + dx) * 3;
          raster[off] = color.r;
          raster[off + 1] = color.g;
          raster[off + 2] = color.b;
        }
      }
    }
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type = RGB
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // tEXt: pindouverse-blueprint\0{json}
  const metaJson = JSON.stringify({
    v: 1,
    gridWidth: spec.gridWidth,
    gridHeight: spec.gridHeight,
    cellSize: spec.cellSize,
    originX: spec.originX,
    originY: spec.originY,
  });
  const textData = Buffer.concat([
    Buffer.from("pindouverse-blueprint", "latin1"),
    Buffer.from([0]),
    Buffer.from(metaJson, "latin1"),
  ]);

  // IDAT (zlib-compressed raster)
  const idat = zlib.deflateSync(raster);

  const SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const png = Buffer.concat([
    SIG,
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", textData),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return { png, expectedCodes: spec.cellCodes };
}

function synthFromTruth(truth: Truth, opts: { gridWidth: number; gridHeight: number; cellSize: number }) {
  // Take an N×M slice of the truth_codes, replacing any '' (empty) cells with
  // the first palette entry. The empty cells in truth_codes mean "no bead";
  // for a synthesized fast-path fixture every cell must have a known color.
  const fallback = truth.palette[0].code;
  const codes: string[][] = [];
  for (let r = 0; r < opts.gridHeight; r++) {
    const row: string[] = [];
    for (let c = 0; c < opts.gridWidth; c++) {
      const code = truth.truth_codes[r % truth.height][c % truth.width];
      row.push(code && code.length > 0 ? code : fallback);
    }
    codes.push(row);
  }
  return buildMetadataPng({
    gridWidth: opts.gridWidth,
    gridHeight: opts.gridHeight,
    cellSize: opts.cellSize,
    originX: 5,
    originY: 5,
    marginRight: 5,
    marginBottom: 5,
    cellCodes: codes,
    palette: truth.palette,
  });
}

test.describe("VS Code blueprint import (TS port)", () => {
  test.afterAll(() => cleanupHarness());

  test("detectBlueprintDims hits metadata fast path for a PNG with pindouverse-blueprint chunk", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const truth = loadTruth();
    const { png } = synthFromTruth(truth, { gridWidth: 8, gridHeight: 6, cellSize: 20 });
    await stageReply(page, "readFile", { data: png.toString("base64") });

    const result = await page.evaluate(async () => {
      const adapter = (window as any).__pindouAdapter;
      const r = await adapter.detectBlueprintDims("/fake/synth.png");
      return {
        width: r.width,
        height: r.height,
        hasMetadata: r.hasMetadata,
        cellSize: r.cellSize,
      };
    });

    expect(result.hasMetadata).toBe(true);
    expect(result.width).toBe(8);
    expect(result.height).toBe(6);
    expect(result.cellSize).toBe(20);
  });

  test("importBlueprint via metadata returns cells matching expected codes", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const truth = loadTruth();
    const { png, expectedCodes } = synthFromTruth(truth, { gridWidth: 10, gridHeight: 8, cellSize: 20 });
    await stageReply(page, "readFile", { data: png.toString("base64") });

    const result = await page.evaluate(async (paletteArg) => {
      const adapter = (window as any).__pindouAdapter;
      const r = await adapter.importBlueprint("/fake/synth.png", paletteArg);
      return {
        width: r.width,
        height: r.height,
        cellSize: r.cell_size_detected,
        cellsCodes: r.cells.map((row: any[]) => row.map((c: any) => c.final_code)),
      };
    }, truth.palette);

    expect(result.width).toBe(10);
    expect(result.height).toBe(8);
    expect(result.cellSize).toBe(20);

    // Spot check a known cell (we control the synthesis, so this is deterministic).
    expect(result.cellsCodes[0][0]).toBe(expectedCodes[0][0]);

    // Whole-grid accuracy — fast path on solid-color cells should be exact.
    let ok = 0;
    let total = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 10; c++) {
        total++;
        if (result.cellsCodes[r][c] === expectedCodes[r][c]) ok++;
      }
    }
    const accuracy = ok / total;
    expect(accuracy).toBeGreaterThanOrEqual(0.99);
  });

  test("cancel during import either aborts or completes — never hangs", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const truth = loadTruth();
    const { png } = synthFromTruth(truth, { gridWidth: 10, gridHeight: 8, cellSize: 20 });
    await stageReply(page, "readFile", { data: png.toString("base64") });

    const outcome = await page.evaluate(async (paletteArg) => {
      const adapter = (window as any).__pindouAdapter;
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5);
      try {
        await adapter.importBlueprint(
          "/fake/synth.png",
          paletteArg,
          undefined,
          undefined,
          undefined,
          undefined,
          { signal: ctrl.signal },
        );
        return "completed";
      } catch (e: any) {
        return e?.name === "AbortError" ? "aborted" : `other:${e?.message}`;
      }
    }, truth.palette);

    expect(["aborted", "completed"]).toContain(outcome);
  });
});
