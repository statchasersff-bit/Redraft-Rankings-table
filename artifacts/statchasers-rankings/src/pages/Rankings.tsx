import { useState, useEffect, useMemo } from "react";
import Papa from "papaparse";
import { Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ← Replace with your Google Sheet CSV export URL
const SHEET_URL = "https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/export?format=csv&gid=0";

interface Player {
  tier: number;
  rank: number;
  player: string;
  position: string;
  scoring: string;
}

export default function Rankings() {
  const [data, setData] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamMap, setTeamMap] = useState<Record<string, string>>({});

  const [filterPosition, setFilterPosition] = useState<string>("QB");
  const [filterScoring, setFilterScoring] = useState<string>("PPR");

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        if (SHEET_URL.includes("YOUR_SHEET_ID")) {
          const mockData: Player[] = [
            { tier: 1, rank: 1, player: "Christian McCaffrey", position: "RB", scoring: "PPR" },
            { tier: 1, rank: 2, player: "CeeDee Lamb", position: "WR", scoring: "PPR" },
            { tier: 1, rank: 3, player: "Tyreek Hill", position: "WR", scoring: "PPR" },
            { tier: 2, rank: 4, player: "Breece Hall", position: "RB", scoring: "PPR" },
            { tier: 2, rank: 5, player: "Justin Jefferson", position: "WR", scoring: "PPR" },
            { tier: 2, rank: 6, player: "Amon-Ra St. Brown", position: "WR", scoring: "PPR" },
            { tier: 3, rank: 7, player: "Bijan Robinson", position: "RB", scoring: "PPR" },
            { tier: 3, rank: 8, player: "A.J. Brown", position: "WR", scoring: "PPR" },
            { tier: 3, rank: 9, player: "Jonathan Taylor", position: "RB", scoring: "PPR" },
            { tier: 3, rank: 10, player: "Josh Allen", position: "QB", scoring: "PPR" },
            { tier: 3, rank: 11, player: "Travis Kelce", position: "TE", scoring: "PPR" },
            { tier: 1, rank: 1, player: "Christian McCaffrey", position: "RB", scoring: "Standard" },
            { tier: 1, rank: 2, player: "Breece Hall", position: "RB", scoring: "Standard" },
            { tier: 1, rank: 3, player: "Bijan Robinson", position: "RB", scoring: "Standard" },
            { tier: 1, rank: 1, player: "Christian McCaffrey", position: "RB", scoring: "Half PPR" },
            { tier: 1, rank: 2, player: "CeeDee Lamb", position: "WR", scoring: "Half PPR" },
            { tier: 2, rank: 3, player: "Breece Hall", position: "RB", scoring: "Half PPR" },
            { tier: 2, rank: 4, player: "Josh Allen", position: "QB", scoring: "Half PPR" },
            { tier: 1, rank: 1, player: "Josh Allen", position: "QB", scoring: "PPR" },
            { tier: 1, rank: 2, player: "Lamar Jackson", position: "QB", scoring: "PPR" },
            { tier: 2, rank: 3, player: "Jalen Hurts", position: "QB", scoring: "PPR" },
            { tier: 2, rank: 4, player: "Patrick Mahomes", position: "QB", scoring: "PPR" },
            { tier: 3, rank: 5, player: "C.J. Stroud", position: "QB", scoring: "PPR" },
            { tier: 1, rank: 1, player: "Travis Kelce", position: "TE", scoring: "PPR" },
            { tier: 2, rank: 2, player: "Sam LaPorta", position: "TE", scoring: "PPR" },
            { tier: 2, rank: 3, player: "Trey McBride", position: "TE", scoring: "PPR" },
          ];
          setData(mockData);
          setLoading(false);
          return;
        }

        Papa.parse(SHEET_URL, {
          download: true,
          header: true,
          dynamicTyping: true,
          complete: (results) => {
            const validData = (results.data as any[]).filter(
              (row) => row.player && row.tier && row.rank
            );
            setData(validData as Player[]);
            setLoading(false);
          },
          error: (err) => {
            setError(`Failed to fetch rankings: ${err.message}`);
            setLoading(false);
          },
        });
      } catch (err) {
        setError(
          `Failed to load rankings: ${err instanceof Error ? err.message : "Unknown error"}`
        );
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Fetch player→team lookup from Sleeper's public API (no auth required)
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
          p.scoring === filterScoring &&
          (filterPosition === "All" || p.position === filterPosition)
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
    <div className="min-h-[100dvh] bg-muted font-sans">

      {/* Header */}
      <header className="bg-white border-b-2 border-border py-6 px-4 md:px-8 text-center sticky top-0 z-20 shadow-sm">
        <h1 className="text-3xl md:text-4xl font-black tracking-tight uppercase">
          <span className="text-foreground">STAT</span>
          <span className="text-primary">CHASERS</span>
        </h1>
        <p className="text-muted-foreground font-medium tracking-widest mt-1 text-xs md:text-sm uppercase">
          2026 Redraft Rankings
        </p>
        <div className="w-14 h-1 bg-primary rounded-full mx-auto mt-3" />
      </header>

      {/* Sticky Filter Bar */}
      <div className="sticky top-[89px] md:top-[97px] z-10 bg-white border-b border-border shadow-sm">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-3 flex flex-col md:flex-row gap-3 items-center justify-between">
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
      <main className="max-w-5xl mx-auto px-4 md:px-8 py-8">
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
            className="bg-white rounded-2xl border border-border overflow-hidden"
            style={{ boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)" }}
          >
            {/* Table Column Headers */}
            <div
              className="grid grid-cols-[3rem_3rem_1fr] md:grid-cols-[4.5rem_4.5rem_1fr] text-white text-xs font-bold uppercase tracking-wider px-4 py-3"
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
                  className="text-white font-black text-xs tracking-widest uppercase px-4 py-2"
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
                      "grid grid-cols-[3rem_3rem_1fr] md:grid-cols-[4.5rem_4.5rem_1fr] items-center px-4 py-3 border-t border-border transition-colors duration-100 hover:bg-[#f8fafc]",
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
