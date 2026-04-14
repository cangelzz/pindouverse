import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "../dist/webview"),
    emptyOutDir: true,
    cssCodeSplit: false,
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
