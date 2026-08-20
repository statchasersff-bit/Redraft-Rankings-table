import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

/**
 * The embed bundle is loaded into a live WordPress page, where a global
 * `:root { --spacing: ... }` block would silently redefine custom properties
 * the surrounding theme may rely on. Tailwind emits its theme variables under
 * `:root, :host`; this rewrites that selector onto the tool container so the
 * built stylesheet declares no global custom properties whatsoever.
 *
 * The selector is tripled to raise specificity above typical theme rules — see
 * the comment in src/embed.css for how the resulting cascade is meant to work.
 */
const EMBED_SCOPE = ".statchasers-tool.statchasers-tool.statchasers-tool";

function scopeEmbedCss(): Plugin {
  return {
    name: "statchasers-scope-embed-css",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "asset") continue;
        if (!/(^|\/)embed-[^/]*\.css$/.test(fileName)) continue;

        const css =
          typeof output.source === "string"
            ? output.source
            : Buffer.from(output.source).toString("utf8");

        const scoped = css.replace(
          /:root(\s*,\s*:host)?(?=\s*\{)/g,
          EMBED_SCOPE,
        );

        if (scoped === css) {
          this.warn(
            `${fileName}: no ':root' selector found to scope. If Tailwind's ` +
              `output format changed, the embed stylesheet may be leaking ` +
              `custom properties into the host page.`,
          );
        }
        output.source = scoped;
      }
    },
  };
}

const isBuild = process.env.NODE_ENV === "production" || process.argv.includes("build");

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 3000;

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    scopeEmbedCss(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // The WordPress plugin resolves the hashed filenames through this manifest,
    // so a redeploy of the app doesn't require touching the plugin.
    manifest: true,
    rollupOptions: {
      input: {
        // The standalone app at the tool's own URL.
        app: path.resolve(import.meta.dirname, "index.html"),
        // The bundle WordPress enqueues to hydrate the server-rendered markup.
        embed: path.resolve(import.meta.dirname, "src/embed.tsx"),
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
