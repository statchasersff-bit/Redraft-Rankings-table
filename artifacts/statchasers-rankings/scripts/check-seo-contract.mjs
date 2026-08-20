// Asserts the SEO contract the tool is built to satisfy.
//
// These are properties that are easy to hold today and easy to lose in a later
// refactor — a filter rewritten as a link, a heading promoted to <h1>, a "nice"
// deep-linking feature that starts writing state into the URL. Each one is
// cheap to check mechanically, so the build checks it rather than trusting that
// nobody undoes it.
//
// The contract, and why each part exists:
//
//   1. Filter controls are <button>, never <a href="?...">. Google crawls normal
//      anchors, so faceted links spawn a large duplicate URL space over the same
//      content. https://developers.google.com/search/docs/crawling-indexing/crawling-managing-faceted-navigation
//   2. The tool never writes filter state into the crawlable URL. Nothing to
//      canonicalize away means no ?position=RB&scoring=ppr duplicates in the
//      first place. The fragment is the one exception — `#te` addresses the
//      same URL as far as crawling and indexing go, so it buys shareable links
//      at no SEO cost — and it is confined to src/lib/hash-state.ts so that
//      "no URL state" stays mechanically checkable for every other module.
//   3. The tool never touches <title>, <meta> or rel=canonical. Those belong to
//      the WordPress page, server-side, where they're in the initial response.
//   4. The tool emits no <h1>. The page owns exactly one, and the tool's <h2>
//      agrees with it instead of competing.
//   5. Anchors that do exist point at real destinations worth crawling — player
//      profile pages — not at tool state.
//   6. Those anchors carry descriptive text: a player link says the player's
//      name. "View Profile" repeated 250 times tells a crawler (or a screen
//      reader running through a link list) nothing about where any of them go.
//   7. The fragment declares no structured data. Schema for this page is built
//      by the WordPress plugin into Rank Math's existing graph, so a second
//      JSON-LD block here would describe the same page twice.
//
// Runs against the prerendered fragment (what search engines actually receive)
// and the modules that make up the embed bundle. Exits non-zero on a violation.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SCRIPT_DIR = import.meta.dirname;
const PKG_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(PKG_DIR, "..", "..");

const BUILT_FRAGMENT = path.join(PKG_DIR, "dist", "public", "embed", "rankings.html");
const COMMITTED_FRAGMENT = path.join(
  REPO_ROOT,
  "wordpress",
  "statchasers-tools",
  "assets",
  "prerendered",
  "rankings.html",
);

/** Modules that end up in the embed bundle or the prerender. */
const SOURCE_FILES = [
  "src/embed.tsx",
  "src/entry-server.tsx",
  "src/pages/Rankings.tsx",
  "src/lib/rankings-data.ts",
  "src/lib/url-state.ts",
  "src/hooks/use-isomorphic-layout-effect.ts",
];

/**
 * The one module permitted to touch `location` and `history`.
 *
 * Fragment-only deep linking is deliberate (see the contract note above), but
 * it is a narrow exemption: confining it to one small file is what keeps the
 * blanket rule enforceable everywhere else, and what makes the exemption itself
 * reviewable. HASH_STATE_RULES below constrain what it may do.
 */
const URL_STATE_FILE = "src/lib/url-state.ts";

/** Query keys that would represent tool state if they ever showed up in a URL. */
const STATE_PARAMS = ["position", "pos", "scoring", "format", "weeks", "week", "sort", "view", "tier"];

const failures = [];
const notes = [];

function fail(rule, detail) {
  failures.push(`${rule}: ${detail}`);
}

/* ── The prerendered fragment ─────────────────────────────────────────────── */

