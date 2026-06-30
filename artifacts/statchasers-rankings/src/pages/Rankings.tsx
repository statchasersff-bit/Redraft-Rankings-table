import { useState, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import Papa from "papaparse";
import { Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const SHEET_URL = "/rankings.csv";

interface Player {
  tier: number;
  rank: number;
  player: string;
  position: string;
  scoring?: string;
}

interface AllRow {
  rank: number;
  QB: Player | null;
  RB: Player | null;
  WR: Player | null;
  TE: Player | null;
}

export default function Rankings() {
  const [data, setData] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamMap, setTeamMap] = useState<Record<string, string>>({});

  const [filterPosition, setFilterPosition] = useState<string>("QB");
  const [filterScoring, setFilterScoring] = useState<string>("PPR");
  const [showAllRows, setShowAllRows] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Papa.parse(SHEET_URL, {
      download: true,
      header: true,
      dynamicTyping: true,
      complete: (results) => {
        const rows = (results.data as any[])
          .filter((row) => row.Player || row.player)
          .map((row) => ({
            tier: Number(row.tier ?? row.Tier) || 1,
            rank: Number(row["Final Rank"] ?? row["final rank"] ?? row.rank ?? row.Rank) || 0,
            player: String(row.Player ?? row.player ?? "").trim(),
            position: String(row.Position ?? row.position ?? "").trim(),
            scoring: row.scoring ?? row.Scoring ?? undefined,
          }));
        setData(rows as Player[]);
        setLoading(false);
      },
      error: (err) => {
        setError(`Failed to load rankings: ${err.message}`);
        setLoading(false);
      },
    });
  }, []);

  useEffect(() => {
    fetch("https://api.sleeper.app/v1/players/nfl")
      .then((r) => r.json())
      .then((players: Record<string, { full_name?: string; team?: string | null }>) => {
        const map: Record<string, string> = {};
        Object.values(players).forEach((p) => {
          if (p.full_name && p.team) map[normalizeName(p.full_name)] = p.team;
        });
        setTeamMap(map);
      })
      .catch(() => {});
  }, []);

  const TIER_RULES: Record<string, [number, number][]> = {
    QB: [
      [6,  1], [16, 2], [24, 3], [33, 4], [40, 5],
    ],
    TE: [
      [3,  1], [8,  2], [13, 3], [21, 4], [29, 5], [39, 6],
    ],
    WR: [
      [4,  1], [13, 2], [19, 3], [27, 4], [35, 5], [48, 6], [64, 7], [100, 8],
    ],
    RB: [
      [4,  1], [10, 2], [16, 3], [22, 4], [28, 5], [36, 6], [50, 7],
    ],
  };

  const POSITION_LIMITS: Record<string, number> = {
    QB: 40,
    RB: 50,
    WR: 100,
    TE: 40,
  };

  // Subtle per-tier cell backgrounds for the All view (distinct hue per tier)
  const TIER_COLORS: Record<number, string> = {
    1: "hsl(45, 80%, 95%)",     // gold
    2: "hsl(140, 45%, 95%)",    // green
    3: "hsl(200, 55%, 95.5%)",  // blue
    4: "hsl(265, 42%, 95.5%)",  // purple
    5: "hsl(330, 50%, 95.5%)",  // pink
    6: "hsl(20, 65%, 95.5%)",   // orange
    7: "hsl(180, 35%, 95.5%)",  // teal
    8: "hsl(0, 0%, 95.5%)",     // gray
  };

  function tierColor(position: string, rank: number): string | undefined {
    return TIER_COLORS[getTier(position, rank)];
  }

  // Short display names for long names in the compact All view
  const MOBILE_SHORT_NAMES: Record<string, string> = {
    "TreVeyon Henderson":    "T. Henderson",
    "Rhamondre Stevenson":   "R. Stevenson",
    "Jacory Croskey-Merritt":"Jacory C-M.",
    "Fernando Mendoza":      "F. Mendoza",
    "Christian McCaffrey":   "C. McCaffrey",
    "Omarion Hampton":       "O. Hampton",
    "Quinshon Judkins":      "Q. Judkins",
    "David Montgomery":      "D. Montgomery",
    "Darnell Washington":    "D. Washington",
    "Terrance Ferguson":     "T. Ferguson",
  };

  // Normalize names for matching against the Sleeper team map: strip suffixes
  // (Jr./Sr./II–V) and punctuation so "Michael Pittman Jr." matches "Michael Pittman".
  function normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, "")
      .replace(/[.'’-]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toProfileSlug(name: string): string {
    return name
      .replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
  }

  function getTier(position: string, rank: number): number {
    const rules = TIER_RULES[position];
    if (!rules) return 1;
    for (const [maxRank, tier] of rules) {
      if (rank <= maxRank) return tier;
    }
    return rules[rules.length - 1][1];
  }

  // Single-position filtered + tiered data
  const filteredData = useMemo(() => {
    if (filterPosition === "All") return [];
    const limit = POSITION_LIMITS[filterPosition] ?? Infinity;
    return data
      .filter(
        (p) =>
          (!p.scoring || p.scoring === filterScoring) &&
          p.position === filterPosition
      )
      .sort((a, b) => a.rank - b.rank)
      .slice(0, limit)
      .map((p) => ({ ...p, tier: getTier(p.position, p.rank) }));
  }, [data, filterPosition, filterScoring]);

  const groupedByTier = useMemo(() => {
    const groups: Record<number, Player[]> = {};
    filteredData.forEach((player) => {
      if (!groups[player.tier]) groups[player.tier] = [];
      groups[player.tier].push(player);
    });
    return Object.keys(groups)
      .map(Number)
      .sort((a, b) => a - b)
      .map((tier) => ({ tier, players: groups[tier] }));
  }, [filteredData]);

  // All-positions side-by-side data
  const allViewData = useMemo<AllRow[]>(() => {
    if (filterPosition !== "All") return [];
    const byPos: Record<string, Player[]> = { QB: [], RB: [], WR: [], TE: [] };
    data.forEach((p) => {
      if (byPos[p.position] && (!p.scoring || p.scoring === filterScoring)) {
        byPos[p.position].push(p);
      }
    });
    (["QB", "RB", "WR", "TE"] as const).forEach((pos) => {
      byPos[pos] = byPos[pos]
        .sort((a, b) => a.rank - b.rank)
        .slice(0, POSITION_LIMITS[pos] ?? Infinity);
    });
    const maxRows = Math.max(...Object.values(byPos).map((arr) => arr.length));
    return Array.from({ length: maxRows }, (_, i) => ({
      rank: i + 1,
      QB: byPos.QB[i] ?? null,
      RB: byPos.RB[i] ?? null,
      WR: byPos.WR[i] ?? null,
      TE: byPos.TE[i] ?? null,
    }));
  }, [data, filterPosition, filterScoring]);

  // Report height to parent iframe on content change
  useEffect(() => {
    if (window.self === window.top) return;
    const timer = setTimeout(() => {
      window.parent.postMessage(
        { type: "iframe-resize", height: document.body.scrollHeight },
        "*"
      );
    }, 50);
    return () => clearTimeout(timer);
  }, [filteredData, allViewData, showAllRows]);

  const positions = ["All", "QB", "RB", "WR", "TE"];
  const scoringFormats = ["Standard", "Half PPR", "PPR"];

  const isAll = filterPosition === "All";
  const isEmpty = isAll ? allViewData.length === 0 : filteredData.length === 0;

  // All view: show the first 50 rows with an option to expand to the rest.
  const ALL_VIEW_COLLAPSED_ROWS = 50;
  const visibleAllRows = showAllRows
    ? allViewData
    : allViewData.slice(0, ALL_VIEW_COLLAPSED_ROWS);

  // Collapse again whenever the filter changes.
  useEffect(() => {
    setShowAllRows(false);
  }, [filterPosition, filterScoring]);

  // Density-based fitting for the All view. We pick the least-compact rendering
  // that fits the available width: 0 = name + team, 1 = name only, 2 = short
  // name only. A ResizeObserver watches a stable full-width wrapper (its box
  // doesn't change when the inner density does, so there's no feedback loop),
  // and a measure→step-down loop compares the table's width against it.
  const measureRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [density, setDensity] = useState(0);
  const [measuring, setMeasuring] = useState(false);

  useEffect(() => {
    if (!isAll) return;
    const el = measureRef.current;
    if (!el) return;
    const start = () => { setDensity(0); setMeasuring(true); };
    const ro = new ResizeObserver(start);
    ro.observe(el);
    start(); // initial pass
    return () => ro.disconnect();
  }, [isAll, allViewData, showAllRows]);

  useLayoutEffect(() => {
    if (!measuring) return;
    const wrap = measureRef.current;
    const table = tableRef.current;
    if (!wrap || !table) { setMeasuring(false); return; }
    const overflowing = table.offsetWidth > wrap.clientWidth + 1;
    if (overflowing && density < 2) {
      setDensity((d) => d + 1); // try a more compact rendering, then re-measure
    } else {
      setMeasuring(false); // fits, or already at the most compact level
    }
  }, [measuring, density]);

  function PlayerCell({ player }: { player: Player | null }) {
    if (!player) return <div className="px-0.5 py-1" />;
    const team = teamMap[normalizeName(player.player)];
    // density 2 → short name (if available); team only shown at density 0
    const name = density >= 2 && MOBILE_SHORT_NAMES[player.player]
      ? MOBILE_SHORT_NAMES[player.player]
      : player.player;
    return (
      <div className="px-0.5 py-0.5 min-w-0">
        <a
          href={`https://statchasers.com/nfl/players/${toProfileSlug(player.player)}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full cursor-pointer items-baseline gap-1.5 font-semibold text-[#0B1F3A] hover:text-[#F4C430] hover:underline transition-colors duration-150 text-[8px] md:text-sm leading-tight whitespace-nowrap"
        >
          <span>{name}</span>
          {density === 0 && team && (
            <span className="text-[8px] md:text-xs font-medium text-muted-foreground">{team}</span>
          )}
        </a>
      </div>
    );
  }

  return (
    <div className="bg-white font-sans">

      {/* Last Updated */}
      <div className="w-full px-px pt-3 text-xs text-muted-foreground">
        Last updated: June 15, 2026 4:52pm ET
      </div>

      {/* Sticky Filter Bar */}
      <div className="bg-white border-b border-border shadow-sm">
        <div className="w-full px-px py-3 flex flex-col min-[560px]:flex-row gap-3 items-center justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-foreground uppercase tracking-wider hidden min-[560px]:inline-block">
              POS
            </span>
            <div className="flex gap-1.5">
              {positions.map((pos) => (
                <button
                  key={pos}
                  data-testid={`filter-position-${pos}`}
                  onClick={() => setFilterPosition(pos)}
                  className={cn(
                    "px-3 md:px-4 py-1.5 text-sm font-semibold rounded-lg border transition-all duration-150",
                    filterPosition === pos
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-secondary text-secondary-foreground border-transparent hover:border-border"
                  )}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-foreground uppercase tracking-wider hidden min-[560px]:inline-block">
              FORMAT
            </span>
            <div className="flex gap-1.5">
              {scoringFormats.map((fmt) => {
                const isDisabled = fmt !== "PPR";
                return (
                  <button
                    key={fmt}
                    data-testid={`filter-scoring-${fmt.replace(" ", "-")}`}
                    onClick={() => !isDisabled && setFilterScoring(fmt)}
                    disabled={isDisabled}
                    className={cn(
                      "px-3 md:px-4 py-1.5 text-sm font-semibold rounded-lg border transition-all duration-150 whitespace-nowrap",
                      isDisabled
                        ? "bg-secondary text-secondary-foreground/30 border-transparent opacity-40 cursor-not-allowed"
                        : filterScoring === fmt
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-secondary text-secondary-foreground border-transparent hover:border-border"
                    )}
                  >
                    {fmt}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="w-full px-px py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
            <p className="text-primary font-semibold tracking-wide">Loading rankings...</p>
          </div>
        ) : error ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-2xl p-8 flex flex-col items-center text-center max-w-lg mx-auto">
            <AlertCircle className="h-10 w-10 text-destructive mb-3" />
            <h3 className="text-foreground font-semibold mb-2">Failed to load data</h3>
            <p className="text-sm text-muted-foreground break-all">{error}</p>
          </div>
        ) : isEmpty ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-border shadow-sm">
            <p className="text-foreground font-semibold text-lg">No players match these filters.</p>
          </div>

        ) : isAll ? (
          /* ── All-positions side-by-side view ── */
          <>
          <div ref={measureRef} className="w-full">
          <div className="rounded-[15px] border border-border bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto w-full">
            <table
              ref={tableRef}
              className="border-collapse w-full"
              style={density > 0 ? { minWidth: "360px" } : undefined}
            >
              {/* Rank column sizes to content; the 4 position columns share the
                  rest equally so the table fills the width evenly. */}
              <colgroup>
                <col />
                <col style={{ width: "25%" }} />
                <col style={{ width: "25%" }} />
                <col style={{ width: "25%" }} />
                <col style={{ width: "25%" }} />
              </colgroup>
              <thead>
                <tr style={{ background: "#0B1F3A" }}>
                  {["#", "QB", "RB", "WR", "TE"].map((col) => (
                    <th
                      key={col}
                      className="text-white text-[10px] md:text-xs font-bold uppercase tracking-wider px-0.5 md:px-2 py-2 text-center"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleAllRows.map((row) => (
                  <tr
                    key={row.rank}
                    className="group border-t border-border/60 first:border-t-0"
                  >
                    <td className="text-center font-black text-[6px] md:text-xs px-0.5 py-1 transition-shadow duration-100 group-hover:shadow-[inset_0_0_0_9999px_rgba(11,31,58,0.045)]" style={{ color: "#0B1F3A" }}>
                      {row.rank}
                    </td>
                    {(["QB", "RB", "WR", "TE"] as const).map((pos) => {
                      const cellPlayer = row[pos];
                      return (
                        <td
                          key={pos}
                          className="py-0.5 overflow-hidden transition-shadow duration-100 group-hover:shadow-[inset_0_0_0_9999px_rgba(11,31,58,0.045)]"
                          style={
                            cellPlayer
                              ? { backgroundColor: tierColor(cellPlayer.position, cellPlayer.rank) }
                              : undefined
                          }
                        >
                          <PlayerCell player={cellPlayer} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {allViewData.length > ALL_VIEW_COLLAPSED_ROWS && (
            <div className="flex items-center justify-between gap-3 border-t border-border bg-white px-4 py-2.5">
              <span className="text-xs text-muted-foreground">
                {showAllRows
                  ? `Showing all ${allViewData.length} players`
                  : `Showing top ${visibleAllRows.length} of ${allViewData.length} players`}
              </span>
              <button
                onClick={() => setShowAllRows((v) => !v)}
                className="text-xs font-semibold text-[#0B1F3A] hover:text-[#F4C430] transition-colors duration-150 whitespace-nowrap"
              >
                {showAllRows ? "Show less" : `Show all ${allViewData.length}`}
              </button>
            </div>
          )}
          </div>
          </div>
          </>

        ) : (
          /* ── Single-position tiered view ── */
          <div
            className="bg-white rounded-2xl border border-border overflow-hidden"
            style={{ boxShadow: "0 4px 16px rgba(15, 23, 42, 0.12)" }}
          >
            <div
              className="grid grid-cols-[3rem_3rem_1fr_auto] md:grid-cols-[4.5rem_4.5rem_1fr_auto] text-white text-xs font-bold uppercase tracking-wider px-4 py-2"
              style={{ background: "#0B1F3A" }}
            >
              <div className="text-center">Tier</div>
              <div className="text-center">Rank</div>
              <div className="px-2">Player</div>
              <div className="pr-1" />
            </div>

            {groupedByTier.map((group) => (
              <div key={`tier-${group.tier}`}>
                <div
                  className="text-white font-black text-xs tracking-widest uppercase px-4 py-1"
                  style={{ background: "linear-gradient(90deg, #0B1F3A 0%, #132A4A 100%)" }}
                >
                  Tier {group.tier}
                </div>

                {group.players.map((player, idx) => (
                  <div
                    key={`${player.player}-${player.rank}`}
                    data-testid={`row-player-${player.rank}`}
                    className={cn(
                      "grid grid-cols-[3rem_3rem_1fr_auto] md:grid-cols-[4.5rem_4.5rem_1fr_auto] items-center px-4 py-1.5 border-t border-border transition-colors duration-100 hover:bg-[#f8fafc]",
                      idx % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"
                    )}
                  >
                    <div className="text-center text-muted-foreground font-medium text-xs md:text-sm">
                      {player.tier}
                    </div>
                    <div className="text-center font-black text-sm md:text-base" style={{ color: "#0B1F3A" }}>
                      {player.rank}
                    </div>
                    <div className="px-2 flex items-baseline gap-2">
                      <span className="font-bold text-foreground text-xs md:text-sm">
                        {player.player}
                      </span>
                      {teamMap[normalizeName(player.player)] && (
                        <span className="text-[10px] md:text-xs font-medium text-muted-foreground shrink-0">
                          {teamMap[normalizeName(player.player)]}
                        </span>
                      )}
                    </div>
                    <div className="pl-2 flex items-center">
                      <a
                        href={`https://statchasers.com/nfl/players/${toProfileSlug(player.player)}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md border border-[#0B1F3A] text-[#0B1F3A] hover:bg-[#0B1F3A] hover:text-white transition-colors duration-150 whitespace-nowrap"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="hidden md:inline">View Profile</span>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
