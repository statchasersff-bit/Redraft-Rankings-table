import { useState, useEffect, useMemo } from "react";
import Papa from "papaparse";
import { Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// Static rankings file served from /public.
// Swap this for a Google Sheet CSV URL when ready.
const SHEET_URL = "/rankings.csv";

interface Player {
  tier: number;
  rank: number;
  player: string;
  position: string;
  scoring?: string; // optional — if absent, player shows under every scoring tab
}

export default function Rankings() {
  const [data, setData] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamMap, setTeamMap] = useState<Record<string, string>>({});

  const [filterPosition, setFilterPosition] = useState<string>("QB");
  const [filterScoring, setFilterScoring] = useState<string>("PPR");

  // Load rankings CSV
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
            // Support both old (lowercase) and new (title-case / "Final Rank") column names
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

  // Fetch player → team lookup from Sleeper's public API (no auth required)
  useEffect(() => {
    fetch("https://api.sleeper.app/v1/players/nfl")
      .then((r) => r.json())
      .then((players: Record<string, { full_name?: string; team?: string | null }>) => {
        const map: Record<string, string> = {};
        Object.values(players).forEach((p) => {
          if (p.full_name && p.team) {
            map[p.full_name.toLowerCase().trim()] = p.team;
          }
        });
        setTeamMap(map);
      })
      .catch(() => {
        // Silently fail — team labels are decorative, not critical
      });
  }, []);

  const filteredData = useMemo(() => {
    return data
      .filter(
        (p) =>
          // If no scoring column in CSV, show under all scoring tabs
          (!p.scoring || p.scoring === filterScoring) &&
          p.position === filterPosition
      )
      .sort((a, b) => a.rank - b.rank);
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

  const positions = ["QB", "RB", "WR", "TE"];
  const scoringFormats = ["Standard", "Half PPR", "PPR"];

  return (
    <div className="min-h-[100dvh] bg-white font-sans">

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
              {scoringFormats.map((fmt) => (
                <button
                  key={fmt}
                  data-testid={`filter-scoring-${fmt.replace(" ", "-")}`}
                  onClick={() => setFilterScoring(fmt)}
                  className={cn(
                    "px-3 md:px-4 py-1.5 text-sm font-semibold rounded-lg border transition-all duration-150 whitespace-nowrap",
                    filterScoring === fmt
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-secondary text-secondary-foreground border-transparent hover:border-border"
                  )}
                >
                  {fmt}
                </button>
              ))}
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
        ) : filteredData.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-border shadow-sm">
            <p className="text-foreground font-semibold text-lg">No players match these filters.</p>
            <p className="text-muted-foreground text-sm mt-2">
              Try a different position or scoring format.
            </p>
          </div>
        ) : (
          <div
            className="bg-white rounded-2xl border border-[#b0b8c8] overflow-hidden"
            style={{ boxShadow: "0 4px 16px rgba(15, 23, 42, 0.12)" }}
          >
            {/* Table Column Headers */}
            <div
              className="grid grid-cols-[3rem_3rem_1fr] md:grid-cols-[4.5rem_4.5rem_1fr] text-white text-xs font-bold uppercase tracking-wider px-4 py-2"
              style={{ background: "#0B1F3A" }}
            >
              <div className="text-center">Tier</div>
              <div className="text-center">Rank</div>
              <div className="px-2">Player</div>
            </div>

            {/* Tier Groups */}
            {groupedByTier.map((group) => (
              <div key={`tier-${group.tier}`}>
                {/* Tier Header */}
                <div
                  className="text-white font-black text-xs tracking-widest uppercase px-4 py-1"
                  style={{ background: "linear-gradient(90deg, #0B1F3A 0%, #132A4A 100%)" }}
                >
                  Tier {group.tier}
                </div>

                {/* Player Rows */}
                {group.players.map((player, idx) => (
                  <div
                    key={`${player.player}-${player.rank}`}
                    data-testid={`row-player-${player.rank}`}
                    className={cn(
                      "grid grid-cols-[3rem_3rem_1fr] md:grid-cols-[4.5rem_4.5rem_1fr] items-center px-4 py-1.5 border-t border-border transition-colors duration-100 hover:bg-[#f8fafc]",
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
