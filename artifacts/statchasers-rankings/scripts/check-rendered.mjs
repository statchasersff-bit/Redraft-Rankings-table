// The other half of the SEO/perf test pair: check-live-page.mjs asserts what a
// crawler receives without running scripts; this one drives a real browser and
// asserts the interactive version actually works.
//
// Both matter. A page can serve perfect HTML and hydrate into a broken tool, or
// work beautifully in a browser while shipping an empty container to crawlers.
// Neither test catches the other's failure.
//
// What it measures, and why:
//   - Hydration succeeded and the tool responds to a tab click. A hydration
//     mismatch tends to fail silently and leave dead controls.
//   - The interaction latency of a position tab. That click re-renders the
//     board and is the tool's worst realistic interaction, so it is the one
//     most likely to set the page's INP.
//   - Layout shift during load, which is where an async widget does its damage.
//   - Mobile renders the same rankings as desktop, since Google indexes the
//     mobile version.
//
//   node scripts/check-rendered.mjs https://statchasers.com/nfl/…/
//
// Playwright is not a dependency of this package — it pulls a browser download
// that most builds don't want. Install it where you run this:
//   pnpm add -D playwright && npx playwright install chromium

const url = process.argv[2] ?? process.env.STATCHASERS_PAGE_URL;

// Google's "good" thresholds. INP is measured here as the latency of one
// deliberate interaction, which is a floor on the real field metric, not a
// substitute for it — see the note printed at the end.
const BUDGET = { interaction: 200, cls: 0.1 };

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    console.error(
      "[rendered] playwright is not installed.\n\n" +
        "  pnpm add -D playwright && npx playwright install chromium\n\n" +
        "Skipping the rendered-browser check.",
    );
    return null;
  }
}

const failures = [];
const oks = [];
const fail = (rule, detail) => failures.push(`${rule}: ${detail}`);
const ok = (detail) => oks.push(detail);

async function checkViewport(browser, viewport, expectedPlayers) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    deviceScaleFactor: viewport.isMobile ? 3 : 1,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // Start observing layout shifts before anything renders.
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

  const label = viewport.name;

  // 1. Hydration: the mount point should be flagged as mounted.
  const mounted = await page
    .locator("[data-statchasers-root][data-sc-mounted='1']")
    .count();
  if (mounted === 0) {
    fail(label, "the tool never hydrated (no mounted root)");
  } else {
    ok(`${label}: tool hydrated`);
  }

  // 2. The rankings are actually in the rendered DOM — the mobile-parity check.
  const rendered = await page.evaluate(
    () => document.querySelector('[data-statchasers-tool="rankings"]')?.innerText ?? "",
  );
  const missing = expectedPlayers.filter((n) => !rendered.includes(n));
  if (missing.length > 0) {
    fail(
      label,
      `${missing.length}/${expectedPlayers.length} players missing from the rendered DOM (e.g. ${missing.slice(0, 3).join(", ")})`,
    );
  } else {
    ok(`${label}: all ${expectedPlayers.length} sampled players rendered`);
  }

  // 3. The controls work, and the click is fast.
  const rbTab = page.locator('[data-testid="filter-position-RB"]');
  if ((await rbTab.count()) === 0) {
    fail(label, "no RB filter control found");
  } else {
    const latency = await page.evaluate(async () => {
      const button = document.querySelector('[data-testid="filter-position-RB"]');
      const start = performance.now();
      button.click();
      // Wait for the browser to finish rendering the result of the click.
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      return performance.now() - start;
    });

    const rbVisible = await page
      .locator("#sc-rankings-panel-rb")
      .isVisible()
      .catch(() => false);
    const qbVisible = await page
      .locator("#sc-rankings-panel-qb")
      .isVisible()
      .catch(() => false);

    if (!rbVisible || qbVisible) {
      fail(label, `clicking RB did not switch panels (rb visible: ${rbVisible}, qb visible: ${qbVisible})`);
    } else if (latency > BUDGET.interaction) {
      fail(label, `the RB tab click took ${latency.toFixed(0)}ms, over the ${BUDGET.interaction}ms INP budget`);
    } else {
      ok(`${label}: RB tab switches panels in ${latency.toFixed(0)}ms`);
    }
  }

  // 4. Layout shift accumulated during load.
  const cls = await page.evaluate(() => window.__cls ?? 0);
  if (cls > BUDGET.cls) {
    fail(label, `cumulative layout shift ${cls.toFixed(3)} exceeds ${BUDGET.cls}`);
  } else {
    ok(`${label}: CLS ${cls.toFixed(3)}`);
  }

  // 5. LCP, for information — a synthetic run on a fast connection is not the
  //    field metric, so this reports rather than gates.
  const lcp = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let value = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) value = e.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        setTimeout(() => resolve(value), 500);
      }),
  );
  ok(`${label}: LCP ${(lcp / 1000).toFixed(2)}s (synthetic, not a field measurement)`);

  if (consoleErrors.length > 0) {
    fail(label, `${consoleErrors.length} console error(s): ${consoleErrors[0].slice(0, 160)}`);
  } else {
    ok(`${label}: no console errors`);
  }

  await context.close();
}

async function main() {
  if (!url) {
    console.error("usage: node scripts/check-rendered.mjs <url>");
    process.exitCode = 2;
    return;
  }

  const pw = await loadPlaywright();
  if (!pw) {
    process.exitCode = 0; // a missing optional tool is not a failing build
    return;
  }

  // Sample the same players the no-JS check uses, from the local build.
  let expectedPlayers = [];
  try {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const payload = JSON.parse(
      await readFile(
        path.resolve(import.meta.dirname, "..", "dist", "public", "embed", "rankings.json"),
        "utf8",
      ),
    );
    expectedPlayers = payload.players.slice(0, 8).map((p) => p.player);
  } catch {
    console.warn("[rendered] no local build to sample players from; skipping the content check");
  }

  const browser = await pw.chromium.launch();
  try {
    for (const viewport of VIEWPORTS) {
      await checkViewport(browser, viewport, expectedPlayers);
    }
  } finally {
    await browser.close();
  }

  for (const line of oks) console.log(`  ok    ${line}`);
  for (const line of failures) console.error(`  FAIL  ${line}`);

  console.log(`\n[rendered] ${oks.length} ok, ${failures.length} failure(s)`);
  console.log(
    "[rendered] note: these are synthetic measurements on one machine. They\n" +
      "           catch regressions but do not replace field data — see the\n" +
      "           web-vitals reporter in src/web-vitals.ts for that.",
  );

  if (failures.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[rendered] failed: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
