// Deep-linking for the position and scoring filters, via the fragment only.
//
// The SEO contract (scripts/check-seo-contract.mjs) forbids filter state in the
// URL, because 5 positions x 3 scoring formats of the same 252 players is a
// duplicate URL space Google will crawl and then need canonicalizing away. A
// fragment is exempt from that reasoning in a way a query string is not: the
// URL `…/redraft-rankings/#te` *is* `…/redraft-rankings/` as far as crawling,
// indexing and canonicalisation are concerned. Nothing new becomes crawlable,
// so nothing new needs suppressing — but a reader can still send someone the
// tight end board.
//
// This module is the only place allowed to touch `location` or `history`, and
// the contract check enforces that: every other source file is still held to
// "no URL state at all". Keeping it in one small file is what makes the rule
// checkable, so please don't inline a `location.hash =` somewhere else.
//
// Format, shortest form that round-trips:
//
//   (no hash)      default position and scoring  (QB, PPR)
//   #te            TE at the default scoring
//   #standard      the default position at Standard scoring
//   #standard-rb   RB at Standard scoring
//   #half-ppr-wr   WR at Half PPR scoring
//
// Anything unrecognised is ignored and left alone, which matters because the
// tool lives on a WordPress page whose theme, plugins and comment threads all
// use fragments of their own. `#comments` must not be read as tool state, and
// must not be overwritten just because the tool mounted.

import {
  DEFAULT_POSITION,
  DEFAULT_SCORING,
  POSITIONS,
  SCORING_FORMATS,
  type PositionFilter,
} from "./rankings-data";

export interface HashState {
  position?: PositionFilter;
  scoring?: string;
}

const slugify = (value: string) => value.toLowerCase().replace(/\s+/g, "-");

// Derived from the canonical lists rather than written out, so adding a scoring
// format or position can't leave a slug table quietly out of date.
const POSITION_BY_SLUG = new Map<string, PositionFilter>(
  POSITIONS.map((pos) => [slugify(pos), pos]),
);
const SCORING_BY_SLUG = new Map<string, string>(
  SCORING_FORMATS.map((fmt) => [slugify(fmt), fmt]),
);

/**
 * Parse a fragment into filter state.
 *
 * Returns an empty object for anything that isn't ours. A partial match is not
 * good enough: `#standard-quarterbacks` names a real scoring format and then
 * something we don't recognise, and guessing at half of it would silently
 * ignore what the link actually asked for.
 */
export function parseHash(raw: string): HashState {
  const value = raw.replace(/^#/, "").trim().toLowerCase();
  if (value === "") return {};

  const parts = value.split("-");

  // The position is the last segment, if it is one — scoring slugs can contain
  // a dash ("half-ppr"), positions never do, so reading from the right is
  // unambiguous.
  const position = POSITION_BY_SLUG.get(parts[parts.length - 1]);
  const scoringSlug = (position ? parts.slice(0, -1) : parts).join("-");

  if (scoringSlug === "") {
    return position ? { position } : {};
  }

  const scoring = SCORING_BY_SLUG.get(scoringSlug);
  if (!scoring) return {}; // not ours, or malformed — leave it entirely alone

  return position ? { position, scoring } : { scoring };
}

/**
 * The fragment representing this state, or `""` when it is the default.
 *
 * Defaults are omitted so the common case stays on the clean URL and a shared
 * link is as short as it can be.
 */
export function formatHash(position: PositionFilter, scoring: string): string {
  const parts: string[] = [];
  if (scoring !== DEFAULT_SCORING) parts.push(slugify(scoring));
  if (position !== DEFAULT_POSITION) parts.push(slugify(position));

  return parts.length === 0 ? "" : `#${parts.join("-")}`;
}

/** Filter state named by the current URL's fragment. */
export function readHashState(): HashState {
  if (typeof window === "undefined") return {};

  return parseHash(window.location.hash);
}

/**
 * Point the fragment at this state.
 *
 * `replaceState` rather than assigning to `location.hash`, which would push a
 * history entry per click — six taps through the position tabs should not mean
 * six presses of Back to leave the page. Deliberately a no-op when the URL
 * already says this, so it never adds a redundant entry or fires `hashchange`.
 */
export function writeHashState(position: PositionFilter, scoring: string): void {
  if (typeof window === "undefined") return;

  const next = formatHash(position, scoring);
  if (next === window.location.hash) return;
  if (next === "" && window.location.hash === "") return;

  // A relative URL would resolve against the current one and keep the query
  // string, but clearing the fragment needs the path spelled out — otherwise
  // the URL keeps a bare trailing "#".
  const url =
    next === ""
      ? window.location.pathname + window.location.search
      : window.location.pathname + window.location.search + next;

  window.history.replaceState(window.history.state, "", url);
}

/**
 * Call `onChange` when the fragment changes under us — Back, Forward, or
 * someone editing the address bar. Returns an unsubscribe function.
 */
export function subscribeToHash(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
