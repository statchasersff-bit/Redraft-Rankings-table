// Packages wordpress/statchasers-tools/ into an installable WordPress zip.
//
//   node wordpress/build-plugin.mjs
//
// Run the tool's build first. The plugin ships a copy of the prerendered markup
// in assets/prerendered/, which is what a page renders when the app host can't
// be reached — so a zip built against a stale copy silently ships old rankings
// to anyone whose app host has a hiccup. This script refuses to build in that
// state rather than producing a plausible-looking but stale artifact.
//
// Output: wordpress/dist/statchasers-tools-<version>.zip
// (`dist` is gitignored, so the zip is a build product, not a tracked file.)

import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const SCRIPT_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SLUG = "statchasers-tools";
const PLUGIN_DIR = path.join(SCRIPT_DIR, SLUG);
const OUT_DIR = path.join(SCRIPT_DIR, "dist");

/** Where the tool's build writes the files the plugin bundles as a fallback. */
const TOOL_EMBED_DIR = path.join(
  REPO_ROOT,
  "artifacts",
  "statchasers-rankings",
  "dist",
  "public",
  "embed",
);

/** Bundled fallbacks, and the built file each must match. */
const FALLBACKS = ["rankings.html", "assets.json", "tool-meta.json"];

const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

/**
 * The plugin version, asserted to be declared consistently.
 *
 * WordPress reads the header comment to decide whether an installed copy is
 * outdated; the constant is what the code actually uses. If they disagree, the
 * update prompt and the runtime disagree too.
 */
async function readVersion() {
  const php = await readFile(path.join(PLUGIN_DIR, `${SLUG}.php`), "utf8");

  const header = php.match(/^\s*\*\s*Version:\s*(\S+)\s*$/m)?.[1];
  const constant = php.match(
    /define\(\s*'STATCHASERS_TOOLS_VERSION'\s*,\s*'([^']+)'\s*\)/,
  )?.[1];

  if (!header) fail("no `Version:` in the plugin header");
  if (!constant) fail("no STATCHASERS_TOOLS_VERSION constant");
  if (header && constant && header !== constant) {
    fail(
      `version mismatch: header says ${header}, STATCHASERS_TOOLS_VERSION says ${constant}`,
    );
  }
  if (header && !/^\d+\.\d+(\.\d+)?$/.test(header)) {
    fail(`version "${header}" is not a plain dotted number`);
  }

  return header ?? constant ?? "0.0.0";
}

/** The bundled fallbacks must be real, and must match the current tool build. */
async function checkFallbacks() {
  const dir = path.join(PLUGIN_DIR, "assets", "prerendered");

  for (const name of FALLBACKS) {
    const file = path.join(dir, name);
    if (!existsSync(file)) {
      fail(`missing bundled fallback: assets/prerendered/${name}`);
      continue;
    }

    const body = await readFile(file, "utf8");

    // Same validity checks the plugin applies at runtime, so a zip can't ship
    // something the plugin would reject and render as an empty container.
    if (name === "rankings.html") {
      if (
        !body.includes('data-statchasers-tool="rankings"') ||
        !body.includes("data-statchasers-root")
      ) {
        fail("assets/prerendered/rankings.html is not a valid tool fragment");
      }
      if (/<h1[\s>]/i.test(body)) {
        fail("assets/prerendered/rankings.html contains an <h1>; the page owns the only H1");
      }
    } else {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        fail(`assets/prerendered/${name} is not valid JSON: ${err.message}`);
        continue;
      }
      if (name === "assets.json" && !parsed.js) {
        fail("assets/prerendered/assets.json has no `js` entry");
      }
      if (name === "tool-meta.json" && !parsed.name) {
        fail("assets/prerendered/tool-meta.json has no `name`");
      }
    }

    // Staleness: compare against what the tool's build most recently produced.
    const built = path.join(TOOL_EMBED_DIR, name);
    if (existsSync(built)) {
      const fresh = await readFile(built, "utf8");
      if (fresh !== body) {
        fail(
          `assets/prerendered/${name} differs from the current tool build — ` +
            `run \`pnpm --filter @workspace/statchasers-rankings build\` first`,
        );
      }
    } else {
      notes.push(
        `could not verify ${name} against a tool build (no dist/public/embed/${name})`,
      );
    }
  }
}

/** Everything that goes in the zip, for the manifest printed at the end. */
async function listFiles(dir, base = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await listFiles(path.join(dir, entry.name), rel)));
    } else {
      out.push(rel);
    }
  }
  return out.sort();
}

async function main() {
  if (!existsSync(PLUGIN_DIR)) {
    console.error(`[plugin-zip] no plugin at ${PLUGIN_DIR}`);
    process.exitCode = 1;
    return;
  }

  const version = await readVersion();
  await checkFallbacks();

  if (problems.length > 0) {
    console.error(`[plugin-zip] refusing to build:\n`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });

  const zipName = `${SLUG}-${version}.zip`;
  const zipPath = path.join(OUT_DIR, zipName);
  await rm(zipPath, { force: true });

  // Zipped from wordpress/ so the archive contains a top-level
  // statchasers-tools/ directory, which is what WordPress expects when
  // installing from a file. -X drops platform extras that add noise.
  await run("zip", ["-r", "-q", "-X", path.join("dist", zipName), SLUG], {
    cwd: SCRIPT_DIR,
  });

  const files = await listFiles(PLUGIN_DIR);
  const { size } = await stat(zipPath);

  console.log(`[plugin-zip] ${SLUG} ${version}`);
  console.log(`[plugin-zip] ${files.length} files, ${(size / 1024).toFixed(1)} kB\n`);
  for (const file of files) console.log(`  ${SLUG}/${file}`);
  for (const note of notes) console.log(`\n  note: ${note}`);
  console.log(`\n[plugin-zip] wrote ${path.relative(REPO_ROOT, zipPath)}`);
  console.log(
    `[plugin-zip] install: WP Admin → Plugins → Add New → Upload Plugin.\n` +
      `             Replacing an existing copy keeps settings; the cache is\n` +
      `             cleared automatically on upgrade.`,
  );
}

main().catch((err) => {
  console.error(`[plugin-zip] failed: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
