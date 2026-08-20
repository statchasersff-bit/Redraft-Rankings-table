// Build-time static render of the rankings tool.
//
// Turns public/rankings.csv (plus NFL team abbreviations from Sleeper) into a
// self-contained HTML fragment. That fragment is what the WordPress plugin
// prints into the page, so the very first HTML response already carries player
// names, teams, ranks, tiers and table headings for QB, RB, WR and TE — no
// JavaScript, no API call and no tab click required to see any of it.
//
// One fragment is emitted per scoring format, because scoring changes the
// rankings themselves — a board prerendered at PPR cannot be turned into the
// Standard board by the plugin. Position is not a content difference (every
// panel is rendered either way; only which one is `hidden` changes), so the
// client applies it before first paint rather than the build multiplying every
// fragment by five.
//
// Outputs:
//   dist/public/embed/rankings.html            fragment at the default scoring
//   dist/public/embed/rankings-<scoring>.html   one per scoring format
//   dist/public/embed/rankings.json            the same payload on its own
//   <plugin>/assets/prerendered/…              committed fallback used when the
//                                              plugin cannot reach the app host

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SCRIPT_DIR = import.meta.dirname;
const PKG_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(PKG_DIR, "..", "..");

const CSV_PATH = path.join(PKG_DIR, "public", "rankings.csv");
const META_PATH = path.join(PKG_DIR, "public", "rankings.meta.json");
const TEAM_CACHE_PATH = path.join(PKG_DIR, "public", "team-map.json");

const CLIENT_DIR = path.join(PKG_DIR, "dist", "public");
const EMBED_OUT_DIR = path.join(CLIENT_DIR, "embed");
const MANIFEST_PATH = path.join(CLIENT_DIR, ".vite", "manifest.json");
const SSR_ENTRY = path.join(PKG_DIR, "dist", "ssr", "entry-server.mjs");

const PLUGIN_DIR = path.join(REPO_ROOT, "wordpress", "statchasers-tools");
const PLUGIN_FALLBACK_DIR = path.join(PLUGIN_DIR, "assets", "prerendered");

const SLEEPER_URL = "https://api.sleeper.app/v1/players/nfl";
const SLEEPER_TIMEOUT_MS = 45_000;

const FALLBACK_META = {
  name: "2026 Fantasy Football Redraft Rankings",
  description:
    "Free interactive fantasy football redraft rankings with tiered quarterback, running back, wide receiver and tight end boards.",
  updatedAt: "August 3, 2026",
  updatedAtIso: "2026-08-03T00:00:00-04:00",
};

function log(message) {
  console.log(`[prerender] ${message}`);
}

async function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    log(`could not parse ${path.relative(PKG_DIR, file)}: ${err.message}`);
    return fallback;
  }
}

/**
 * Full name -> team abbreviation for every active NFL player.
 *
 * Sleeper is a build-time dependency only. If it's unreachable we fall back to
 * the last successful response so an offline or rate-limited build still emits
 * team abbreviations rather than silently dropping them from the HTML.
 */