function checkFragment(html, label) {
  // 4. No <h1> anywhere in the tool.
  const h1 = html.match(/<h1[\s>]/gi);
  if (h1) {
    fail("no-h1", `${label} contains ${h1.length} <h1> element(s); the WordPress page owns the only H1`);
  }

  // 1 + 5. Every anchor is a real destination, not tool state.
  const hrefs = [...html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/gi)].map((m) => m[1]);
  if (hrefs.length === 0) {
    fail("profile-links", `${label} has no anchors at all — the player profile links should be present`);
  }
  for (const href of hrefs) {
    if (href.startsWith("?") || href.startsWith("#") || href.startsWith("/?")) {
      fail("buttons-not-links", `${label} has an anchor to tool state: href="${href}"`);
      continue;
    }
    const query = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
    const offender = STATE_PARAMS.find((p) => new RegExp(`(^|&)${p}=`, "i").test(query));
    if (offender) {
      fail("buttons-not-links", `${label} has an anchor carrying filter state "${offender}": href="${href}"`);
    }
    if (!/^https:\/\/statchasers\.com\//.test(href)) {
      fail("profile-links", `${label} has an unexpected anchor target: href="${href}"`);
    }
  }

  // 1. The position and scoring controls are buttons, and all of them are in the
  //    initial HTML — not conjured by a click.
  for (const pos of ["All", "QB", "RB", "WR", "TE"]) {
    const control = new RegExp(
      `<button\\b[^>]*data-testid="filter-position-${pos}"`,
      "i",
    );
    if (!control.test(html)) {
      fail("buttons-not-links", `${label} is missing a <button> for the ${pos} position filter`);
    }
  }
  for (const fmt of ["Standard", "Half-PPR", "PPR"]) {
    const control = new RegExp(`<button\\b[^>]*data-testid="filter-scoring-${fmt}"`, "i");
    if (!control.test(html)) {
      fail("buttons-not-links", `${label} is missing a <button> for the ${fmt} scoring filter`);
    }
  }

  // 3. No head tags smuggled into the fragment.
  for (const tag of ["<title", "<meta", "<link", 'rel="canonical"']) {
    if (html.toLowerCase().includes(tag.toLowerCase())) {
      fail("no-head-tags", `${label} contains ${tag}; page metadata is the WordPress page's job`);
    }
  }

  // 7. No structured data here — the plugin adds one node to Rank Math's graph.
  if (/application\/ld\+json/i.test(html)) {
    fail(
      "no-schema-in-fragment",
      `${label} contains a JSON-LD block; structured data belongs in the plugin, added to the SEO plugin's existing graph`,
    );
  }

  // 6. Player links are labelled with the player's name, not "View Profile".
  //    Anchors to a profile URL must contain text, and the one anchor per row
  //    that is still icon-only must be hidden from the accessibility tree.
  const profileAnchors = [
    ...html.matchAll(/<a\b([^>]*?)href="(https:\/\/statchasers\.com\/nfl\/players\/[^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi),
  ];
  if (profileAnchors.length === 0) {
    fail("descriptive-anchors", `${label} has no player profile links at all`);
  }
  let named = 0;
  for (const [, before, href, after, inner] of profileAnchors) {
    const attrs = `${before} ${after}`;
    const text = inner.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    const hidden = /aria-hidden="true"/i.test(attrs);

    if (hidden) continue; // the decorative duplicate; not exposed as a link
    if (text === "" || /^view profile$/i.test(text)) {
      fail(
        "descriptive-anchors",
        `${label} has a profile link labelled "${text || "(empty)"}" — anchor text should be the player's name (${href})`,
      );
      continue;
    }
    named++;
  }

  notes.push(
    `${label}: ${named} named player links, no H1, no head tags, no JSON-LD, filters are buttons`,
  );
}

/* ── The source that ships to the browser ─────────────────────────────────── */

