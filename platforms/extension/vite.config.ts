import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync, existsSync } from "fs";

export default defineConfig({
  root: resolve(__dirname),
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "copy-extension-files",
      closeBundle() {
        const outDir = resolve(__dirname, "dist");
        // Copy manifest.json
        copyFileSync(
          resolve(__dirname, "manifest.json"),
          resolve(outDir, "manifest.json")
        );
        // Copy icons from src-tauri
        const iconsDir = resolve(outDir, "icons");
        if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
        const srcIcons = resolve(__dirname, "../../src-tauri/icons");
        for (const name of ["32x32.png", "128x128.png"]) {
          const src = resolve(srcIcons, name);
          if (existsSync(src)) {
            copyFileSync(src, resolve(iconsDir, name));
          }
        }
      },
    },
  ],
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "../../src"),
    },
  },
});
