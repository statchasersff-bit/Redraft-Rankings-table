// Build-time renderer. `scripts/prerender.mjs` imports the compiled version of
// this module to turn the rankings CSV into the HTML that WordPress serves, so
// the initial response already contains player names, teams, ranks, tiers and
// table headings for every position.

import { renderToString } from "react-dom/server";
import Rankings from "./pages/Rankings";
import {
  DEFAULT_POSITION,
  DEFAULT_SCORING,
  type PositionFilter,
  type RankingsPayload,
} from "./lib/rankings-data";

export { parseRankingsCsv } from "./lib/rankings-csv";
export {
  normalizeName,
  pickTeamsForPlayers,
  POSITIONS,
  SCORING_FORMATS,
} from "./lib/rankings-data";
export { POSITION_SLUGS, SCORING_SLUGS } from "./lib/url-state";
export type { Player, RankingsPayload } from "./lib/rankings-data";

/** Class/attribute contract shared by the renderer, the client and the plugin. */
export const CONTAINER_CLASS = "statchasers-tool";
export const TOOL_ATTR = "data-statchasers-tool";
export const TOOL_NAME = "rankings";
export const ROOT_ATTR = "data-statchasers-root";
export const PAYLOAD_ATTR = "data-statchasers-payload";

/**
 * Which filters this markup was rendered at.
 *
 * The client seeds its initial state from these rather than from the URL, so
 * its first render is identical to the markup it hydrates. Reconciling against
 * the address bar happens after, in a layout effect — see src/lib/url-state.ts.
 * The plugin adds a third attribute, the page's base path, at request time.
 */
export const SCORING_ATTR = "data-statchasers-scoring";
export const POSITION_ATTR = "data-statchasers-position";

const slugify = (value: string) => value.toLowerCase().replace(/\s+/g, "-");

export interface RenderOptions {
  position?: PositionFilter;
  scoring?: string;
}

/** The React subtree only — this is what the client hydrates against. */
export function renderRankings(
  payload: RankingsPayload,
  { position = DEFAULT_POSITION, scoring = DEFAULT_SCORING }: RenderOptions = {},
): string {
  return renderToString(
    <Rankings
      payload={payload}
      initialPosition={position}
      initialScoring={scoring}
    />,
  );
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
export function renderRankingsFragment(
  payload: RankingsPayload,
  options: RenderOptions = {},
): string {
  const position = options.position ?? DEFAULT_POSITION;
  const scoring = options.scoring ?? DEFAULT_SCORING;
  const json = escapeJsonForScript(JSON.stringify(payload));
  return [
    `<div class="${CONTAINER_CLASS} ${CONTAINER_CLASS}--${TOOL_NAME}" ${TOOL_ATTR}="${TOOL_NAME}"` +
      ` ${SCORING_ATTR}="${slugify(scoring)}" ${POSITION_ATTR}="${slugify(position)}">`,
    `<script type="application/json" ${PAYLOAD_ATTR}>${json}</script>`,
    `<noscript><style>.${CONTAINER_CLASS} [role="tabpanel"][hidden]{display:block !important}</style></noscript>`,
    `<div ${ROOT_ATTR} data-prerendered="1">${renderRankings(payload, { position, scoring })}</div>`,
    `</div>`,
  ].join("");
}