const FORBIDDEN_SOURCE = [
  {
    rule: "no-url-state",
    pattern: /\b(?:history|window\.history)\.pushState\b/,
    why: "would add a history entry per filter click, and is the faceted-navigation pattern this contract exists to prevent",
  },
  {
    rule: "no-url-state",
    pattern: /\b(?:history|window\.history)\.replaceState\b/,
    why: `may only be called from ${URL_STATE_FILE}, and only for a path the plugin serves`,
    except: URL_STATE_FILE,
  },
  {
    rule: "no-url-state",
    pattern: /\blocation\.hash\b/,
    why: `URL handling belongs in ${URL_STATE_FILE}, where one place owns the format`,
    except: URL_STATE_FILE,
  },
  {
    rule: "no-url-state",
    pattern: /\bnew URLSearchParams\b|\blocation\.search\b/,
    why: "query-string state is crawlable, and would create the duplicate URL space this contract prevents",
    except: URL_STATE_FILE, // reads it, only to preserve it when rewriting the fragment
  },
  {
    rule: "no-url-state",
    pattern: /\blocation\.(?:href|search|pathname)\s*=[^=]|\blocation\.(?:assign|replace)\s*\(/,
    why: "navigates or rewrites the URL; filters must not change the page's address",
  },
  {
    rule: "no-head-tags",
    pattern: /\bdocument\.title\s*=/,
    why: "the title must come from the server, not from React after load",
  },
  {
    rule: "no-head-tags",
    pattern: /rel=["']canonical["']|querySelector\(\s*["'][^"']*(?:link\[rel|meta\[)/,
    why: "the canonical and meta tags must be in the initial HTML, unchanged by JS",
  },
];

async function checkSource(rel) {
  const file = path.join(PKG_DIR, rel);
  if (!existsSync(file)) {
    fail("source", `${rel} is missing — update SOURCE_FILES in this script`);
    return;
  }
  const src = await readFile(file, "utf8");
  // Comments describe the contract in these exact terms, so they'd trip the
  // patterns below; the checks are about executable code.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  for (const { rule, pattern, why, except } of FORBIDDEN_SOURCE) {
    if (except === rel) continue;
    const hit = code.match(pattern);
    if (hit) {
      fail(rule, `${rel} uses \`${hit[0]}\` — ${why}`);
    }
  }

  if (rel === URL_STATE_FILE) checkUrlState(code);
}

/**
 * The exempt module, held to the terms of its exemption.
 *
 * It may set the fragment. It may not navigate, and it must actually be
 * fragment-only — a `replaceState` reachable here with a path or query in it
 * would reintroduce exactly the crawlable state the contract forbids, from the
 * one file the general rules no longer cover.
 */
function checkUrlState(code) {
  for (const [pattern, why] of [
    [/\breplaceState\s*\([^)]*["'`]\?/, "builds a URL containing a query string"],
    [/\bwindow\.open\b|\blocation\.(?:assign|replace)\s*\(/, "navigates"],
    [/\bdocument\.title\s*=/, "writes the title"],
  ]) {
    const hit = code.match(pattern);
    if (hit) {
      fail("no-url-state", `${URL_STATE_FILE} ${why}: \`${hit[0].trim()}\``);
    }
  }

  if (!/\bfunction\s+formatRoute\b/.test(code)) {
    fail(
      "no-url-state",
      `${URL_STATE_FILE} no longer exports formatRoute — the path format must stay in one place`,
    );
  }

  // The whole reason paths are safe to write is that the plugin registered
  // rewrite rules for them. Writing one without a base path means writing a URL
  // nothing has agreed to serve, which 404s on reload.
  if (!/basePath === ""\) return;/.test(code)) {
    fail(
      "no-url-state",
      `${URL_STATE_FILE} must refuse to write a path when no base path was supplied`,
    );
  }
}

/* ── Run ──────────────────────────────────────────────────────────────────── */

async function main() {
  let checkedFragment = false;
  for (const [file, label] of [
    [BUILT_FRAGMENT, "built fragment"],
    [COMMITTED_FRAGMENT, "committed plugin fallback"],
  ]) {
    if (!existsSync(file)) continue;
    checkFragment(await readFile(file, "utf8"), label);
    checkedFragment = true;
  }
  if (!checkedFragment) {
    fail(
      "fragment",
      "no prerendered fragment found; run `pnpm run build` before checking, or commit the plugin fallback",
    );
  }

  await Promise.all(SOURCE_FILES.map(checkSource));

  for (const note of notes) console.log(`[seo-contract] ok  ${note}`);

  if (failures.length > 0) {
    console.error(`\n[seo-contract] ${failures.length} violation(s):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(
      "\nSee the contract documented at the top of scripts/check-seo-contract.mjs.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("[seo-contract] ok  source writes no URL state and no head tags");
}

main().catch((err) => {
  console.error(`[seo-contract] failed: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
