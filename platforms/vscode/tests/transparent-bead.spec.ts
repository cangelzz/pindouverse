import { test, expect } from "@playwright/test";
import { setupPage, callAction, countRenderedPixels } from "./helpers";
import { MARD_COLORS, TRANSPARENT_BEAD_INDEX } from "../../../src/data/mard221";

const H2_WHITE_INDEX = MARD_COLORS.findIndex((c) => c.code === "H2");

test.describe("H1 transparent bead", () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
    // Use a tiny canvas so that a single bead occupies a meaningful fraction of
    // the rendered area — making pixel-count differences clearly observable.
    await callAction(page, "newCanvas", [4, 4]);
    await page.waitForTimeout(50);
  });

  test("renders distinctly from empty and from a solid bead", async ({ page }) => {
    // 1) empty canvas baseline (grid lines only, no beads)
    const emptyCount = await countRenderedPixels(page);

    // 2) place a solid white (H2) bead at (0,0)
    await callAction(page, "setCell", [0, 0, H2_WHITE_INDEX]);
    await page.waitForTimeout(50);
    const solidCount = await countRenderedPixels(page);
    expect(solidCount).toBeGreaterThan(emptyCount);

    // 3) replace with the H1 transparent bead at the same cell
    await callAction(page, "setCell", [0, 0, TRANSPARENT_BEAD_INDEX]);
    await page.waitForTimeout(50);
    const transparentCount = await countRenderedPixels(page);

    // The X marker draws *some* ink (distinct from empty)...
    expect(transparentCount).toBeGreaterThan(emptyCount);
    // ...but far less than a fully-filled solid bead (distinct from white).
    expect(transparentCount).toBeLessThan(solidCount);
  });
});
