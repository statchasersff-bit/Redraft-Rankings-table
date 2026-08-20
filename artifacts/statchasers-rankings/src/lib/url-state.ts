// Deep-linking for the position and scoring filters, as real paths.
//
//   /redraft-rankings/ppr/te/
//   /redraft-rankings/standard/rb/
//   /redraft-rankings/half-ppr/wr/
//
// Scoring first, then position, both always present.
//
// Unlike a fragment, these are addresses the server has to answer for: the
// WordPress plugin registers rewrite rules for exactly these slug pairs, and
// canonicalises them onto the page's clean permalink so the filter combinations
// don't compete with it in search. That is what makes writing them safe.
//
// The consequence is that this module must never invent a path the server
// hasn't agreed to serve. Two rules follow from that, and both matter:
//
//   1. Nothing is written unless a base path was handed to us by the plugin.
//      On the standalone app there are no rewrite rules, so a written path
//      would 404 on reload. It stays on whatever URL it already has.
//   2. Only slugs from POSITIONS and SCORING_FORMATS are ever produced or
//      accepted, because those are the slugs the rewrite rules were built from.
//
// This module is the only place allowed to touch `location` or `history`, and
// scripts/check-seo-contract.mjs enforces that against every other module.

import {
  POSITIONS,
  SCORING_FORMATS,
  type PositionFilter,
} from "./rankings-data";

export interface RouteState {
  position?: PositionFilter;
  scoring?: string;
}

const slugify = (value: string) => value.toLowerCase().replace(/\s+/g, "-");

// Derived from the canonical lists rather than written out, so adding a scoring
// format or position can't leave a slug table quietly out of date. The plugin
// builds its rewrite rules from the same lists, via tool-meta.json.
const POSITION_BY_SLUG = new Map<string, PositionFilter>(
  POSITIONS.map((pos) => [slugify(pos), pos]),
);
const SCORING_BY_SLUG = new Map<string, string>(
  SCORING_FORMATS.map((fmt) => [slugify(fmt), fmt]),
);

/** Slug lists, for the build to hand to the plugin. */
export const POSITION_SLUGS = POSITIONS.map(slugify);
export const SCORING_SLUGS = SCORING_FORMATS.map(slugify);

const withTrailingSlash = (value: string) =>
  value.endsWith("/") ? value : `${value}/`;

/**
 * Filter state named by `pathname`, relative to the page's own path.
 *
 * Returns an empty object for anything that isn't a complete, recognised
 * scoring/position pair. Half a match is not a match: `/ppr/` alone, or a
 * trailing segment we don't know, means the URL is not describing tool state
 * and we should leave the tool at whatever the server rendered.
 */
export function parseRoute(basePath: string, pathname: string): RouteState {
  if (basePath === "") return {};

  const base = withTrailingSlash(basePath);
  const path = withTrailingSlash(pathname);
  if (!path.startsWith(base)) return {};

  const rest = path.slice(base.length).replace(/\/$/, "");
  if (rest === "") return {};

  const parts = rest.split("/");
  if (parts.length !== 2) return {};

  const scoring = SCORING_BY_SLUG.get(parts[0].toLowerCase());
  const position = POSITION_BY_SLUG.get(parts[1].toLowerCase());
  if (!scoring || !position) return {};

  return { position, scoring };
}

/** The path representing this state. */
export function formatRoute(
  basePath: string,
  position: PositionFilter,
  scoring: string,
): string {
  return `${withTrailingSlash(basePath)}${slugify(scoring)}/${slugify(position)}/`;
}

/**
 * Filter state named by the current URL.
 *
 * Falls back to reading a fragment in the older `#ppr-te` form, so links shared
 * while the tool used fragments still land on the right board. Nothing writes
 * that form any more.
 */
export function readRouteState(basePath: string): RouteState {
  if (typeof window === "undefined") return {};

  const fromPath = parseRoute(basePath, window.location.pathname);
  if (fromPath.position || fromPath.scoring) return fromPath;

  return parseLegacyHash(window.location.hash);
}

/** The retired `#ppr-te` / `#te` fragment format, read-only. */
function parseLegacyHash(raw: string): RouteState {
  const value = raw.replace(/^#/, "").trim().toLowerCase();
  if (value === "") return {};

  const parts = value.split("-");
  const position = POSITION_BY_SLUG.get(parts[parts.length - 1]);
  const scoringSlug = (position ? parts.slice(0, -1) : parts).join("-");

  if (scoringSlug === "") return position ? { position } : {};

  const scoring = SCORING_BY_SLUG.get(scoringSlug);
  if (!scoring) return {};

  return position ? { position, scoring } : { scoring };
}

/**
 * Point the URL at this state.
 *
 * `replaceState` rather than `pushState`, so six taps through the position tabs
 * don't become six presses of Back to leave the page. A no-op without a base
 * path (see rule 1 at the top) and a no-op when the URL already says this, so
 * it never fires a redundant `popstate`.
 *
 * Any fragment is dropped: it addressed tool state in the retired format, and
 * keeping it would leave two contradictory descriptions in one URL.
 */
export function writeRouteState(
  basePath: string,
  position: PositionFilter,
  scoring: string,
): void {
  if (typeof window === "undefined" || basePath === "") return;

  const next = formatRoute(basePath, position, scoring);
  if (next === window.location.pathname) return;

  window.history.replaceState(
    window.history.state,
    "",
    next + window.location.search,
  );
}

/**
 * Call `onChange` when the URL changes under us — Back, Forward, or another
 * script calling into the history API. Returns an unsubscribe function.
 */
export function subscribeToRoute(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}
