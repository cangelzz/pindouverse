import { test, expect, type Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const DIST_DIR = path.resolve(__dirname, "../dist/webview");
const TEST_DATA = path.resolve(__dirname, "../../../samples/furina100x100.pindou");

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
    const _messages = [];
    function acquireVsCodeApi() {
      return {
        postMessage(msg) {
          _messages.push(msg);
          if (msg.type === "ready") {
            window._webviewReady = true;
            window.dispatchEvent(new Event("webview-ready"));
          }
          // Echo loadDocument after save (simulates extension host behavior)
          if (msg.type === "save") {
            window._lastSavedContent = msg.content;
            setTimeout(() => {
              window.dispatchEvent(new MessageEvent("message", {
                data: { type: "loadDocument", content: msg.content, path: window._currentDocPath || "/test/test.pindou" }
              }));
            }, 50);
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

async function setupPage(page: Page): Promise<string> {
  const testHtmlPath = path.join(DIST_DIR, "test-harness.html");
  fs.writeFileSync(testHtmlPath, createTestHtml());
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[webview ${msg.type()}] ${msg.text()}`);
  });
  await page.goto(`file:///${testHtmlPath.replace(/\\/g, "/")}`);
  await page.waitForFunction(() => (window as any)._webviewReady === true, null, { timeout: 10_000 });
  return testHtmlPath;
}

async function loadProject(page: Page, projectPath?: string) {
  const dataPath = projectPath || TEST_DATA;
  const projectData = fs.readFileSync(dataPath, "utf-8");
  await page.evaluate(({ content, filePath }: { content: string; filePath: string }) => {
    (window as any)._currentDocPath = filePath;
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "loadDocument", content, path: filePath }
    }));
  }, { content: projectData, filePath: dataPath });
  await page.waitForTimeout(500);
}

async function getStoreState(page: Page, field: string): Promise<any> {
  return page.evaluate((f: string) => {
    const store = (window as any).__zustandStore;
    if (!store) return null;
    return store.getState()[f];
  }, field);
}

async function countRenderedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvases = document.querySelectorAll("canvas");
    for (const canvas of canvases) {
      const ctx = canvas.getContext("2d");
      if (!ctx || canvas.width === 0 || canvas.height === 0) continue;
      const size = Math.min(canvas.width, canvas.height, 500);
      const imageData = ctx.getImageData(0, 0, size, size);
      let count = 0;
      for (let i = 3; i < imageData.data.length; i += 4) {
        if (imageData.data[i] > 0) count++;
      }
      if (count > 100) return count;
    }
    return 0;
  });
}

test.describe("VS Code webview critical paths", () => {
  let testHtmlPath: string;

  test.beforeAll(() => {
    const indexJs = path.join(DIST_DIR, "assets/index.js");
    if (!fs.existsSync(indexJs)) {
      throw new Error(`Built webview not found at ${indexJs}. Run 'npm run build:webview' first.`);
    }
  });

  test.afterAll(() => {
    const p = path.join(DIST_DIR, "test-harness.html");
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  test("loads .pindou file and renders pixels", async ({ page }) => {
    testHtmlPath = await setupPage(page);
    await loadProject(page);

    const pixels = await countRenderedPixels(page);
    expect(pixels).toBeGreaterThan(100);
  });

  test("projectPath is set after loading document", async ({ page }) => {
    testHtmlPath = await setupPage(page);
    await loadProject(page);

    const projectPath = await page.evaluate(() => {
      // Access store via the exposed module
      const el = document.body.textContent || "";
      // Check if the file path appears in status bar
      return el.includes("furina100x100.pindou");
    });
    expect(projectPath).toBe(true);
  });

  test("save does not open dialog (projectPath is set)", async ({ page }) => {
    testHtmlPath = await setupPage(page);
    await loadProject(page);

    // Trigger save via the store
    const messagesBefore = await page.evaluate(() => (window as any)._messages.length);

    await page.evaluate(() => {
      // Simulate Ctrl+S by calling saveProject
      const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true });
      window.dispatchEvent(event);
    });
    await page.waitForTimeout(500);

    // Check that a "save" message was sent (not "showSaveDialog")
    const messages = await page.evaluate(() =>
      (window as any)._messages.map((m: any) => m.type)
    );
    const saveMessages = messages.filter((t: string) => t === "save");
    const dialogMessages = messages.filter((t: string) => t === "showSaveDialog");

    expect(saveMessages.length).toBeGreaterThan(0);
    expect(dialogMessages.length).toBe(0);
  });

  test("canvas not cleared after save echo", async ({ page }) => {
    testHtmlPath = await setupPage(page);
    await loadProject(page);

    const pixelsBefore = await countRenderedPixels(page);
    expect(pixelsBefore).toBeGreaterThan(100);

    // Trigger save
    await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true });
      window.dispatchEvent(event);
    });

    // Wait for save echo (loadDocument triggered by mock)
    await page.waitForTimeout(1000);

    const pixelsAfter = await countRenderedPixels(page);
    expect(pixelsAfter).toBeGreaterThan(100);
    // Pixels should be roughly the same (not cleared)
    expect(pixelsAfter).toBeGreaterThanOrEqual(pixelsBefore * 0.8);
  });

  test("projectInfo is loaded from document", async ({ page }) => {
    testHtmlPath = await setupPage(page);

    // Create a project with projectInfo
    const projectData = JSON.parse(fs.readFileSync(TEST_DATA, "utf-8"));
    projectData.projectInfo = { title: "Test Title", author: "Test Author" };
    const content = JSON.stringify(projectData);

    await page.evaluate(({ content, filePath }: { content: string; filePath: string }) => {
      (window as any)._currentDocPath = filePath;
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "loadDocument", content, path: filePath }
      }));
    }, { content, filePath: "/test/with-info.pindou" });
    await page.waitForTimeout(500);

    // Check window title contains the project title
    const title = await page.title();
    expect(title).toContain("Test Title");
  });
});
