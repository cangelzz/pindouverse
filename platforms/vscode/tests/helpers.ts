import { type Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

export const DIST_DIR = path.resolve(__dirname, "../dist/webview");
export const SAMPLES_DIR = path.resolve(__dirname, "../../../samples");
export const TEST_DATA = path.join(SAMPLES_DIR, "asuka71x100.pindou");
export const FIXTURES_DIR = path.join(__dirname, "fixtures");

/**
 * Build a self-contained HTML page that:
 *   - loads the built webview bundle
 *   - exposes a configurable mock for `acquireVsCodeApi`
 *   - tracks all postMessage calls in `window._messages`
 *   - lets tests stage canned responses for showSaveDialog / showOpenDialog /
 *     readFile / writeFile / saveAs / getAutosaveDir / getGitHubToken before
 *     dispatching the matching reply, so the adapter's pendingRequests resolve
 *
 * The mock is intentionally permissive: any unknown request type with a
 * requestId gets a generic `{ success: true }` reply so tests don't hang.
 */
export function createTestHtml(): string {
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
    const _writes = [];      // captured writeFile / save / saveAs payloads
    const _stagedReplies = {}; // type -> array of canned replies (consumed FIFO)

    window._messages = _messages;
    window._writes = _writes;
    window._stagedReplies = _stagedReplies;

    function _dispatch(reply) {
      window.dispatchEvent(new MessageEvent("message", { data: reply }));
    }

    function acquireVsCodeApi() {
      return {
        postMessage(msg) {
          _messages.push(msg);

          // 1. ready signal — let test know boot is complete
          if (msg.type === "ready") {
            window._webviewReady = true;
            window.dispatchEvent(new Event("webview-ready"));
            return;
          }

          // 2. capture writes for later assertion
          if (msg.type === "save") {
            _writes.push({ kind: "save", content: msg.content });
            // Echo loadDocument back to keep the editor synced (mirrors host)
            window._lastSavedContent = msg.content;
            setTimeout(() => {
              _dispatch({
                type: "loadDocument",
                content: msg.content,
                path: window._currentDocPath || "/test/test.pindou",
                isUntitled: !!window._currentDocIsUntitled,
              });
            }, 20);
            return;
          }

          // 3. requests with a requestId need a matching reply
          if (msg.requestId === undefined) return;

          const stage = _stagedReplies[msg.type] && _stagedReplies[msg.type].shift();
          let reply;

          switch (msg.type) {
            case "showSaveDialog":
            case "showOpenDialog":
              reply = {
                type: "dialogResult",
                requestId: msg.requestId,
                path: stage !== undefined ? stage : null,
              };
              break;
            case "readFile":
              // stage is { data: base64, error?: string }
              reply = {
                type: "fileResult",
                requestId: msg.requestId,
                success: !stage || !stage.error,
                data: stage ? stage.data : null,
                error: stage ? stage.error : "no staged readFile",
              };
              break;
            case "writeFile":
              _writes.push({ kind: "writeFile", path: msg.path, data: msg.data });
              reply = {
                type: "fileResult",
                requestId: msg.requestId,
                success: !stage || stage.success !== false,
                error: stage && stage.success === false ? stage.error : undefined,
              };
              break;
            case "saveAs":
              _writes.push({ kind: "saveAs", path: msg.path, content: msg.content });
              reply = {
                type: "fileResult",
                requestId: msg.requestId,
                success: !stage || stage.success !== false,
              };
              // Mirror host: switch active doc to the new path
              window._currentDocPath = msg.path;
              window._currentDocIsUntitled = false;
              setTimeout(() => {
                _dispatch({
                  type: "loadDocument",
                  content: msg.content,
                  path: msg.path,
                  isUntitled: false,
                });
              }, 20);
              break;
            case "getAutosaveDir":
              reply = {
                type: "fileResult",
                requestId: msg.requestId,
                success: true,
                data: stage || "/tmp/autosave",
              };
              break;
            case "listSnapshots":
              // stage is an array of SnapshotInfo, or null for "no snapshots"
              reply = {
                type: "fileResult",
                requestId: msg.requestId,
                success: true,
                data: Array.isArray(stage) ? stage : [],
              };
              break;
            case "deleteSnapshot":
              // stage is { success: false, error: '...' } to simulate failure
              reply = {
                type: "fileResult",
                requestId: msg.requestId,
                success: !stage || stage.success !== false,
                error: stage && stage.success === false ? stage.error : undefined,
              };
              break;
            case "getGitHubToken":
              reply = {
                type: "githubToken",
                requestId: msg.requestId,
                token: stage ? stage.token : null,
                account: stage ? stage.account : null,
              };
              break;
            default:
              // generic ack
              reply = { type: "ack", requestId: msg.requestId, success: true };
          }
          setTimeout(() => _dispatch(reply), 10);
        },
        getState() { return {}; },
        setState(_s) {},
      };
    }
  </script>
  <script src="file:///${scriptPath}"></script>
</body>
</html>`;
}

let _harnessPath: string | null = null;

/** Boot the webview harness and wait for the React app to mount. */
export async function setupPage(page: Page): Promise<void> {
  if (!_harnessPath) {
    const harness = path.join(DIST_DIR, "test-harness.html");
    fs.writeFileSync(harness, createTestHtml());
    _harnessPath = harness;
  }
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[webview] ${msg.text()}`);
  });
  await page.goto(`file:///${_harnessPath.replace(/\\/g, "/")}`);
  await page.waitForFunction(() => (window as any)._webviewReady === true, null, {
    timeout: 10_000,
  });
  // Wait for the store to be exposed (React mount complete)
  await page.waitForFunction(() => !!(window as any).__pindouStore, null, {
    timeout: 5_000,
  });
}