async function loadTeamMap(normalizeName) {
  try {
    const res = await fetch(SLEEPER_URL, {
      signal: AbortSignal.timeout(SLEEPER_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const players = await res.json();
    const map = {};
    for (const player of Object.values(players)) {
      if (player?.full_name && player?.team) {
        map[normalizeName(player.full_name)] = player.team;
      }
    }
    if (Object.keys(map).length === 0) throw new Error("empty response");

    await writeFile(TEAM_CACHE_PATH, `${JSON.stringify(map, null, 0)}\n`);
    log(`fetched ${Object.keys(map).length} team assignments from Sleeper`);
    return map;
  } catch (err) {
    log(`Sleeper fetch failed (${err.message}); falling back to cache`);
    const cached = await readJson(TEAM_CACHE_PATH, {});
    const size = Object.keys(cached).length;
    log(size ? `using ${size} cached team assignments` : "no cached team map available");
    return cached;
  }
}

async function main() {
  if (!existsSync(SSR_ENTRY)) {
    throw new Error(
      `missing ${path.relative(PKG_DIR, SSR_ENTRY)} — run the SSR build first ` +
        `(pnpm run build:ssr)`,
    );
  }

  const {
    parseRankingsCsv,
    normalizeName,
    pickTeamsForPlayers,
    renderRankingsFragment,
    POSITION_SLUGS,
    SCORING_SLUGS,
    SCORING_FORMATS,
  } = await import(`file://${SSR_ENTRY}`);

  const csv = await readFile(CSV_PATH, "utf8");
  const players = parseRankingsCsv(csv);
  if (players.length === 0) {
    throw new Error(`${path.relative(PKG_DIR, CSV_PATH)} produced no players`);
  }

  const meta = await readJson(META_PATH, FALLBACK_META);
  const allTeams = await loadTeamMap(normalizeName);
  const teams = pickTeamsForPlayers(players, allTeams);

  const payload = {
    players,
    teams,
    updatedAt: meta.updatedAt ?? FALLBACK_META.updatedAt,
    generatedAt: meta.updatedAtIso ?? FALLBACK_META.updatedAtIso,
  };

  // Keyed by slug so the filename, the container attribute and the plugin's
  // rewrite rules all name the scoring format the same way.
  const DEFAULT_SCORING_SLUG = "ppr";
  // SCORING_SLUGS is derived from SCORING_FORMATS in the same module, so the
  // two are parallel by construction rather than by anyone keeping them so.
  const fragments = new Map(
    SCORING_SLUGS.map((slug, index) => [
      slug,
      renderRankingsFragment(payload, { scoring: SCORING_FORMATS[index] }),
    ]),
  );
  const fragment = fragments.get(DEFAULT_SCORING_SLUG);
  if (!fragment) {
    throw new Error(`no fragment rendered for the default scoring format`);
  }

  // A small file the WordPress plugin reads to build the tool's structured
  // data. The tool renders no heading of its own — the WordPress page's H1
  // names it — so this is where the schema's name lives, alongside the
  // description and date, rather than being retyped into PHP where it would
  // quietly drift. Kept separate from rankings.json so the plugin isn't
  // decoding a 200 kB player payload on a page view.
  const toolMeta = {
    name: meta.name ?? FALLBACK_META.name,
    description: meta.description ?? FALLBACK_META.description,
    dateModified: payload.generatedAt,
    updatedAt: payload.updatedAt,
    playerCount: players.length,
    // The plugin builds its rewrite rules from these, so the URLs it agrees to
    // serve are exactly the ones the tool is willing to produce. Retyping them
    // into PHP would let the two drift, and the failure mode of that drift is a
    // 404 on a URL the tool just wrote into the address bar.
    routes: {
      scoring: SCORING_SLUGS,
      positions: POSITION_SLUGS,
      defaultScoring: DEFAULT_SCORING_SLUG,
    },
  };

  await mkdir(EMBED_OUT_DIR, { recursive: true });
  await writeFile(path.join(EMBED_OUT_DIR, "rankings.html"), fragment);
  for (const [slug, html] of fragments) {
    await writeFile(path.join(EMBED_OUT_DIR, `rankings-${slug}.html`), html);
  }
  await writeFile(
    path.join(EMBED_OUT_DIR, "rankings.json"),
    `${JSON.stringify(payload)}\n`,
  );
  await writeFile(
    path.join(EMBED_OUT_DIR, "tool-meta.json"),
    `${JSON.stringify(toolMeta, null, 2)}\n`,
  );

  // Snapshot the hashed asset names so the plugin can enqueue the right files
  // even when it cannot reach the app host to read the live manifest.
  const manifest = await readJson(MANIFEST_PATH, null);
  const embedEntry = manifest?.["src/embed.tsx"];
  const assets = embedEntry
    ? {
        js: embedEntry.file,
        css: embedEntry.css ?? [],
        // The entry itself is tiny and statically imports the bulk of the app.
        // Listing those chunks lets the plugin emit `modulepreload` hints so the
        // browser doesn't discover them only after parsing the entry.
        imports: (embedEntry.imports ?? [])
          .map((key) => manifest?.[key]?.file)
          .filter(Boolean),
      }
    : null;
  if (assets) {
    await writeFile(
      path.join(EMBED_OUT_DIR, "assets.json"),
      `${JSON.stringify(assets, null, 2)}\n`,
    );
  } else {
    log("WARNING: no embed entry in the Vite manifest; assets.json not written");
  }

  if (existsSync(PLUGIN_DIR)) {
    await mkdir(PLUGIN_FALLBACK_DIR, { recursive: true });
    await writeFile(path.join(PLUGIN_FALLBACK_DIR, "rankings.html"), fragment);
    // Every scoring variant ships, so an origin outage doesn't silently serve
    // the PPR board at a /standard/ URL.
    for (const [slug, html] of fragments) {
      await writeFile(
        path.join(PLUGIN_FALLBACK_DIR, `rankings-${slug}.html`),
        html,
      );
    }
    await writeFile(
      path.join(PLUGIN_FALLBACK_DIR, "tool-meta.json"),
      `${JSON.stringify(toolMeta, null, 2)}\n`,
    );
    if (assets) {
      await writeFile(
        path.join(PLUGIN_FALLBACK_DIR, "assets.json"),
        `${JSON.stringify(assets, null, 2)}\n`,
      );
    }
    log(`copied fallback into ${path.relative(REPO_ROOT, PLUGIN_FALLBACK_DIR)}`);
  }

  const teamCount = Object.keys(teams).length;
  log(
    `rendered ${players.length} players (${teamCount} with a team) into ` +
      `${fragments.size} fragments of ` +
      `${(Buffer.byteLength(fragment) / 1024).toFixed(1)} kB each ` +
      `(${[...fragments.keys()].join(", ")})`,
  );
}

main().catch((err) => {
  console.error(`[prerender] failed: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
