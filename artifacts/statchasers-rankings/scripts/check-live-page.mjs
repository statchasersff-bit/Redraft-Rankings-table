// Asserts the public WordPress page against what a crawler actually receives.
//
// This fetches the URL with a plain HTTP GET and never executes JavaScript,
// which is the point: it is the closest cheap approximation of a crawler that
// has not run the page's scripts. It catches the failure this whole setup
// exists to prevent — a React or plugin change that quietly turns the tool back
// into an empty container, leaving the page indexed with a heading and nothing
// underneath it.
//
// It is deliberately run against the deployed page rather than the build
// output, because most of what it checks is contributed by WordPress and Rank
// Math and cannot be seen from this repo at all.
//
//   node scripts/check-live-page.mjs https://statchasers.com/nfl/…/
//   STATCHASERS_PAGE_URL=… node scripts/check-live-page.mjs
//
// The list of player names to look for is read from the local build, so it
// keeps matching the data without anyone maintaining a fixture.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SCRIPT_DIR = import.meta.dirname;
const PKG_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(PKG_DIR, "..", "..");

const PAYLOAD_PATHS = [
  path.join(PKG_DIR, "dist", "public", "embed", "rankings.json"),
];
const FRAGMENT_PATHS = [
  path.join(PKG_DIR, "dist", "public", "embed", "rankings.html"),
  path.join(REPO_ROOT, "wordpress", "statchasers-tools", "assets", "prerendered", "rankings.html"),
];

/** How many player names must appear in the HTML for the data to count as present. */
const SAMPLE_SIZE = 12;

const url = process.argv[2] ?? process.env.STATCHASERS_PAGE_URL;

const failures = [];
const warnings = [];
const oks = [];

const fail = (rule, detail) => failures.push(`${rule}: ${detail}`);
const warn = (rule, detail) => warnings.push(`${rule}: ${detail}`);
const ok = (detail) => oks.push(detail);

/** Text content of the first matching element, tags stripped. */
function elementText(html, tag) {
  const m = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : null;
}