export function cleanupHarness() {
  if (_harnessPath && fs.existsSync(_harnessPath)) {
    fs.unlinkSync(_harnessPath);
    _harnessPath = null;
  }
}

/**
 * Send a `loadDocument` message into the webview, simulating the extension
 * host opening a file. Sets `_currentDocPath` so subsequent saves echo back
 * with the right path.
 */
export async function loadProject(
  page: Page,
  options: { samplePath?: string; isUntitled?: boolean; virtualPath?: string } = {}
): Promise<void> {
  const samplePath = options.samplePath || TEST_DATA;
  const content = fs.readFileSync(samplePath, "utf-8");
  const filePath = options.virtualPath || samplePath;
  const isUntitled = !!options.isUntitled;

  await page.evaluate(
    ({ content, filePath, isUntitled }) => {
      (window as any)._currentDocPath = filePath;
      (window as any)._currentDocIsUntitled = isUntitled;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "loadDocument", content, path: filePath, isUntitled },
        })
      );
    },
    { content, filePath, isUntitled }
  );
  // Give the store a tick to apply
  await page.waitForFunction(
    () => {
      const store = (window as any).__pindouStore;
      return !!store && store.getState().canvasData?.length > 0;
    },
    null,
    { timeout: 5_000 }
  );
}

/** Read all postMessage calls the webview has sent to the host so far. */
export async function getMessages(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any)._messages.slice());
}

export async function clearMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any)._messages.length = 0;
    (window as any)._writes.length = 0;
  });
}

/** Read all writeFile / save / saveAs payloads captured by the harness. */
export async function getWrites(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any)._writes.slice());
}

/**
 * Stage a canned reply for the next request of the given type.
 * - showSaveDialog / showOpenDialog: pass the path string (or null to cancel)
 * - readFile: pass `{ data: base64String }`
 * - writeFile: pass `{ success: false, error: '...' }` to simulate failure
 */
export async function stageReply(page: Page, type: string, value: any): Promise<void> {
  await page.evaluate(
    ({ type, value }) => {
      const staged = (window as any)._stagedReplies;
      if (!staged[type]) staged[type] = [];
      staged[type].push(value);
    },
    { type, value }
  );
}

/** Read a single field from the Zustand store. */
export async function getStoreState<T = any>(page: Page, field: string): Promise<T> {
  return page.evaluate((f) => {
    const store = (window as any).__pindouStore;
    if (!store) return null;
    return store.getState()[f];
  }, field);
}

/**
 * Dispatch a Zustand action by name, with arbitrary args. Args must be
 * JSON-serializable. Returns the action's return value (await'd).
 */
export async function callAction<T = any>(
  page: Page,
  action: string,
  args: any[] = []
): Promise<T> {
  return page.evaluate(
    async ({ action, args }) => {
      const store = (window as any).__pindouStore;
      const fn = store.getState()[action];
      if (typeof fn !== "function") throw new Error(`No store action: ${action}`);
      return await fn(...args);
    },
    { action, args }
  );
}

/** setState shortcut for arbitrary store fields.
 * Automatically converts Set values to arrays for JSON serialization, then
 * reconstructs them as Sets in the browser context. Map values are similarly
 * handled as [key, value] entry arrays.
 */
export async function setStoreState(page: Page, patch: Record<string, any>): Promise<void> {
  // Serialize Sets/Maps so they survive JSON serialization through page.evaluate.
  const setFields: string[] = [];
  const mapFields: string[] = [];
  const serializable: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v instanceof Set) {
      serializable[k] = [...v];
      setFields.push(k);
    } else if (v instanceof Map) {
      serializable[k] = [...v.entries()];
      mapFields.push(k);
    } else {
      serializable[k] = v;
    }
  }
  await page.evaluate(
    ({ p, setFields, mapFields }) => {
      const store = (window as any).__pindouStore;
      const patch: Record<string, any> = { ...p };
      for (const f of setFields) patch[f] = new Set(p[f]);
      for (const f of mapFields) patch[f] = new Map(p[f]);
      store.setState(patch);
    },
    { p: serializable, setFields, mapFields }
  );
}

/** Click a button by its visible text (handles emoji + text patterns). */
export async function clickButton(page: Page, text: string | RegExp): Promise<void> {
  await page.getByRole("button", { name: text }).first().click();
}

/**
 * Wait for the in-app AppDialog modal to appear and click 确定 to dismiss it.
 * Use this in place of `page.waitForEvent("dialog")` now that alert/prompt/confirm
 * are rendered as in-app modals (VS Code webviews disable native dialogs).
 */
export async function dismissAppAlert(page: Page, timeoutMs = 10_000): Promise<void> {
  const modal = page.locator("div.fixed.inset-0").filter({ hasText: /确定/ }).last();
  await modal.waitFor({ state: "visible", timeout: timeoutMs });
  await modal.getByRole("button", { name: /^确定$/ }).click();
}

/** Count non-transparent pixels on the largest rendered canvas. */
export async function countRenderedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvases = document.querySelectorAll("canvas");
    let best = 0;
    for (const canvas of canvases) {
      const ctx = canvas.getContext("2d");
      if (!ctx || canvas.width === 0 || canvas.height === 0) continue;
      const size = Math.min(canvas.width, canvas.height, 500);
      const imageData = ctx.getImageData(0, 0, size, size);
      let count = 0;
      for (let i = 3; i < imageData.data.length; i += 4) {
        if (imageData.data[i] > 0) count++;
      }
      if (count > best) best = count;
    }
    return best;
  });
}
