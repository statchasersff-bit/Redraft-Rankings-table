import { memo, useState, useEffect, useMemo, useRef } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsomorphicLayoutEffect } from "@/hooks/use-isomorphic-layout-effect";
import {
  readHashState,
  subscribeToHash,
  writeHashState,
} from "@/lib/hash-state";
import {
  ALL_VIEW_COLLAPSED_ROWS,
  DEFAULT_POSITION,
  DEFAULT_SCORING,
  MOBILE_SHORT_NAMES,
  POSITIONS,
  POSITION_LIMITS,
  POSITION_NAMES,
  POSITION_PLURALS,
  SCORING_FORMATS,
  STAT_POSITIONS,
  buildAllView,
  buildPositionView,
  groupByTier,
  normalizeName,
  profileUrl,
  tierColor,
  type AllRow,
  type PositionFilter,
  type Player,
  type RankingsPayload,
  type StatPosition,
  type TierGroup,
} from "@/lib/rankings-data";

const SHEET_URL = "/rankings.csv";
const FALLBACK_UPDATED_AT = "August 3, 2026 10:13pm ET";

type TeamMap = Record<string, string>;

interface RankingsProps {
  /**
   * Server-rendered state. When present the component renders fully-formed on
   * the first pass with no network request, which is what lets the build-time
   * prerender put real player names, teams and ranks into the HTML that
   * WordPress serves. Absent (the standalone app URL), we fall back to
   * fetching the CSV at runtime.
   */
  payload?: RankingsPayload;
  /**
   * Where to fetch the CSV from when there is no payload. WordPress serves the
   * tool from a different origin than the app, so the degraded path needs an
   * absolute URL; the standalone app uses the default relative one.
   */
  csvUrl?: string;
}

