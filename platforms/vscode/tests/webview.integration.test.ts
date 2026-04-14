import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const DIST_DIR = path.resolve(__dirname, "../dist/webview");
const TEST_DATA = path.resolve(__dirname, "../../../temp/fu13.pindou");

/**
 * Create a test HTML page that mimics the VS Code webview environment.
 * It defines acquireVsCodeApi BEFORE loading the built bundle,
 * which is what the real extension does via nonce script injection.
 */
function createTestHtml(): string {
  const scriptPath = path.join(DIST_DIR, "assets/index.js").replace(/\\/g, "/");
  const stylePath = path.join(DIST_DIR, "assets/style.css").replace(/\\/g, "/");

  return `<!DOCTYPE html>
<html lang="zh" style="height:100%;margin:0;padding:0;overflow:hidden">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="file:///${stylePath}">
  <style>
    html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
    #root { height: 100%; overflow: hidden; }
    #root > div { height: 100% !important; max-height: 100% !important; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    // Mock VS Code API — must be defined BEFORE the bundle loads
    const _messages = [];
    function acquireVsCodeApi() {
      return {
        postMessage(msg) {
          _messages.push(msg);
          // When the webview signals ready, we'll send data from the test
          if (msg.type === "ready") {
            window._webviewReady = true;
            window.dispatchEvent(new Event("webview-ready"));
          }
        },
        getState() { return {}; },
        setState(state) {},
      };
    }
    window._messages = _messages;
  </script>
  <script src="file:///${scriptPath}"></script>
</body>
</html>`;
}

test.describe("Webview rendering", () => {
  test.beforeAll(() => {
    // Verify build exists
    const indexJs = path.join(DIST_DIR, "assets/index.js");
    if (!fs.existsSync(indexJs)) {
      throw new Error(
        `Built webview not found at ${indexJs}. Run 'npm run build:webview' first.`
      );
    }
  });

  test("loads .pindou file and renders pixels on canvas", async ({ page }) => {
    // Write test HTML to a temp file
    const testHtmlPath = path.join(DIST_DIR, "test-harness.html");
    fs.writeFileSync(testHtmlPath, createTestHtml());

    try {
      // Collect console logs for debugging
      const consoleLogs: string[] = [];
      page.on("console", (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

      // Load the test page
      await page.goto(`file:///${testHtmlPath.replace(/\\/g, "/")}`);

      // Wait for the webview to signal ready
      await page.waitForFunction(() => (window as any)._webviewReady === true, null, {
        timeout: 10_000,
      });

      // Load test data
      const projectData = fs.readFileSync(TEST_DATA, "utf-8");
      const project = JSON.parse(projectData);

      // Verify test data has content
      let nonNullCount = 0;
      for (const row of project.canvasData) {
        for (const cell of row) {
          if (cell.colorIndex !== null) nonNullCount++;
        }
      }
      expect(nonNullCount).toBeGreaterThan(0);
      console.log(`Test data: ${project.canvasSize.width}x${project.canvasSize.height}, ${nonNullCount} non-null cells`);

      // Simulate the extension host sending the document
      await page.evaluate((content: string) => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "loadDocument",
              content,
              path: "/test/fu13.pindou",
            },
          })
        );
      }, projectData);

      // Wait for rendering to complete
      await page.waitForTimeout(1000);

      // === DIAGNOSTIC CHECKS ===

      // 1. Check container dimensions
      const containerInfo = await page.evaluate(() => {
        const container = document.querySelector("[data-canvas-container]") as HTMLElement;
        if (!container) return { found: false, w: 0, h: 0 };
        return {
          found: true,
          w: container.clientWidth,
          h: container.clientHeight,
          offsetH: container.offsetHeight,
          scrollH: container.scrollHeight,
          parentH: (container.parentElement as HTMLElement)?.clientHeight ?? 0,
        };
      });
      console.log("Container info:", JSON.stringify(containerInfo));
      expect(containerInfo.found).toBe(true);
      expect(containerInfo.h).toBeGreaterThan(0);
      expect(containerInfo.h).toBeLessThan(2000); // Must be sane, not 6000+

      // 2. Check canvas dimensions
      const canvasInfo = await page.evaluate(() => {
        const canvases = document.querySelectorAll("canvas");
        return Array.from(canvases).map((c, i) => ({
          index: i,
          width: c.width,
          height: c.height,
          styleW: c.style.width,
          styleH: c.style.height,
        }));
      });
      console.log("Canvas info:", JSON.stringify(canvasInfo));
      // At least one canvas should exist
      expect(canvasInfo.length).toBeGreaterThan(0);

      // 3. Check that pixels were actually drawn (sample pixel data from the pixel canvas)
      const hasPixels = await page.evaluate(() => {
        // pixelCanvasRef is the second canvas (index 1) in the DOM
        const canvases = document.querySelectorAll("canvas");
        // Try each canvas to find one with non-transparent pixels
        for (const canvas of canvases) {
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          // Sample a grid of pixels across the canvas
          const w = canvas.width;
          const h = canvas.height;
          if (w === 0 || h === 0) continue;
          const sampleSize = Math.min(w, h, 500);
          const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
          let nonTransparent = 0;
          for (let i = 3; i < imageData.data.length; i += 4) {
            if (imageData.data[i] > 0) nonTransparent++;
          }
          if (nonTransparent > 100) {
            return { found: true, nonTransparent, canvasW: w, canvasH: h };
          }
        }
        return { found: false, nonTransparent: 0 };
      });
      console.log("Pixel check:", JSON.stringify(hasPixels));

      // 4. Check Zustand store state
      const storeState = await page.evaluate(() => {
        // Access Zustand store — it's on the module scope
        // We can access it through the window if exposed, or via React devtools
        // Simpler: check if canvasData in DOM reflects loaded data
        const statusBar = document.body.textContent || "";
        return { bodyText: statusBar.substring(0, 200) };
      });
      console.log("Store state:", JSON.stringify(storeState));

      // Take screenshot for visual inspection
      await page.screenshot({
        path: path.join(__dirname, "../test-results/webview-render.png"),
        fullPage: false,
      });

      // Print all console logs for debugging
      console.log("\n=== WEBVIEW CONSOLE LOGS ===");
      for (const log of consoleLogs) {
        console.log(log);
      }
      console.log("=== END CONSOLE LOGS ===\n");

      // ASSERT: pixels were rendered
      expect(hasPixels.found).toBe(true);
      expect(hasPixels.nonTransparent).toBeGreaterThan(100);
    } finally {
      // Clean up test HTML
      if (fs.existsSync(testHtmlPath)) {
        fs.unlinkSync(testHtmlPath);
      }
    }
  });
});
