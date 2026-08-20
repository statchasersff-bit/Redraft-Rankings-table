// Build-time renderer. `scripts/prerender.mjs` imports the compiled version of
// this module to turn the rankings CSV into the HTML that WordPress serves, so
// the initial response already contains player names, teams, ranks, tiers and
// table headings for every position.

import { renderToString } from "react-dom/server";
import Rankings from "./pages/Rankings";
import type { RankingsPayload } from "./lib/rankings-data";

export { parseRankingsCsv } from "./lib/rankings-csv";
export { normalizeName, pickTeamsForPlayers } from "./lib/rankings-data";
export type { Player, RankingsPayload } from "./lib/rankings-data";

/** Class/attribute contract shared by the renderer, the client and the plugin. */
export const CONTAINER_CLASS = "statchasers-tool";
export const TOOL_ATTR = "data-statchasers-tool";
export const TOOL_NAME = "rankings";
export const ROOT_ATTR = "data-statchasers-root";
export const PAYLOAD_ATTR = "data-statchasers-payload";

/** The React subtree only — this is what the client hydrates against. */
export function renderRankings(payload: RankingsPayload): string {
  return renderToString(<Rankings payload={payload} />);
}

/**
 * Escape a JSON string for safe inclusion in a `<script>` element. `<` is the
 * only character that can terminate the block early (`</script>`) or open an
 * HTML comment (`<!--`), so encoding it is sufficient and keeps the JSON valid.
 */
function escapeJsonForScript(json: string): string {
  return json.replace(/</g, "\\u003c");
}

/**
 * The complete embeddable fragment: hydration payload, the prerendered markup,
 * and a no-JS fallback that reveals every position panel (without scripting the
 * tabs can't be operated, so all four tables are shown instead of just one).
 *
 * The payload `<script>` sits outside the hydration root on purpose — React
 * would flag it as unexpected markup if it were inside.
 */
export function renderRankingsFragment(payload: RankingsPayload): string {
  const json = escapeJsonForScript(JSON.stringify(payload));
  return [
    `<div class="${CONTAINER_CLASS} ${CONTAINER_CLASS}--${TOOL_NAME}" ${TOOL_ATTR}="${TOOL_NAME}">`,
    `<script type="application/json" ${PAYLOAD_ATTR}>${json}</script>`,
    `<noscript><style>.${CONTAINER_CLASS} [role="tabpanel"][hidden]{display:block !important}</style></noscript>`,
    `<div ${ROOT_ATTR} data-prerendered="1">${renderRankings(payload)}</div>`,
    `</div>`,
  ].join("");
}
