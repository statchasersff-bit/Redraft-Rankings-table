// CSV parsing, kept in its own module so it can be code-split away.
//
// This is only reached on the degraded path: the standalone app URL, or a
// WordPress mount whose prerendered payload failed to parse. The normal
// WordPress case hydrates from a payload that is already in the page, so
// bundling a CSV parser into the entry chunk would ship ~40 kB of JavaScript to
// every visitor that the overwhelming majority of them never execute.
//
// Rankings.tsx imports this with a dynamic `import()`, which is what puts it in
// a separate chunk. The Node prerender imports it statically — there is no
// bundle-size concern there.

import Papa from "papaparse";
import type { Player } from "./rankings-data";

/**
 * Parse the rankings CSV. Used by the prerender step (on the file contents) and
 * by the client's fallback fetch, so both agree on shape and coercion.
 */
export function parseRankingsCsv(csv: string): Player[] {
  const results = Papa.parse(csv, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  return (results.data as any[])
    .filter((row) => row && (row.Player || row.player))
    .map((row) => ({
      tier: Number(row.tier ?? row.Tier) || 1,
      rank:
        Number(
          row["Final Rank"] ?? row["final rank"] ?? row.rank ?? row.Rank,
        ) || 0,
      player: String(row.Player ?? row.player ?? "").trim(),
      position: String(row.Position ?? row.position ?? "").trim(),
      scoring: row.scoring ?? row.Scoring ?? undefined,
    }));
}