function metaContent(html, attr, value) {
  const re = new RegExp(
    `<meta\\b[^>]*${attr}=["']${value}["'][^>]*>`,
    "i",
  );
  const tag = html.match(re);
  if (!tag) return null;
  const content = tag[0].match(/content=["']([\s\S]*?)["']/i);
  return content ? content[1].trim() : null;
}

/** Player names from the built payload, spread across the rank range. */
async function samplePlayers() {
  for (const file of PAYLOAD_PATHS) {
    if (!existsSync(file)) continue;
    const payload = JSON.parse(await readFile(file, "utf8"));
    const players = (payload.players ?? []).filter((p) => p.player);
    if (players.length === 0) continue;
    const step = Math.max(1, Math.floor(players.length / SAMPLE_SIZE));
    return players
      .filter((_, i) => i % step === 0)
      .slice(0, SAMPLE_SIZE)
      .map((p) => p.player);
  }
  return null;
}

/* ── checks ───────────────────────────────────────────────────────────────── */

function checkHeadings(html) {
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (h1s.length === 0) {
    fail("h1", "the page has no <h1> in its server HTML");
  } else if (h1s.length > 1) {
    fail("h1", `the page has ${h1s.length} <h1> elements; there should be exactly one`);
  } else {
    const text = h1s[0][1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (text === "") {
      fail("h1", "the <h1> is empty");
    } else {
      ok(`h1: "${text}"`);
      return text;
    }
  }
  return null;
}

function checkTitles(html, h1) {
  const title = elementText(html, "title");
  if (!title) {
    fail("title", "no <title> in the server HTML");
  } else {
    ok(`title: "${title}"`);
  }

  const ogTitle = metaContent(html, "property", "og:title");
  if (!ogTitle) {
    warn("og:title", "no og:title; Google may use it when deriving a result title");
  } else {
    ok(`og:title: "${ogTitle}"`);
  }

  // Google may derive the result title from any of these, so disagreement is
  // worth surfacing — but wording differences are a judgement call, not a
  // build-breaking error.
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const key = "strength of schedule|redraft rankings|rankings";
  if (title && h1) {
    const overlap = new RegExp(key, "i");
    const a = overlap.exec(norm(title));
    const b = overlap.exec(norm(h1));
    if (a && b && a[0] !== b[0]) {
      warn("title-agreement", `<title> and <h1> describe the page differently ("${a[0]}" vs "${b[0]}")`);
    }
  }
  if (title && ogTitle && norm(title) !== norm(ogTitle) && !norm(title).includes(norm(ogTitle))) {
    warn("title-agreement", `<title> and og:title differ: "${title}" vs "${ogTitle}"`);
  }
}

function checkDescription(html) {
  const desc = metaContent(html, "name", "description");
  if (!desc) {
    fail("meta-description", "no meta description in the server HTML");
  } else if (desc.length < 50) {
    warn("meta-description", `meta description is only ${desc.length} characters: "${desc}"`);
  } else {
    ok(`meta description: ${desc.length} chars`);
  }
}

function checkCanonical(html, requested) {
  const tags = [...html.matchAll(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi)];
  if (tags.length === 0) {
    fail("canonical", "no rel=canonical in the server HTML");
    return;
  }
  if (tags.length > 1) {
    fail("canonical", `${tags.length} rel=canonical tags; there must be exactly one`);
    return;
  }

  const href = tags[0][0].match(/href=["']([^"']+)["']/i)?.[1];
  if (!href) {
    fail("canonical", "the rel=canonical tag has no href");
    return;
  }

  if (href.includes("?")) {
    fail("canonical", `the canonical carries a query string: ${href}`);
    return;
  }

  const same = (a, b) => {
    try {
      const ua = new URL(a);
      const ub = new URL(b);
      return ua.host === ub.host && ua.pathname.replace(/\/$/, "") === ub.pathname.replace(/\/$/, "");
    } catch {
      return false;
    }
  };

  if (!same(href, requested)) {
    fail("canonical", `the canonical (${href}) is not self-referencing for ${requested}`);
  } else {
    ok(`canonical: ${href}`);
  }
}

function checkRobots(html) {
  const robots = metaContent(html, "name", "robots");
  if (robots && /\bnoindex\b/i.test(robots)) {
    fail("robots", `the page is noindex: "${robots}"`);
  } else if (robots) {
    ok(`robots: "${robots}"`);
  }
}

function checkStructuredData(html, requested) {
  const blocks = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (blocks.length === 0) {
    fail("structured-data", "no JSON-LD in the server HTML");
    return;
  }

  const nodes = [];
  for (const [, raw] of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(raw.trim());
    } catch (err) {
      fail("structured-data", `a JSON-LD block does not parse: ${err.message}`);
      continue;
    }
    const graph = parsed["@graph"] ?? parsed;
    nodes.push(...(Array.isArray(graph) ? graph : [graph]));
  }

  const typesOf = (n) => (n && n["@type"] ? [].concat(n["@type"]) : []);
  const app = nodes.find((n) => typesOf(n).some((t) => /^(WebApplication|SoftwareApplication|SportsApplication)$/.test(t)));

  if (!app) {
    fail(
      "structured-data",
      `no WebApplication node; found types: ${[...new Set(nodes.flatMap(typesOf))].join(", ") || "(none)"}`,
    );
  } else {
    ok(`structured data: ${typesOf(app).join(" + ")} "${app.name ?? "(unnamed)"}"`);

    for (const field of ["name", "url", "applicationCategory"]) {
      if (!app[field]) fail("structured-data", `the application node has no ${field}`);
    }
    if (app.url && !app.url.startsWith(new URL(requested).origin)) {
      warn("structured-data", `the application node's url (${app.url}) is on another origin`);
    }
    // Fabricated ratings are a spam policy violation, so assert their absence
    // rather than merely not adding them.
    if (app.aggregateRating || app.review) {
      fail("structured-data", "the application node declares a rating or review; these must be real or absent");
    }
  }

  // Breadcrumbs should come from Rank Math. Missing is a warning, duplicated is
  // a real problem.
  const crumbs = nodes.filter((n) => typesOf(n).includes("BreadcrumbList"));
  if (crumbs.length === 0) {
    warn("structured-data", "no BreadcrumbList; Rank Math normally emits one");
  } else if (crumbs.length > 1) {
    fail("structured-data", `${crumbs.length} BreadcrumbList nodes; the graph is duplicated`);
  } else {
    ok("structured data: one BreadcrumbList, from the SEO plugin");
  }

  const pages = nodes.filter((n) => typesOf(n).some((t) => /^(WebPage|CollectionPage|ItemPage)$/.test(t)));
  if (pages.length > 1) {
    fail("structured-data", `${pages.length} WebPage nodes; the graph is duplicated`);
  }
}

async function checkToolContent(html) {
  if (!html.includes('data-statchasers-tool="rankings"')) {
    fail("tool", "the tool container is not in the server HTML at all");
    return;
  }
  if (html.includes('data-prerendered="0"')) {
    fail(
      "tool",
      "the tool rendered as an empty container — the plugin could not fetch the prerendered markup, so a crawler sees no rankings",
    );
    return;
  }
  ok("the tool is server-rendered into the page");

  // The actual ranking data, which is the thing that must never silently vanish.
  const sample = await samplePlayers();
  if (!sample) {
    warn("data", "no local build to sample player names from; run `pnpm run build` first");
  } else {
    const missing = sample.filter((name) => !html.includes(name));
    if (missing.length > 0) {
      fail(
        "data",
        `${missing.length}/${sample.length} sampled players are absent from the HTML (e.g. ${missing.slice(0, 3).join(", ")})`,
      );
    } else {
      ok(`all ${sample.length} sampled players present (${sample.slice(0, 3).join(", ")}…)`);
    }
  }

  // Every position must be present without a click, on the crawled HTML.
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    if (!new RegExp(`data-testid="filter-position-${pos}"`).test(html)) {
      fail("tool", `no ${pos} filter control in the server HTML`);
    }
  }
  const panels = (html.match(/role="tabpanel"/g) ?? []).length;
  if (panels < 5) {
    fail("tool", `only ${panels} tab panels in the HTML; all five should render server-side`);
  } else {
    ok(`${panels} position panels server-rendered`);
  }

  // Faceted URLs must not have appeared.
  const faceted = [...html.matchAll(/<a\b[^>]*href="[^"]*[?&](position|scoring|weeks|sort)=[^"]*"/gi)];
  if (faceted.length > 0) {
    fail("filters", `${faceted.length} anchors carry filter state in the URL`);
  } else {
    ok("no faceted filter URLs");
  }

}

function checkFreshness(html) {
  const iso = html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1];
  if (!iso) {
    warn("freshness", "no <time datetime> for the last-updated stamp");
    return;
  }
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) {
    fail("freshness", `the last-updated timestamp does not parse: "${iso}"`);
    return;
  }
  // A timestamp that tracks "now" means it is being regenerated per request
  // rather than reflecting a real data change.
  const ageMinutes = (Date.now() - when.getTime()) / 60000;
  if (ageMinutes < 2) {
    fail(
      "freshness",
      `the last-updated timestamp is ${ageMinutes.toFixed(1)} minutes old, which suggests it is stamped per request rather than when the data actually changed`,
    );
  } else {
    ok(`last updated ${iso} (${Math.round(ageMinutes / 1440)} days ago)`);
  }
}

