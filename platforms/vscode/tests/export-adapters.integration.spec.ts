import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import path from "node:path";

let server: ViteDevServer;
let origin: string;

const root = path.resolve(__dirname, "../../..");

function html(): string {
  return `<!doctype html><html><body><script>
    window.__hostWrites = [];
    window.acquireVsCodeApi = () => ({
      getState() {}, setState() {},
      postMessage(message) {
        if (message.type === 'writeFile') {
          window.__hostWrites.push(message);
          queueMicrotask(() =>
            window.dispatchEvent(new MessageEvent('message', {
              data: { type: 'fileResult', requestId: message.requestId, success: true }
            }))
          );
        }
      }
    });
  </script><script type="module" src="/platforms/vscode/tests/fixtures/export-adapters-entry.ts"></script></body></html>`;
}

test.beforeAll(async () => {
  server = await createServer({
    root,
    resolve: { alias: { "@": path.resolve(root, "src") } },
    plugins: [{
      name: "export-adapter-contract-page",
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url !== "/__export_adapters__.html") return next();
          response.setHeader("Content-Type", "text/html");
          response.end(await vite.transformIndexHtml(request.url, html()));
        });
      },
    }],
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite test server did not bind");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => { await server?.close(); });

async function captured(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const browser = (window as any).__adapterDownloads[0];
    const host = (window as any).__hostWrites.at(-1);
    const browserBytes = new Uint8Array(await browser.blob.arrayBuffer());
    const vscodeBytes = Uint8Array.from(atob(host.data), (char) => char.charCodeAt(0));
    const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map((value) => value.toString(16).padStart(2, "0")).join("");
    const dimensions = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob);
      const result = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return result;
    };
    return {
      browser: { mime: browser.blob.type, filename: browser.filename, hash: await digest(browserBytes), dimensions: await dimensions(browser.blob) },
      vscode: { mime: new Blob([vscodeBytes], { type: browser.blob.type }).type, path: host.path, hash: await digest(vscodeBytes), dimensions: await dimensions(new Blob([vscodeBytes], { type: browser.blob.type })) },
    };
  });
}

test("actual Browser and VS Code adapters export identical decorated PNG bytes", async ({ page }) => {
  await page.goto(`${origin}/__export_adapters__.html`);
  await page.evaluate(async () => {
    const cells = [
      [{ color_code: "A1", r: 240, g: 20, b: 30 }, { color_code: "H1", r: 255, g: 255, b: 255 }],
      [null, { color_code: "B2", r: 20, g: 40, b: 220 }],
    ];
    await (window as any).__runBlueprintAdapterContract({
      width: 2, height: 2, cell_size: 24, cells,
      output_path: "/out/contract.png", format: "png",
      start_x: 7, start_y: 9, edge_padding: 0,
      watermark: { show_header: true, app_description: "Contract Title - Author", watermark_lines: ["Author", "PindouVerse"] },
      legend_options: { include_by_count: true, include_by_name: true },
      labels: {
        legendByCount: "By count ({{colors}} colors, {{beads}} beads)",
        legendByCode: "By code ({{colors}} colors)",
      },
    });
  });
  const result = await captured(page);
  expect(result.browser.mime).toBe("image/png");
  expect(result.browser.filename).toBe("contract.png");
  expect(result.vscode.path).toBe("/out/contract.png");
  expect(result.browser.dimensions).toEqual(result.vscode.dimensions);
  expect(result.browser.hash).toBe(result.vscode.hash);
});

test("actual Browser and VS Code adapters export identical preview JPEG bytes", async ({ page }) => {
  await page.goto(`${origin}/__export_adapters__.html`);
  await page.evaluate(async () => {
    await (window as any).__runPreviewAdapterContract({
      width: 2, height: 2, pixel_size: 16,
      cells: [[{ color_code: "A1", r: 240, g: 20, b: 30 }, { color_code: "H1", r: 255, g: 255, b: 255 }], [null, { color_code: "B2", r: 20, g: 40, b: 220 }]],
      output_path: "/out/contract-preview.jpg",
      watermark: { show_header: true, app_description: "Preview", watermark_lines: ["Author"] },
    });
  });
  const result = await captured(page);
  expect(result.browser.mime).toBe("image/jpeg");
  expect(result.browser.dimensions).toEqual(result.vscode.dimensions);
  expect(result.browser.hash).toBe(result.vscode.hash);
});
