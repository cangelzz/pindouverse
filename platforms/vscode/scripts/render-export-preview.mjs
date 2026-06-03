/**
 * One-shot dev script: boots the webview harness, loads a sample, triggers
 * a blueprint export, and dumps the resulting PNG to disk so we can iterate
 * on legend visual design without going through VS Code install/uninstall.
 *
 * Usage (from platforms/vscode/):
 *   node scripts/render-export-preview.mjs
 *
 * Output: ../../export-preview.png (project root)
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
const OUT = path.join(PROJECT_ROOT, "export-preview.png");

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
    const _writes = [];
    const _stagedReplies = {};
    window._writes = _writes;
    window._stagedReplies = _stagedReplies;

    function acquireVsCodeApi() {
      return {
        postMessage(msg) {
          if (msg.type === "ready") { window._webviewReady = true; return; }
          if (msg.requestId === undefined) return;
          const stage = _stagedReplies[msg.type] && _stagedReplies[msg.type].shift();
          let reply;
          switch (msg.type) {
            case "showSaveDialog":
              reply = { type: "dialogResult", requestId: msg.requestId, path: stage || null };
              break;
            case "writeFile":
              _writes.push({ kind: "writeFile", path: msg.path, data: msg.data });
              reply = { type: "fileResult", requestId: msg.requestId, success: true };
              break;
            case "getAutosaveDir":
              reply = { type: "fileResult", requestId: msg.requestId, success: true, data: "/tmp/autosave" };
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

(async () => {
  const harnessPath = path.join(DIST_DIR, "preview-harness.html");
  fs.writeFileSync(harnessPath, harnessHtml());

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`[webview ${m.type()}] ${m.text()}`);
  });

  await page.goto(`file:///${harnessPath.replace(/\\/g, "/")}`);
  await page.waitForFunction(() => window._webviewReady === true, null, { timeout: 10_000 });
  await page.waitForFunction(() => !!window.__pindouStore, null, { timeout: 5_000 });

  // Load the sample project into the store via a loadDocument message.
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

  // Open export dialog, stage save dialog reply, click 导出.
  await page.getByRole("button", { name: "导出" }).first().click();
  await page.getByRole("heading", { name: "导出高分辨率图片" }).waitFor({ timeout: 5_000 });
  await page.evaluate(() => {
    window._stagedReplies.showSaveDialog = window._stagedReplies.showSaveDialog || [];
    window._stagedReplies.showSaveDialog.push("/out/preview.png");
  });
  await page.getByRole("button", { name: /^导出$/ }).last().click();

  await page.waitForFunction(
    () => window._writes.some((w) => w.path === "/out/preview.png"),
    null, { timeout: 30_000 }
  );

  const writes = await page.evaluate(() => window._writes.slice());
  const png = writes.find((w) => w.path === "/out/preview.png");
  fs.writeFileSync(OUT, Buffer.from(png.data, "base64"));
  console.log(`SAVED → ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);

  await browser.close();
  fs.unlinkSync(harnessPath);
})();
