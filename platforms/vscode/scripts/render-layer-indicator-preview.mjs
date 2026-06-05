/**
 * One-shot dev script: boot the webview harness and take 2 screenshots so
 * we can iterate on the layer-indicator visual design without going through
 * VS Code install/uninstall.
 *
 * Usage (from platforms/vscode/):
 *   node scripts/render-layer-indicator-preview.mjs
 *
 * Output:
 *   ../../temp/layer-indicator-default.png   — active = default layer (no floating tag)
 *   ../../temp/layer-indicator-layer2.png    — active = a 2nd layer, mouse on canvas (floating tag visible)
 */
import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "../dist/webview");
const SAMPLES_DIR = path.resolve(__dirname, "../../../samples");
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const SAMPLE = path.join(SAMPLES_DIR, "hogwarts.pindou");
const OUT_DIR = path.join(PROJECT_ROOT, "temp");

function harnessHtml() {
  const scriptPath = path.join(DIST_DIR, "assets/index.js").replace(/\\/g, "/");
  const stylePath = path.join(DIST_DIR, "assets/style.css").replace(/\\/g, "/");
  return `<!DOCTYPE html>
<html lang="zh" style="height:100%;margin:0;padding:0;overflow:hidden">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="file:///${stylePath}">
  <style>html,body{height:100%;margin:0;padding:0;overflow:hidden}#root{height:100%;overflow:hidden}#root>div{height:100%!important;max-height:100%!important}</style>
</head>
<body>
  <div id="root"></div>
  <script>
    window._writes = [];
    window._stagedReplies = {};
    function acquireVsCodeApi() {
      return {
        postMessage(msg) {
          if (msg.type === "ready") { window._webviewReady = true; return; }
          if (msg.requestId === undefined) return;
          let reply;
          switch (msg.type) {
            case "getAutosaveDir":
              reply = { type: "fileResult", requestId: msg.requestId, success: true, data: "/tmp" };
              break;
            default:
              reply = { type: "ack", requestId: msg.requestId, success: true };
          }
          setTimeout(() => window.dispatchEvent(new MessageEvent("message", { data: reply })), 5);
        },
        getState() { return {}; },
        setState() {},
      };
    }
  </script>
  <script src="file:///${scriptPath}"></script>
</body>
</html>`;
}

async function shoot(page, outPath) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: outPath, fullPage: false });
  console.log(`SAVED → ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
}

(async () => {
  const harnessPath = path.join(DIST_DIR, "preview-harness.html");
  fs.writeFileSync(harnessPath, harnessHtml());

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[webview error] ${m.text()}`);
  });

  await page.goto(`file:///${harnessPath.replace(/\\/g, "/")}`);
  await page.waitForFunction(() => window._webviewReady === true, null, { timeout: 10_000 });
  await page.waitForFunction(() => !!window.__pindouStore, null, { timeout: 5_000 });

  // Load the sample.
  const content = fs.readFileSync(SAMPLE, "utf-8");
  await page.evaluate(({ content, filePath }) => {
    window._currentDocPath = filePath;
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "loadDocument", content, path: filePath, isUntitled: false },
    }));
  }, { content, filePath: SAMPLE });
  await page.waitForFunction(
    () => window.__pindouStore && window.__pindouStore.getState().canvasData?.length > 0,
    null, { timeout: 5_000 }
  );

  // Open the right-side layer panel.
  await page.getByRole("button", { name: /^图层$/ }).first().click().catch(() => {});
  await page.waitForTimeout(200);

  // --- Screenshot 1: default layer active (no floating tag should appear) ---
  // Move mouse over canvas to a fixed point so we'd SEE the tag if it were
  // wrongly shown for the default layer.
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);
  await shoot(page, path.join(OUT_DIR, "layer-indicator-default.png"));

  // --- Screenshot 2: add a 2nd layer, switch to it, hover canvas ---
  await page.evaluate(() => {
    const store = window.__pindouStore.getState();
    store.addLayer("草图层");
    // Switch to the new layer (which will be at the end of layers[]).
    const newLayers = window.__pindouStore.getState().layers;
    window.__pindouStore.getState().setActiveLayer(newLayers[newLayers.length - 1].id);
  });
  await page.waitForTimeout(200);
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
  await page.waitForTimeout(200);
  await shoot(page, path.join(OUT_DIR, "layer-indicator-layer2.png"));

  await browser.close();
  fs.unlinkSync(harnessPath);
})();
