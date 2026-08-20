// Node build of the prerenderer. `scripts/prerender.mjs` imports the output to
// render the rankings to HTML at build time; nothing here ships to the browser.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(import.meta.dirname),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    ssr: path.resolve(import.meta.dirname, "src/entry-server.tsx"),
    outDir: path.resolve(import.meta.dirname, "dist/ssr"),
    emptyOutDir: true,
    // Dependencies stay external and are resolved from node_modules at render
    // time, which keeps this build fast and the output readable.
    rollupOptions: {
      output: {
        format: "esm",
        entryFileNames: "entry-server.mjs",
      },
    },
  },
});
