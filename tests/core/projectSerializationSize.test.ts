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
    console.log(
      `shinzo_wo_sasageyo: v2 ${(raw.length / 1024).toFixed(1)} KB → v3 ${(compact.length / 1024).toFixed(1)} KB (${(raw.length / compact.length).toFixed(1)}x)`
    );
    // Current v2 file is ~1.3 MB. v3 target: well under 250 KB.
    expect(compact.length).toBeLessThan(250 * 1024);
    // Sanity: not absurdly small either (would indicate data loss).
    expect(compact.length).toBeGreaterThan(20 * 1024);
  });
});