export default function Rankings({ payload, csvUrl = SHEET_URL }: RankingsProps) {
  const [players, setPlayers] = useState<Player[]>(payload?.players ?? []);
  const [teamMap, setTeamMap] = useState<TeamMap>(payload?.teams ?? {});
  const [loading, setLoading] = useState(!payload);
  const [error, setError] = useState<string | null>(null);

  const [filterPosition, setFilterPosition] =
    useState<PositionFilter>(DEFAULT_POSITION);
  const [filterScoring, setFilterScoring] = useState<string>(DEFAULT_SCORING);
  const [showAllRows, setShowAllRows] = useState(false);

  const updatedAt = payload?.updatedAt ?? FALLBACK_UPDATED_AT;

  // Deep-linking, fragment only. See src/lib/hash-state.ts for why the fragment
  // and not a query string, and for the format.
  //
  // Applied in a layout effect rather than in the initial state: the markup is
  // server-rendered at the default filters and then hydrated, so seeding state
  // from the URL during render would be a hydration mismatch. A layout effect
  // commits before the browser paints, so a `#te` link still shows TE first —
  // there is no visible flash of the QB board.
  const hashApplied = useRef(false);

  useIsomorphicLayoutEffect(() => {
    const { position, scoring } = readHashState();
    if (position) setFilterPosition(position);
    if (scoring) setFilterScoring(scoring);
    hashApplied.current = true;
  }, []);

  // Back and Forward, which move the fragment without re-mounting us.
  useEffect(
    () =>
      subscribeToHash(() => {
        const { position, scoring } = readHashState();
        setFilterPosition(position ?? DEFAULT_POSITION);
        setFilterScoring(scoring ?? DEFAULT_SCORING);
      }),
    [],
  );

  // Publish the filters back to the fragment, but never on the first pass. The
  // page around us is WordPress: the fragment on arrival may be `#comments` or
  // a theme's own anchor, and mounting is not a reason to clear it. Only a real
  // filter change writes.
  const hashPublished = useRef(false);

  useEffect(() => {
    if (!hashPublished.current) {
      hashPublished.current = true;
      return;
    }
    writeHashState(filterPosition, filterScoring);
  }, [filterPosition, filterScoring]);

  // Runtime data loading only runs for the standalone app. When a payload was
  // baked in at build time it is already the freshest thing we have (the CSV
  // ships with the bundle), so refetching would only cause a needless reflow.
  useEffect(() => {
    if (payload) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    // The parser is a separate chunk, fetched in parallel with the CSV and only
    // on this path. See src/lib/rankings-csv.ts.
    Promise.all([
      fetch(csvUrl).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      }),
      import("@/lib/rankings-csv"),
    ])
      .then(([csv, { parseRankingsCsv }]) => {
        if (cancelled) return;
        setPlayers(parseRankingsCsv(csv));
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(`Failed to load rankings: ${err.message}`);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [payload, csvUrl]);

  // Team abbreviations are normally baked into the payload at build time. The
  // only reason to hit Sleeper from the browser is if that build-time fetch
  // failed and shipped an empty map, in which case filling it in late is better
  // than showing no teams at all.
  const needsTeams = Object.keys(payload?.teams ?? {}).length === 0;

  useEffect(() => {
    if (!needsTeams) return;
    let cancelled = false;

    fetch("https://api.sleeper.app/v1/players/nfl")
      .then((r) => r.json())
      .then((sleeper: Record<string, { full_name?: string; team?: string | null }>) => {
        if (cancelled) return;
        const map: TeamMap = {};
        Object.values(sleeper).forEach((p) => {
          if (p.full_name && p.team) map[normalizeName(p.full_name)] = p.team;
        });
        setTeamMap(map);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [needsTeams]);

  // Every position is derived up front rather than only for the active tab.
  // All five panels stay in the DOM, so QB/RB/WR/TE data never depends on a
  // click to exist.
  const positionViews = useMemo(() => {
    const views = {} as Record<StatPosition, TierGroup[]>;
    STAT_POSITIONS.forEach((pos) => {
      views[pos] = groupByTier(buildPositionView(players, pos, filterScoring));
    });
    return views;
  }, [players, filterScoring]);

  const allViewData = useMemo<AllRow[]>(
    () => buildAllView(players, filterScoring),
    [players, filterScoring],
  );

  const isEmpty =
    allViewData.length === 0 &&
    STAT_POSITIONS.every((pos) => positionViews[pos].length === 0);

  // Memoized for identity, not for the cost of the slice. `AllPositionsTable`
  // is memoized on its props, and a fresh array on every render would defeat
  // that — every position tab click would re-render all ~250 of its cells.
  const visibleAllRows = useMemo(
    () =>
      showAllRows ? allViewData : allViewData.slice(0, ALL_VIEW_COLLAPSED_ROWS),
    [allViewData, showAllRows],
  );

  // Collapse again whenever the filter changes.
  useEffect(() => {
    setShowAllRows(false);
  }, [filterPosition, filterScoring]);

  // Density-based fitting for the All view. We pick the least-compact rendering
  // that fits the available width: 0 = name + team, 1 = name only, 2 = short
  // name only. A ResizeObserver watches a stable full-width wrapper (its box
  // doesn't change when the inner density does, so there's no feedback loop),
  // and a measure -> step-down loop compares the table's width against it.
  //
  // The All panel is present in the DOM even while another tab is active, so a
  // measurement pass can run against a `hidden` element whose widths are all
  // zero. The zero-width guard below skips those passes; the ResizeObserver
  // fires again when the panel is revealed and gives us a real measurement.
  const measureRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [density, setDensity] = useState(0);
  const [measuring, setMeasuring] = useState(false);

  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const start = () => {
      setDensity(0);
      setMeasuring(true);
    };
    const ro = new ResizeObserver(start);
    ro.observe(el);
    start(); // initial pass
    return () => ro.disconnect();
  }, [allViewData, showAllRows]);

  useIsomorphicLayoutEffect(() => {
    if (!measuring) return;
    const wrap = measureRef.current;
    const table = tableRef.current;
    if (!wrap || !table || wrap.clientWidth === 0) {
      setMeasuring(false);
      return;
    }
    const overflowing = table.offsetWidth > wrap.clientWidth + 1;
    if (overflowing && density < 2) {
      setDensity((d) => d + 1); // try a more compact rendering, then re-measure
    } else {
      setMeasuring(false); // fits, or already at the most compact level
    }
  }, [measuring, density]);

  // Report height to the parent iframe host. Only relevant when the app is
  // still embedded cross-origin somewhere; mounted directly into WordPress
  // `window.self === window.top` and this is a no-op. See main.tsx for the
  // passive backstop reporter.
  useEffect(() => {
    if (window.self === window.top) return;
    let raf = 0;
    const report = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        window.parent.postMessage(
          { type: "iframe-resize", height: document.documentElement.scrollHeight },
          "*",
        );
      });
    };
    report();
    document.fonts?.ready.then(report);
    return () => cancelAnimationFrame(raf);
  }, [
    players,
    teamMap,
    filterPosition,
    filterScoring,
    showAllRows,
    density,
    measuring,
  ]);

  function tabId(pos: PositionFilter) {
    return `sc-rankings-tab-${pos.toLowerCase()}`;
  }
  function panelId(pos: PositionFilter) {
    return `sc-rankings-panel-${pos.toLowerCase()}`;
  }

  // Roving arrow-key navigation, as expected of an ARIA tablist.
  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const index = POSITIONS.indexOf(filterPosition);
    const next = POSITIONS[(index + delta + POSITIONS.length) % POSITIONS.length];
    setFilterPosition(next);
    document.getElementById(tabId(next))?.focus();
  }

  return (
    <div className="statchasers-tool bg-white font-sans">
      <ExternalLinkSymbol />
      {/* No heading of its own. The WordPress page's H1 names this tool; a
          near-identical heading inside the widget only competed with it. The
          per-panel <h3>s below still give the tables their structure. */}
      <p className="w-full px-px pt-4 text-xs text-muted-foreground">
        Last updated:{" "}
        {payload?.generatedAt ? (
          <time dateTime={payload.generatedAt}>{updatedAt}</time>
        ) : (
          updatedAt
        )}
      </p>

      {/* Filter Bar */}
      <div className="mt-3 bg-white border-b border-border shadow-sm">
        <div className="w-full px-px py-3 flex flex-col min-[560px]:flex-row gap-3 items-center justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span
              id="sc-rankings-pos-label"
              className="text-xs font-bold text-foreground uppercase tracking-wider hidden min-[560px]:inline-block"
            >
              POS
            </span>
            <div
              role="tablist"
              aria-labelledby="sc-rankings-pos-label"
              className="flex gap-1.5"
            >
              {POSITIONS.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  role="tab"
                  id={tabId(pos)}
                  aria-controls={panelId(pos)}
                  aria-selected={filterPosition === pos}
                  tabIndex={filterPosition === pos ? 0 : -1}
                  data-testid={`filter-position-${pos}`}
                  onClick={() => setFilterPosition(pos)}
                  onKeyDown={onTabKeyDown}
                  className={cn(
                    "px-3 md:px-4 py-1.5 text-sm font-semibold rounded-lg border transition-all duration-150",
                    filterPosition === pos
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-secondary text-secondary-foreground border-transparent hover:border-border",
                  )}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              id="sc-rankings-format-label"
              className="text-xs font-bold text-foreground uppercase tracking-wider hidden min-[560px]:inline-block"
            >
              FORMAT
            </span>
            <div
              role="group"
              aria-labelledby="sc-rankings-format-label"
              className="flex gap-1.5"
            >
              {SCORING_FORMATS.map((fmt) => {
                const isDisabled = fmt !== "PPR";
                return (
                  <button
                    key={fmt}
                    type="button"
                    aria-pressed={filterScoring === fmt}
                    data-testid={`filter-scoring-${fmt.replace(" ", "-")}`}
                    onClick={() => !isDisabled && setFilterScoring(fmt)}
                    disabled={isDisabled}
                    className={cn(
                      "px-3 md:px-4 py-1.5 text-sm font-semibold rounded-lg border transition-all duration-150 whitespace-nowrap",
                      isDisabled
                        ? "bg-secondary text-secondary-foreground/30 border-transparent opacity-40 cursor-not-allowed"
                        : filterScoring === fmt
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : "bg-secondary text-secondary-foreground border-transparent hover:border-border",
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

      <div className="w-full px-px py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
            <p className="text-primary font-semibold tracking-wide">
              Loading rankings...
            </p>
          </div>
        ) : error ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-2xl p-8 flex flex-col items-center text-center max-w-lg mx-auto">
            <AlertCircle className="h-10 w-10 text-destructive mb-3" />
            <h3 className="text-foreground font-semibold mb-2">
              Failed to load data
            </h3>
            <p className="text-sm text-muted-foreground break-all">{error}</p>
          </div>
        ) : isEmpty ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-border shadow-sm">
            <p className="text-foreground font-semibold text-lg">
              No players match these filters.
            </p>
          </div>
        ) : (
          <>
            {/* Every panel is rendered; the inactive ones are `hidden` rather
                than unmounted, so all four positions plus the combined board
                are in the initial HTML without anyone clicking a tab. */}
            <section
              role="tabpanel"
              id={panelId("All")}
              aria-labelledby={tabId("All")}
              hidden={filterPosition !== "All"}
              tabIndex={0}
            >
              <h3 className="mb-2 text-base font-bold text-[#0B1F3A]">
                All Positions, Ranked Side by Side
              </h3>
              <div ref={measureRef} className="w-full">
                <div className="rounded-[15px] border border-border bg-white shadow-sm overflow-hidden">
                  <div className="overflow-x-auto w-full">
                    <AllPositionsTable
                      tableRef={tableRef}
                      rows={visibleAllRows}
                      teamMap={teamMap}
                      density={density}
                      scoring={filterScoring}
                      total={allViewData.length}
                      updatedAt={updatedAt}
                    />
                  </div>
                  {allViewData.length > ALL_VIEW_COLLAPSED_ROWS && (
                    <div className="flex items-center justify-between gap-3 border-t border-border bg-white px-4 py-2.5">
                      <span className="text-xs text-muted-foreground">
                        {showAllRows
                          ? `Showing all ${allViewData.length} players`
                          : `Showing top ${visibleAllRows.length} of ${allViewData.length} players`}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowAllRows((v) => !v)}
                        className="text-xs font-semibold text-[#0B1F3A] hover:text-[#F4C430] transition-colors duration-150 whitespace-nowrap"
                      >
                        {showAllRows ? "Show less" : `Show all ${allViewData.length}`}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {STAT_POSITIONS.map((pos) => (
              <section
                key={pos}
                role="tabpanel"
                id={panelId(pos)}
                aria-labelledby={tabId(pos)}
                hidden={filterPosition !== pos}
                tabIndex={0}
              >
                <h3 className="mb-2 text-base font-bold text-[#0B1F3A]">
                  {POSITION_NAMES[pos]} Rankings
                </h3>
                <PositionTable
                  position={pos}
                  groups={positionViews[pos]}
                  teamMap={teamMap}
                  scoring={filterScoring}
                  updatedAt={updatedAt}
                />
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The external-link glyph appears on every row of every position table. Defined
 * once as a `<symbol>` and referenced with `<use>`, it costs ~60 bytes per row
 * instead of ~330 for a repeated inline icon. Path data matches lucide's
 * `external-link`.
 */
function ExternalLinkSymbol() {
  return (
    <svg aria-hidden="true" focusable="false" style={{ display: "none" }}>
      <symbol
        id="sc-icon-external"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </symbol>
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg className="sc-icon" aria-hidden="true" focusable="false">
      <use href="#sc-icon-external" />
    </svg>
  );
}

/* ── All-positions side-by-side table ───────────────────────────────────── */

/**
 * Memoized. Every panel stays mounted so the whole board is in the HTML, which
 * means an unmemoized tree re-renders all five panels — roughly 570 rows —
 * every time someone clicks a position tab. That is the tool's worst
 * interaction and the one most likely to blow the INP budget, and none of those
 * rows actually change: switching tabs only flips `hidden` on two `<section>`s.
 *
 * Its props are all referentially stable across a tab change (`rows` and the
 * per-position `groups` are memoized upstream, `teamMap`/`scoring`/`updatedAt`
 * are unchanged), so the memo genuinely holds rather than just moving the cost.
 */
const AllPositionsTable = memo(function AllPositionsTable({
  tableRef,
  rows,
  teamMap,
  density,
  scoring,
  total,
  updatedAt,
}: {
  tableRef: React.RefObject<HTMLTableElement | null>;
  rows: AllRow[];
  teamMap: TeamMap;
  density: number;
  scoring: string;
  total: number;
  updatedAt: string;
}) {
  return (
    <table
      ref={tableRef}
      className="border-collapse w-full"
      style={density > 0 ? { minWidth: "360px" } : undefined}
    >
      <caption className="px-2 py-2 text-left text-xs text-muted-foreground">
        Quarterback, running back, wide receiver and tight end rankings aligned
        by overall rank &middot; {scoring} scoring &middot; {total} players
        &middot; updated {updatedAt}
      </caption>
      {/* Rank column sizes to content; the 4 position columns share the rest
          equally so the table fills the width evenly. */}
      <colgroup>
        <col />
        <col style={{ width: "25%" }} />
        <col style={{ width: "25%" }} />
        <col style={{ width: "25%" }} />
        <col style={{ width: "25%" }} />
      </colgroup>
      <thead>
        <tr style={{ background: "#0B1F3A" }}>
          <th
            scope="col"
            className="text-white text-[10px] md:text-xs font-bold uppercase tracking-wider px-0.5 md:px-2 py-2 text-center"
          >
            <abbr title="Positional rank">#</abbr>
          </th>
          {STAT_POSITIONS.map((pos) => (
            <th
              key={pos}
              scope="col"
              className="text-white text-[10px] md:text-xs font-bold uppercase tracking-wider px-0.5 md:px-2 py-2 text-center"
            >
              <abbr title={POSITION_NAMES[pos]}>{pos}</abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.rank}
            className="sc-all-row border-t border-border/60 first:border-t-0"
          >
            <th scope="row" className="sc-all-rank">
              {row.rank}
            </th>
            {STAT_POSITIONS.map((pos) => {
              const cellPlayer = row[pos];
              return (
                <td
                  key={pos}
                  className="sc-all-cell"
                  style={
                    cellPlayer
                      ? { backgroundColor: tierColor(cellPlayer.position, cellPlayer.rank) }
                      : undefined
                  }
                >
                  <PlayerCell player={cellPlayer} teamMap={teamMap} density={density} />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
});

function PlayerCell({
  player,
  teamMap,
  density,
}: {
  player: Player | null;
  teamMap: TeamMap;
  density: number;
}) {
  if (!player) return <div className="sc-player sc-player--empty" />;
  const team = teamMap[normalizeName(player.player)];
  // density 2 -> short name (if available); team only shown at density 0
  const name =
    density >= 2 && MOBILE_SHORT_NAMES[player.player]
      ? MOBILE_SHORT_NAMES[player.player]
      : player.player;
  return (
    <div className="sc-player">
      <a
        href={profileUrl(player.player)}
        target="_blank"
        rel="noopener noreferrer"
        className="sc-player-link"
      >
        <span>{name}</span>
        {density === 0 && team && <span className="sc-player-team">{team}</span>}
      </a>
    </div>
  );
}

/* ── Single-position tiered table ───────────────────────────────────────── */

/** Memoized for the same reason as `AllPositionsTable` above. */
const PositionTable = memo(function PositionTable({
  position,
  groups,
  teamMap,
  scoring,
  updatedAt,
}: {
  position: StatPosition;
  groups: TierGroup[];
  teamMap: TeamMap;
  scoring: string;
  updatedAt: string;
}) {
  const count = groups.reduce((sum, g) => sum + g.players.length, 0);
  const limit = POSITION_LIMITS[position];

  if (count === 0) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center border border-border shadow-sm">
        <p className="text-foreground font-semibold text-lg">
          No {POSITION_PLURALS[position]} match these filters.
        </p>
      </div>
    );
  }

  return (
    <div
      className="bg-white rounded-2xl border border-border overflow-hidden"
      style={{ boxShadow: "0 4px 16px rgba(15, 23, 42, 0.12)" }}
    >
      <table className="w-full border-collapse">
        <caption className="px-4 py-2 text-left text-xs text-muted-foreground">
          Top {Math.min(count, limit)} {POSITION_PLURALS[position]} by tier
          &middot; {scoring} scoring &middot; updated {updatedAt}
        </caption>
        <colgroup>
          <col className="w-12 md:w-18" />
          <col className="w-12 md:w-18" />
          <col />
          <col className="w-px" />
        </colgroup>
        <thead>
          <tr
            className="text-white text-xs font-bold uppercase tracking-wider"
            style={{ background: "#0B1F3A" }}
          >
            <th scope="col" className="text-center px-1 py-2">
              Tier
            </th>
            <th scope="col" className="text-center px-1 py-2">
              Rank
            </th>
            <th scope="col" className="text-left px-2 py-2">
              Player
            </th>
            <th scope="col" className="text-right px-4 py-2">
              Profile
            </th>
          </tr>
        </thead>

        {groups.map((group) => (
          <tbody key={`tier-${group.tier}`}>
            <tr>
              <th
                scope="rowgroup"
                colSpan={4}
                className="text-left text-white font-black text-xs tracking-widest uppercase px-4 py-1"
                style={{
                  background: "linear-gradient(90deg, #0B1F3A 0%, #132A4A 100%)",
                }}
              >
                Tier {group.tier}
              </th>
            </tr>

            {group.players.map((player, idx) => {
              const team = teamMap[normalizeName(player.player)];
              return (
                <tr
                  key={`${player.player}-${player.rank}`}
                  data-testid={`row-player-${player.rank}`}
                  className={cn("sc-pos-row", idx % 2 !== 0 && "sc-alt")}
                >
                  <td className="sc-pos-tier">{player.tier}</td>
                  <td className="sc-pos-rank">{player.rank}</td>
                  {/* The player's name is the link, so the anchor text is the
                      thing being linked to rather than a generic "View
                      Profile". Descriptive anchor text is both better for
                      assistive tech scanning a link list and what search
                      engines read to understand the destination. */}
                  <th scope="row" className="sc-pos-player">
                    <a
                      href={profileUrl(player.player)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sc-pos-player-link"
                    >
                      {player.player}
                    </a>
                    {team && <span className="sc-pos-team">{team}</span>}
                  </th>
                  {/* Same destination as the name link one cell over, kept as a
                      visible affordance for mouse users. It's hidden from
                      assistive tech and removed from the tab order so the row
                      exposes one link, not two identical ones with the weaker
                      of the two labelled "View Profile". */}
                  <td className="sc-pos-profile">
                    <a
                      href={profileUrl(player.player)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-hidden="true"
                      tabIndex={-1}
                      className="sc-profile-link"
                    >
                      <ExternalLinkIcon />
                      <span className="sc-profile-label">View Profile</span>
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
});