async function checkSitemap(requested) {
  const origin = new URL(requested).origin;
  const candidates = ["/sitemap_index.xml", "/sitemap.xml", "/wp-sitemap.xml"];

  for (const candidate of candidates) {
    let res;
    try {
      res = await fetch(origin + candidate, { redirect: "follow" });
    } catch {
      continue;
    }
    if (!res.ok) continue;

    const xml = await res.text();
    const wanted = new URL(requested).pathname.replace(/\/$/, "");

    if (xml.includes(wanted)) {
      ok(`the page's URL appears in ${candidate}`);
      return;
    }

    // Index sitemaps point at child sitemaps; follow the page ones.
    const children = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => m[1])
      .filter((u) => /\.xml$/.test(u))
      .slice(0, 10);

    for (const child of children) {
      try {
        const cr = await fetch(child);
        if (!cr.ok) continue;
        const cx = await cr.text();
        if (cx.includes(wanted)) {
          const lastmod = cx.match(
            new RegExp(`${wanted}[\\s\\S]{0,200}?<lastmod>([^<]+)</lastmod>`),
          )?.[1];
          ok(`the page's URL appears in ${child}${lastmod ? ` (lastmod ${lastmod})` : " (no lastmod)"}`);
          if (!lastmod) {
            warn("sitemap", "the sitemap entry has no <lastmod>");
          }
          return;
        }
      } catch {
        /* keep looking */
      }
    }
    warn("sitemap", `found ${candidate} but could not locate ${wanted} in it or its children`);
    return;
  }

  warn("sitemap", "no sitemap found at the usual locations; verify the URL is listed");
}

