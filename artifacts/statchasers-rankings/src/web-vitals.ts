// Real-user Core Web Vitals reporting.
//
// Lab tools measure one load on one machine. They cannot see the metric that
// matters most for a tool like this one: INP is determined by the worst
// interaction across a real session — someone flicking between position tabs on
// a mid-range Android — and that never happens in a synthetic run.
//
// The reporter is loaded lazily and after the page has settled, so measuring
// performance never costs any. It attaches to whichever analytics the host page
// already has rather than introducing an endpoint of its own; if there is no
// analytics on the page, it does nothing at all.
//
// Every metric is tagged with the tool name so the tool's vitals can be
// separated from the rest of the site's, and INP carries the attribution data
// naming the element that caused it — without that, a bad INP tells you the
// page is slow but not which control to fix.

import type { Metric } from "web-vitals";

const TOOL = "rankings";

/** Google's "good" thresholds, for labelling a sample as it's sent. */
const THRESHOLDS: Record<string, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

type Sink = (name: string, params: Record<string, unknown>) => void;

declare global {
  interface Window {
    gtag?: (command: string, event: string, params: Record<string, unknown>) => void;
    dataLayer?: unknown[];
    statchasersVitals?: Sink;
  }
}

function rating(metric: Metric): string {
  const bounds = THRESHOLDS[metric.name];
  if (!bounds) return "unknown";
  if (metric.value <= bounds[0]) return "good";
  return metric.value <= bounds[1] ? "needs-improvement" : "poor";
}

/**
 * Where to send samples, in order of preference. Returns null when the page has
 * no analytics, in which case nothing is measured at all.
 */
function resolveSink(): Sink | null {
  if (typeof window.statchasersVitals === "function") {
    return window.statchasersVitals;
  }
  if (typeof window.gtag === "function") {
    return (name, params) => window.gtag!("event", name, params);
  }
  if (Array.isArray(window.dataLayer)) {
    return (name, params) => window.dataLayer!.push({ event: name, ...params });
  }
  return null;
}

/**
 * What caused the metric, when the library can tell us.
 *
 * For INP this is the interaction target — the specific button or link whose
 * handler was slow — which is the difference between an actionable report and a
 * number.
 */
function attribution(metric: Metric): Record<string, unknown> {
  const attr = (metric as unknown as { attribution?: Record<string, unknown> })
    .attribution;
  if (!attr) return {};

  const out: Record<string, unknown> = {};
  for (const key of [
    "interactionTarget",
    "interactionType",
    "largestShiftTarget",
    "element",
    "url",
  ]) {
    const value = attr[key];
    if (typeof value === "string" && value !== "") {
      out[`sc_${key}`] = value.slice(0, 200);
    }
  }
  return out;
}

function send(sink: Sink, metric: Metric) {
  sink("web_vitals", {
    sc_tool: TOOL,
    sc_metric: metric.name,
    // GA4 rejects non-integer metric values, and CLS is a small decimal.
    sc_value: metric.name === "CLS" ? Math.round(metric.value * 1000) : Math.round(metric.value),
    sc_rating: rating(metric),
    sc_navigation_type: metric.navigationType,
    sc_id: metric.id,
    sc_path: location.pathname,
    ...attribution(metric),
  });
}

/**
 * Start reporting. Safe to call more than once; only the first call does work.
 */
export function reportWebVitals(): void {
  if (typeof window === "undefined") return;

  const w = window as unknown as { __scVitalsStarted?: boolean };
  if (w.__scVitalsStarted) return;

  const sink = resolveSink();
  if (!sink) return; // no analytics on this page; measuring would go nowhere

  w.__scVitalsStarted = true;

  // The attribution build is a little larger but is the only version that can
  // name the element responsible for a bad INP or CLS. Imported dynamically so
  // it lands in its own chunk and never delays hydration.
  void import("web-vitals/attribution").then(({ onLCP, onINP, onCLS, onFCP, onTTFB }) => {
    onLCP((m) => send(sink, m));
    onINP((m) => send(sink, m));
    onCLS((m) => send(sink, m));
    onFCP((m) => send(sink, m));
    onTTFB((m) => send(sink, m));
  });
}
