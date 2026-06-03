import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __PINDOU_VERSION__: JSON.stringify(`vscode-${pkg.version}`),
  },
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "../dist/webview"),
    emptyOutDir: true,
    cssCodeSplit: false,
    // Inline assets up to 8 KB as base64 data URLs. The 64x64 app icon is
    // ~5.5 KB; without this it ships as /assets/64x64.png which resolves to
    // the webview CDN root (vscode-cdn.net) and 404s — so the export header
    // band renders without an icon.
    assetsInlineLimit: 8192,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
      output: {
        // Single IIFE bundle — no code-splitting, no ES module imports.
        // VS Code webviews use a strict CSP with nonce-based script-src,
        // which blocks dynamically imported ES module chunks.
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "assets/index.js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  resolve: {
    alias: {
      // Allow importing from the main src directory
      "@": path.resolve(__dirname, "../../../src"),
    },
  },
});
