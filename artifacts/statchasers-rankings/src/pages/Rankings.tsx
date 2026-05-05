import { useState, useEffect, useMemo } from "react";
import Papa from "papaparse";
import { Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

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

  const [filterPosition, setFilterPosition] = useState<string>("All");
  const [filterScoring, setFilterScoring] = useState<string>("PPR");

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        // Using a mock fetch approach if the exact sheet URL is a placeholder
        // In a real scenario, Papa.parse takes the URL directly, but to handle placeholder elegantly:
        if (SHEET_URL.includes("YOUR_SHEET_ID")) {
          // Provide mock data for development since real sheet isn't linked
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
            if (results.errors && results.errors.length > 0) {
              console.error("CSV Parse Errors:", results.errors);
            }
            const validData = (results.data as any[]).filter(row => row.player && row.tier && row.rank);
            setData(validData as Player[]);
            setLoading(false);
          },
          error: (error) => {
            setError(`Failed to fetch or parse CSV from ${SHEET_URL}: ${error.message}`);
            setLoading(false);
          }
        });
      } catch (err) {
        setError(`Failed to load rankings: ${err instanceof Error ? err.message : "Unknown error"}`);
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const filteredData = useMemo(() => {
    return data
      .filter((p) => p.scoring === filterScoring && (filterPosition === "All" || p.position === filterPosition))
      .sort((a, b) => a.rank - b.rank);
  }, [data, filterPosition, filterScoring]);

  const groupedByTier = useMemo(() => {
    const groups: Record<number, Player[]> = {};
    filteredData.forEach(player => {
      if (!groups[player.tier]) {
        groups[player.tier] = [];
      }
      groups[player.tier].push(player);
    });
    
    return Object.keys(groups)
      .map(Number)
      .sort((a, b) => a - b)
      .map(tier => ({
        tier,
        players: groups[tier]
      }));
  }, [filteredData]);

  const positions = ["All", "QB", "RB", "WR", "TE"];
  const scoringFormats = ["Standard", "Half PPR", "PPR"];

  return (
    <div className="min-h-[100dvh] bg-background font-sans">
      <header className="bg-background border-b border-border/40 py-6 px-4 md:px-8 text-center sticky top-0 z-20 shadow-sm">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-primary uppercase">StatChasers</h1>
        <p className="text-foreground/90 font-medium tracking-wide mt-1 text-sm md:text-base">2026 Redraft Rankings</p>
      </header>

      <div className="sticky top-[89px] md:top-[92px] z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/40">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-4 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-2 hidden md:inline-block">Pos</span>
            <div className="flex bg-secondary/50 rounded-lg p-1">
              {positions.map(pos => (
                <button
                  key={pos}
                  data-testid={`filter-position-${pos}`}
                  onClick={() => setFilterPosition(pos)}
                  className={cn(
                    "px-3 md:px-4 py-1.5 text-sm font-semibold rounded-md transition-all duration-200",
                    filterPosition === pos 
                      ? "bg-primary text-primary-foreground shadow-sm" 
                      : "text-foreground/70 hover:text-foreground hover:bg-secondary"
                  )}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-2 hidden md:inline-block">Format</span>
            <div className="flex bg-secondary/50 rounded-lg p-1">
              {scoringFormats.map(fmt => (
                <button
                  key={fmt}
                  data-testid={`filter-scoring-${fmt}`}
                  onClick={() => setFilterScoring(fmt)}
                  className={cn(
                    "px-3 md:px-4 py-1.5 text-sm font-semibold rounded-md transition-all duration-200 whitespace-nowrap",
                    filterScoring === fmt 
                      ? "bg-primary text-primary-foreground shadow-sm" 
                      : "text-foreground/70 hover:text-foreground hover:bg-secondary"
                  )}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 md:px-8 py-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
            <p className="text-primary font-medium tracking-wide">Loading rankings...</p>
          </div>
        ) : error ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6 flex flex-col items-center justify-center text-center max-w-lg mx-auto">
            <AlertCircle className="h-10 w-10 text-destructive mb-3" />
            <h3 className="text-foreground font-semibold mb-2">Failed to load data</h3>
            <p className="text-sm text-foreground/80 break-all">{error}</p>
          </div>
        ) : filteredData.length === 0 ? (
          <div className="bg-card rounded-xl p-12 text-center shadow-sm border border-card-border">
            <p className="text-card-foreground font-medium text-lg">No players match the current filters.</p>
            <p className="text-card-foreground/70 text-sm mt-2">Try adjusting your position or scoring format.</p>
          </div>
        ) : (
          <div className="bg-card rounded-xl shadow-lg border border-card-border overflow-hidden">
            <div className="grid grid-cols-[3rem_3rem_1fr] md:grid-cols-[4rem_4rem_1fr] bg-background text-foreground text-xs md:text-sm font-bold uppercase tracking-wider px-4 py-3 border-b border-card-border">
              <div className="text-center">Tier</div>
              <div className="text-center">Rank</div>
              <div className="px-2">Player</div>
            </div>

            <div className="divide-y divide-card-border/50">
              {groupedByTier.map((group) => (
                <div key={`tier-${group.tier}`} className="group/tier">
                  <div className="bg-background/80 text-primary font-bold text-xs md:text-sm tracking-widest uppercase px-4 py-2 border-b border-card-border/50">
                    Tier {group.tier}
                  </div>
                  {group.players.map((player) => (
                    <div 
                      key={`${player.player}-${player.rank}`}
                      data-testid={`row-player-${player.rank}`}
                      className="grid grid-cols-[3rem_3rem_1fr] md:grid-cols-[4rem_4rem_1fr] items-center px-4 py-3 bg-card hover:bg-primary/5 transition-colors duration-150 odd:bg-card even:bg-muted/10 border-b border-card-border/20 last:border-none"
                    >
                      <div className="text-center text-card-foreground/60 font-medium text-xs md:text-sm">{player.tier}</div>
                      <div className="text-center text-card-foreground font-bold text-sm md:text-base">{player.rank}</div>
                      <div className="px-2 font-semibold text-card-foreground text-sm md:text-base truncate">{player.player}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
