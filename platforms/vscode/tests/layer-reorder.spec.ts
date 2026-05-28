import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  callAction,
  getStoreState,
} from "./helpers";

test.describe("Layer reordering", () => {
  test.afterAll(() => cleanupHarness());

  test("moveLayer swaps order but preserves layer count and individual data", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Initial: 1 layer (the loaded project content).
    let layers = await getStoreState<any[]>(page, "layers");
    expect(layers.length).toBe(1);
    const originalData = layers[0].data;

    // Add an empty layer 2 → becomes activeLayer
    await callAction(page, "addLayer", ["Layer 2"]);
    layers = await getStoreState<any[]>(page, "layers");
    expect(layers.length).toBe(2);
    expect(layers[1].name).toBe("Layer 2");

    // Draw a red pixel at (0,0) on the active (new top) layer
    await callAction(page, "setCell", [0, 0, 5]);
    layers = await getStoreState<any[]>(page, "layers");
    expect(layers[1].data[0][0].colorIndex).toBe(5);
    expect(layers[0].data[0][0].colorIndex).toBe(originalData[0][0].colorIndex);

    // Move Layer 2 DOWN (in UI = toward bottom = lower index)
    const layer2Id = layers[1].id;
    await callAction(page, "moveLayer", [layer2Id, "down"]);
    layers = await getStoreState<any[]>(page, "layers");

    // CRITICAL CHECKS:
    // 1. Count must still be 2 (no merge)
    expect(layers.length).toBe(2);
    // 2. Layer 2 must now be at index 0; its data must be intact
    expect(layers[0].name).toBe("Layer 2");
    expect(layers[0].data[0][0].colorIndex).toBe(5);
    // 3. The original layer (now at index 1) must still hold the original content
    expect(layers[1].data[0][0].colorIndex).toBe(originalData[0][0].colorIndex);
    // 4. They must be distinct objects (no aliasing)
    expect(layers[0].data).not.toBe(layers[1].data);
  });

  test("moveLayer up: same invariants", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await callAction(page, "addLayer", ["Layer 2"]);
    await callAction(page, "setCell", [1, 1, 7]); // red on Layer 2
    let layers = await getStoreState<any[]>(page, "layers");
    const layer1Id = layers[0].id;

    // Move Layer 1 UP (toward higher index)
    await callAction(page, "moveLayer", [layer1Id, "up"]);
    layers = await getStoreState<any[]>(page, "layers");
    expect(layers.length).toBe(2);
    expect(layers[1].id).toBe(layer1Id);
    expect(layers[0].name).toBe("Layer 2");
    expect(layers[0].data[1][1].colorIndex).toBe(7);
  });

  test("save + reload via document echo preserves layer count and z-order", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Build a 2-layer state: original layer + new "L2" with a unique pixel at (0,0)
    await callAction(page, "addLayer", ["L2"]);
    await callAction(page, "setCell", [0, 0, 42]);
    let layers = await getStoreState<any[]>(page, "layers");
    expect(layers.length).toBe(2);
    const layer1Name = layers[0].name;
    const layer2Name = layers[1].name;

    // Synthesize the save+reload cycle that VS Code's host triggers:
    //   1. webview serializes state via buildProjectFile → JSON
    //   2. host writes file, then echoes loadDocument back
    //   3. main.tsx parses + calls loadProjectLayers (NEW path)
    const project = await page.evaluate(() => {
      const store = (window as any).__pindouStore;
      const state = store.getState();
      return {
        version: 2,
        canvasSize: state.canvasSize,
        canvasData: state.canvasData,
        layers: state.layers,
        gridConfig: state.gridConfig,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
    const content = JSON.stringify(project);

    // Echo loadDocument back into the webview, mimicking the extension host.
    await page.evaluate((content) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "loadDocument", content, path: "/test/test.pindou", isUntitled: false },
        })
      );
    }, content);

    // Give React a tick to apply
    await page.waitForFunction(
      () => {
        const store = (window as any).__pindouStore;
        return store.getState().layers?.length === 2;
      },
      null,
      { timeout: 5_000 }
    );

    layers = await getStoreState<any[]>(page, "layers");
    expect(layers.length).toBe(2);
    expect(layers[0].name).toBe(layer1Name);
    expect(layers[1].name).toBe(layer2Name);
    expect(layers[1].data[0][0].colorIndex).toBe(42);
  });
});
