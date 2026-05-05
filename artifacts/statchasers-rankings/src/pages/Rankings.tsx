import { useState, useEffect, useMemo } from "react";
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
          if (p.full_name && p.team) map[p.full_name.toLowerCase().trim()] = p.team;
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
      [2,  1], [8,  2], [13, 3], [21, 4], [29, 5], [40, 6],
    ],
    WR: [
      [4,  1], [12, 2], [19, 3], [26, 4], [36, 5], [48, 6], [70, 7],
    ],
    RB: [
      [4,  1], [10, 2], [17, 3], [22, 4], [28, 5], [34, 6], [40, 7],
    ],
  };

  const POSITION_LIMITS: Record<string, number> = {
    QB: 35,
    RB: 40,
    WR: 70,
    TE: 40,
  };

  // Short display names for long names in the compact All view
  const MOBILE_SHORT_NAMES: Record<string, string> = {
    "TreVeyon Henderson":    "TreVeyon H.",
    "Rhamondre Stevenson":   "Rhamondre S.",
    "Jacory Croskey-Merritt":"Jacory C-M.",
  };

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
  }, [filteredData, allViewData]);

  const positions = ["All", "QB", "RB", "WR", "TE"];
  const scoringFormats = ["Standard", "Half PPR", "PPR"];

  const isAll = filterPosition === "All";
  const isEmpty = isAll ? allViewData.length === 0 : filteredData.length === 0;

  function PlayerCell({ player, compact }: { player: Player | null; compact?: boolean }) {
    if (!player) return <div className="px-1 py-1" />;
    const team = teamMap[player.player.toLowerCase().trim()];
    const displayName = compact && MOBILE_SHORT_NAMES[player.player]
      ? MOBILE_SHORT_NAMES[player.player]
      : player.player;
    return (
      <div className="px-1 py-0.5 min-w-0">
        {/* Mobile: name only, short if available */}
        <a
          href={`https://statchasers.com/nfl/players/${toProfileSlug(player.player)}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="md:hidden font-semibold text-[#0B1F3A] hover:text-[#F4C430] transition-colors duration-150 text-[10px] leading-tight block whitespace-nowrap"
        >
          {displayName}
        </a>
        {/* Desktop: name + team on same row */}
        <a
          href={`https://statchasers.com/nfl/players/${toProfileSlug(player.player)}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden md:flex items-baseline gap-1.5 font-semibold text-[#0B1F3A] hover:text-[#F4C430] transition-colors duration-150 text-sm leading-tight whitespace-nowrap"
        >
          <span>{player.player}</span>
          {team && (
            <span className="text-xs font-medium text-muted-foreground">{team}</span>
          )}
        </a>
      </div>
    );
  }

  return (
    <div className="bg-white font-sans">

      {/* Sticky Filter Bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-border shadow-sm">
        <div className="w-full px-4 md:px-6 py-3 flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-foreground uppercase tracking-wider hidden md:inline-block">
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
            <span className="text-xs font-bold text-foreground uppercase tracking-wider hidden md:inline-block">
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
      <main className="w-full px-4 md:px-6 py-6">
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
          <div
            className="bg-white rounded-2xl border border-[#b0b8c8] overflow-x-auto"
            style={{ boxShadow: "0 4px 16px rgba(15, 23, 42, 0.12)" }}
          >
            <table className="border-collapse" style={{ minWidth: "480px", width: "100%" }}>
              <thead>
                <tr style={{ background: "#0B1F3A" }}>
                  {["#", "QB", "RB", "WR", "TE"].map((col) => (
                    <th
                      key={col}
                      className="text-white text-[10px] md:text-xs font-bold uppercase tracking-wider px-1 md:px-3 py-2 text-center"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allViewData.map((row, idx) => (
                  <tr
                    key={row.rank}
                    className={cn(
                      "border-t border-border transition-colors duration-100 hover:bg-[#f8fafc]",
                      idx % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"
                    )}
                  >
                    <td className="text-center font-black text-xs md:text-sm px-1 py-1" style={{ color: "#0B1F3A" }}>
                      {row.rank}
                    </td>
                    {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
                      <td key={pos} className="py-0.5 overflow-hidden">
                        <PlayerCell player={row[pos]} compact />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        ) : (
          /* ── Single-position tiered view ── */
          <div
            className="bg-white rounded-2xl border border-[#b0b8c8] overflow-hidden"
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
                    <div className="px-2 flex items-baseline gap-2 min-w-0">
                      <span className="font-bold text-foreground text-sm md:text-base truncate">
                        {player.player}
                      </span>
                      {teamMap[player.player.toLowerCase().trim()] && (
                        <span className="text-xs font-medium text-muted-foreground shrink-0">
                          {teamMap[player.player.toLowerCase().trim()]}
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