async function checkRobotsTxt(requested) {
  const origin = new URL(requested).origin;
  let res;
  try {
    res = await fetch(`${origin}/robots.txt`);
  } catch {
    warn("robots.txt", "could not fetch robots.txt");
    return;
  }
  if (!res.ok) {
    ok("no robots.txt restrictions (none served)");
    return;
  }

  const txt = await res.text();
  // Blocking the tool's JS or CSS stops Google rendering the interactive
  // version, even though the server HTML would still be readable.
  const risky = [...txt.matchAll(/^\s*Disallow:\s*(\S+)/gim)]
    .map((m) => m[1])
    .filter((p) => /\.(js|css)|\/assets|\/embed|\/wp-content|\/wp-includes/i.test(p));

  if (risky.length > 0) {
    fail("robots.txt", `rules that may block rendering resources: ${risky.join(", ")}`);
  } else {
    ok("robots.txt does not block script or style resources");
  }
}

/* ── run ──────────────────────────────────────────────────────────────────── */

async function main() {
  if (!url) {
    console.error(
      "usage: node scripts/check-live-page.mjs <url>\n" +
        "   or: STATCHASERS_PAGE_URL=<url> node scripts/check-live-page.mjs\n\n" +
        "Checks the deployed WordPress page the way a crawler sees it, without\n" +
        "running any JavaScript.",
    );
    process.exitCode = 2;
    return;
  }

  console.log(`[live-page] GET ${url} (no JavaScript executed)\n`);

  let res;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: {
        // Identify honestly; do not impersonate Googlebot.
        "user-agent": "StatChasers-SEO-Check/1.0 (+https://statchasers.com)",
        accept: "text/html",
      },
    });
  } catch (err) {
    console.error(`[live-page] request failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (!res.ok) {
    console.error(`[live-page] HTTP ${res.status} ${res.statusText}`);
    process.exitCode = 1;
    return;
  }

  const finalUrl = res.url || url;
  const html = await res.text();
  ok(`HTTP ${res.status}, ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB of HTML`);

  const h1 = checkHeadings(html);
  checkTitles(html, h1);
  checkDescription(html);
  checkCanonical(html, finalUrl);
  checkRobots(html);
  checkStructuredData(html, finalUrl);
  await checkToolContent(html);
  checkFreshness(html);
  await checkSitemap(finalUrl);
  await checkRobotsTxt(finalUrl);

  for (const line of oks) console.log(`  ok    ${line}`);
  for (const line of warnings) console.log(`  warn  ${line}`);
  for (const line of failures) console.error(`  FAIL  ${line}`);

  console.log(
    `\n[live-page] ${oks.length} ok, ${warnings.length} warning(s), ${failures.length} failure(s)`,
  );

  if (failures.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[live-page] failed: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
