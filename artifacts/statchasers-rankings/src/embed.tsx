// Client entry for the WordPress-mounted build.
//
// The plugin has already emitted the tool's markup into the page HTML, so the
// job here is to hydrate that existing DOM rather than build it from scratch:
// the nodes Google indexed are the same nodes the user ends up interacting
// with. If the markup is missing for any reason (an expired cache, a fetch
// failure that fell through to an empty container) we render from scratch
// instead, so the tool still works.

import { createRoot, hydrateRoot } from "react-dom/client";
import Rankings from "./pages/Rankings";
import {
  DEFAULT_POSITION,
  DEFAULT_SCORING,
  POSITIONS,
  SCORING_FORMATS,
  type PositionFilter,
} from "./lib/rankings-data";
import type { RankingsPayload } from "./lib/rankings-data";
import "./embed.css";

const TOOL_SELECTOR = '[data-statchasers-tool="rankings"]';
const ROOT_SELECTOR = "[data-statchasers-root]";
const PAYLOAD_SELECTOR = "script[data-statchasers-payload]";

const slugify = (value: string) => value.toLowerCase().replace(/\s+/g, "-");

/**
 * The filters the server rendered this markup at.
 *
 * Read back from the container rather than assumed, because the client's first
 * render has to reproduce the markup it is hydrating. The URL may be asking for
 * something else; reconciling with it is the component's job, after hydration.
 */
function readRenderedFilters(container: Element) {
  const scoringSlug = container.getAttribute("data-statchasers-scoring");
  const positionSlug = container.getAttribute("data-statchasers-position");

  return {
    scoring:
      SCORING_FORMATS.find((fmt) => slugify(fmt) === scoringSlug) ??
      DEFAULT_SCORING,
    position:
      (POSITIONS.find(
        (pos) => slugify(pos) === positionSlug,
      ) as PositionFilter | undefined) ?? DEFAULT_POSITION,
  };
}

function readPayload(container: Element): RankingsPayload | undefined {
  const el = container.querySelector(PAYLOAD_SELECTOR);
  if (!el?.textContent) return undefined;
  try {
    return JSON.parse(el.textContent) as RankingsPayload;
  } catch {
    return undefined;
  }
}

function mount(container: Element) {
  const root = container.querySelector<HTMLElement>(ROOT_SELECTOR);
  if (!root || root.dataset.scMounted === "1") return;
  root.dataset.scMounted = "1";

  // Only used if the prerendered payload is missing: the app lives on another
  // origin, so a relative CSV path would resolve against the WordPress host.
  const appOrigin = container.getAttribute("data-statchasers-src");
  const csvUrl = appOrigin
    ? `${appOrigin.replace(/\/$/, "")}/rankings.csv`
    : undefined;

  const payload = readPayload(container);
  const { position, scoring } = readRenderedFilters(container);

  // Only the plugin knows the page's own path, and only the plugin has
  // registered the rewrite rules that make sub-paths resolve. Absent it, the
  // tool leaves the URL alone. See src/lib/url-state.ts.
  const basePath = container.getAttribute("data-statchasers-base") ?? "";

  const tree = (
    <Rankings
      payload={payload}
      csvUrl={csvUrl}
      basePath={basePath}
      initialPosition={position}
      initialScoring={scoring}
    />
  );

  if (root.dataset.prerendered === "1" && root.firstElementChild) {
    hydrateRoot(root, tree);
  } else {
    createRoot(root).render(tree);
  }
}

function mountAll() {
  document.querySelectorAll(TOOL_SELECTOR).forEach(mount);
  startVitals();
}

/**
 * Real-user vitals reporting, deferred until the browser is idle.
 *
 * Loading it eagerly would put a measurement library in front of the work being
 * measured. `requestIdleCallback` puts it after hydration and after the first
 * interaction has had its chance, which is also when the reporter has something
 * worth reporting.
 */
function startVitals() {
  const start = () =>
    void import("./web-vitals").then((m) => m.reportWebVitals());

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(start, { timeout: 5000 });
  } else {
    setTimeout(start, 2000);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountAll, { once: true });
} else {
  mountAll();
}
