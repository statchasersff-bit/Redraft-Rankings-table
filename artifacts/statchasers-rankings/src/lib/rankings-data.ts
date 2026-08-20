// Pure rankings domain logic, shared by the browser bundle and the Node
// prerender step. Nothing in here may touch `window`/`document`: the build-time
// renderer imports this module to produce the HTML that WordPress serves, and
// the client imports the same module so hydration sees identical output.

export interface Player {
  tier: number;
  rank: number;
  player: string;
  position: string;
  scoring?: string;
}

export interface AllRow {
  rank: number;
  QB: Player | null;
  RB: Player | null;
  WR: Player | null;
  TE: Player | null;
}

/**
 * Everything the UI needs to render without making a network request. This is
 * serialized into the page next to the markup so hydration starts from exactly
 * the state that was rendered, rather than flashing a spinner.
 */
export interface RankingsPayload {
  players: Player[];
  /** normalized player name -> NFL team abbreviation */
  teams: Record<string, string>;
  /** Human-readable "last updated" line shown in the UI. */
  updatedAt: string;
  /** ISO timestamp of when the payload was generated, for `<time datetime>`. */
  generatedAt: string;
}

/**
 * The site the tool is embedded into. Links out of the tool are absolute
 * because the fragment is built on the app origin but served inside
 * statchasers.com — a root-relative href would resolve against the wrong host
 * on the standalone app.
 */
export const SITE_ORIGIN = "https://statchasers.com";

export const POSITIONS = ["All", "QB", "RB", "WR", "TE"] as const;
export type PositionFilter = (typeof POSITIONS)[number];

export const STAT_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type StatPosition = (typeof STAT_POSITIONS)[number];

export const SCORING_FORMATS = ["Standard", "Half PPR", "PPR"] as const;
export const DEFAULT_SCORING = "PPR";
export const DEFAULT_POSITION: PositionFilter = "QB";

/** All view: rows shown before the "Show all" control is used. */
export const ALL_VIEW_COLLAPSED_ROWS = 50;

export const POSITION_NAMES: Record<StatPosition, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
};

export const POSITION_PLURALS: Record<StatPosition, string> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "wide receivers",
  TE: "tight ends",
};

/** Upper rank bound for each tier, in ascending order. */
export const TIER_RULES: Record<string, [number, number][]> = {
  QB: [[6, 1], [16, 2], [24, 3], [33, 4], [40, 5]],
  TE: [[3, 1], [8, 2], [13, 3], [21, 4], [29, 5], [39, 6]],
  WR: [[4, 1], [10, 2], [16, 3], [23, 4], [29, 5], [38, 6], [47, 7], [63, 8]],
  RB: [[4, 1], [11, 2], [15, 3], [23, 4], [28, 5], [36, 6], [50, 7]],
};

export const POSITION_LIMITS: Record<string, number> = {
  QB: 40,
  RB: 50,
  WR: 100,
  TE: 40,
};

/** Subtle per-tier cell backgrounds for the All view (distinct hue per tier). */
export const TIER_COLORS: Record<number, string> = {
  1: "hsl(45, 80%, 95%)",     // gold
  2: "hsl(140, 45%, 95%)",    // green
  3: "hsl(200, 55%, 95.5%)",  // blue
  4: "hsl(265, 42%, 95.5%)",  // purple
  5: "hsl(330, 50%, 95.5%)",  // pink
  6: "hsl(20, 65%, 95.5%)",   // orange
  7: "hsl(180, 35%, 95.5%)",  // teal
  8: "hsl(0, 0%, 95.5%)",     // gray
};

/** Short display names for long names in the compact All view. */
export const MOBILE_SHORT_NAMES: Record<string, string> = {
  "TreVeyon Henderson": "T. Henderson",
  "Rhamondre Stevenson": "R. Stevenson",
  "Jacory Croskey-Merritt": "Jacory C-M.",
  "Fernando Mendoza": "F. Mendoza",
  "Christian McCaffrey": "C. McCaffrey",
  "Omarion Hampton": "O. Hampton",
  "Quinshon Judkins": "Q. Judkins",
  "David Montgomery": "D. Montgomery",
  "Darnell Washington": "D. Washington",
  "Terrance Ferguson": "T. Ferguson",
};

/**
 * Normalize names for matching against the Sleeper team map: strip suffixes
 * (Jr./Sr./II-V) and punctuation so "Michael Pittman Jr." matches
 * "Michael Pittman".
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, "")
    .replace(/[.'’-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function toProfileSlug(name: string): string {
  return name
    .replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function profileUrl(name: string): string {
  return `${SITE_ORIGIN}/nfl/players/${toProfileSlug(name)}/`;
}

export function getTier(position: string, rank: number): number {
  const rules = TIER_RULES[position];
  if (!rules) return 1;
  for (const [maxRank, tier] of rules) {
    if (rank <= maxRank) return tier;
  }
  return rules[rules.length - 1][1];
}

export function tierColor(position: string, rank: number): string | undefined {
  return TIER_COLORS[getTier(position, rank)];
}

/** Ranked, tier-tagged players for a single position. */
export function buildPositionView(
  players: Player[],
  position: string,
  scoring: string,
): Player[] {
  const limit = POSITION_LIMITS[position] ?? Infinity;
  return players
    .filter((p) => (!p.scoring || p.scoring === scoring) && p.position === position)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((p) => ({ ...p, tier: getTier(p.position, p.rank) }));
}

export interface TierGroup {
  tier: number;
  players: Player[];
}

export function groupByTier(players: Player[]): TierGroup[] {
  const groups: Record<number, Player[]> = {};
  players.forEach((player) => {
    (groups[player.tier] ||= []).push(player);
  });
  return Object.keys(groups)
    .map(Number)
    .sort((a, b) => a - b)
    .map((tier) => ({ tier, players: groups[tier] }));
}

/** Rank-aligned rows with one column per position, for the All view. */
export function buildAllView(players: Player[], scoring: string): AllRow[] {
  const byPos: Record<StatPosition, Player[]> = { QB: [], RB: [], WR: [], TE: [] };
  players.forEach((p) => {
    const pos = p.position as StatPosition;
    if (byPos[pos] && (!p.scoring || p.scoring === scoring)) byPos[pos].push(p);
  });

  STAT_POSITIONS.forEach((pos) => {
    byPos[pos] = byPos[pos]
      .sort((a, b) => a.rank - b.rank)
      .slice(0, POSITION_LIMITS[pos] ?? Infinity);
  });

  const maxRows = Math.max(...STAT_POSITIONS.map((pos) => byPos[pos].length));
  return Array.from({ length: maxRows }, (_, i) => ({
    rank: i + 1,
    QB: byPos.QB[i] ?? null,
    RB: byPos.RB[i] ?? null,
    WR: byPos.WR[i] ?? null,
    TE: byPos.TE[i] ?? null,
  }));
}

/**
 * Restrict a full Sleeper name->team map to the players we actually rank, so the
 * payload embedded in the page stays small.
 */
export function pickTeamsForPlayers(
  players: Player[],
  allTeams: Record<string, string>,
): Record<string, string> {
  const picked: Record<string, string> = {};
  players.forEach((p) => {
    const key = normalizeName(p.player);
    const team = allTeams[key];
    if (team) picked[key] = team;
  });
  return picked;
}
