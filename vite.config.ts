import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_PAGES === "true" ? "/GunnMap/" : "/",
  plugins: [react()],
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: resolve(process.cwd(), "web/src/app/main.tsx"),
      output: {
        entryFileNames: "main.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (asset) => asset.name?.endsWith(".css") ? "ui.css" : "assets/[name]-[hash][extname]",
      },
    },
    cssCodeSplit: false,
  },
});
