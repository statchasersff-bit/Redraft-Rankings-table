# StatChasers Tools (WordPress plugin)

Mounts the StatChasers rankings tool **directly into the WordPress page** — no
iframe. The tool's default state is server-rendered into the page HTML, and the
compiled bundle then hydrates that same markup in place.

The practical effect: `view-source:` on the page now contains the player names,
NFL teams, ranks, tiers, table headings and internal profile links for every
position. Previously all of that lived inside a cross-origin iframe, where none
of it was part of this page's HTML.

## Install

1. Copy the `statchasers-tools/` directory into `wp-content/plugins/` (or upload
   the zip via *Plugins → Add New → Upload Plugin*).
2. Activate **StatChasers Tools** in *Plugins*.
3. Put `[statchasers_rankings]` in the page where the iframe used to be, and
   remove the iframe embed.

There is no configuration step. The origin the tool is deployed to —
`https://redraftrankings.statchasers.com` — is baked in as
`STATCHASERS_TOOLS_DEFAULT_ORIGIN`, because this plugin only ever runs on one
site and an unconfigured install renders the tool unstyled and non-interactive.

To point a staging site at a staging deploy, override it in `wp-config.php`:

```php
define( 'STATCHASERS_TOOLS_APP_ORIGIN', 'https://staging-rankings.example.com' );
```

Use the origin only — no trailing slash, no path.

From a theme template instead of a shortcode:

```php
add_filter( 'statchasers_tools_enqueue_assets', '__return_true' );
echo statchasers_tools_render_rankings(); // phpcs:ignore WordPress.Security.EscapeOutput
```

The filter is what tells the plugin to load the bundle in the head; without a
shortcode in the post content there is nothing for it to detect.

### Headings

The tool renders no title of its own. It emits one `<h3>` per position panel and
never an `<h1>` or `<h2>`, so the WordPress page's own `<h1>` is the page's only
heading and has nothing competing with it. Don't add another `<h1>` around the
shortcode.

## How it loads

`STATCHASERS_TOOLS_APP_ORIGIN` is read for three files, each cached in a
transient for an hour:

| Path                   | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `/embed/rankings.html`  | Prerendered markup printed into the page             |
| `/embed/assets.json`    | Hashed filenames of the compiled JS/CSS              |
| `/embed/tool-meta.json` | Name/description/date used for the structured data   |
| `/assets/*`             | The bundle itself, loaded by the browser             |

Because the plugin resolves filenames through `assets.json`, redeploying the
tool does **not** require touching the plugin — the next cache refresh picks up
the new hashes.

Scripts and styles go through `wp_enqueue_script()` / `wp_enqueue_style()` and
load only on pages that actually contain the shortcode. The script tag is
rewritten to `type="module"`, and the chunks the entry imports get
`<link rel="modulepreload">` hints so hydration isn't delayed by a round trip.

### If the app host is unreachable

Every fetch falls back to the copy of the markup and asset map committed in
`assets/prerendered/`, which is regenerated on each build of the tool. A page
view therefore never depends on a live HTTP call succeeding, and never renders
an empty container while the app host is down.

Failed lookups are cached for five minutes so an outage doesn't add an HTTP
timeout to every request.

## Search-engine behaviour

**Rank Math stays the authority.** It owns the title, meta description, robots
directives, Open Graph tags, breadcrumbs and the schema graph. This plugin adds
exactly two things to that, and both are additive:

1. It guarantees the canonical is the page's own clean permalink.
2. It adds **one** node to Rank Math's existing schema graph, describing the
   tool.

It never emits a second title, a second canonical, a competing robots rule, its
own breadcrumbs, or a parallel schema graph. The rest of the behaviour below is
a property of how the tool itself is built.

### Filter URLs

Each scoring/position combination has a real URL:

```
/redraft-rankings/ppr/te/
/redraft-rankings/standard/rb/
/redraft-rankings/half-ppr/wr/
```

Scoring first, then position, both always present. Sharing a link to the tight
end board works, and so does reloading one.

Three things keep this from becoming a faceted-navigation problem:

1. **The controls are still `<button>`, never `<a href>`.** Google follows
   anchors; it does not click buttons. So these URLs exist and resolve, but the
   crawler is not handed 15 links to them from the page itself.
2. **They canonicalize onto the page.** Every combination declares
   `/redraft-rankings/` as its canonical, so they consolidate rather than
   compete. See *Canonical* below.
3. **The rewrite rules only accept known slugs.** `/redraft-rankings/foo/bar/`
   404s exactly as it did before, rather than rendering a default board at a
   nonsense URL.

The URL is written with `replaceState`, so clicking through six position tabs
doesn't mean six presses of Back to leave the page.

Every panel for every position is rendered into the initial HTML (inactive ones
are `hidden`, not unmounted), so all four positions are crawlable from the clean
URL alone — the filter URLs add shareability, not crawlable content.

**These are not indexable landing pages, by default.** Fifteen URLs sharing one
H1, title and intro is duplicated thin content. To change that, filter
`statchasers_tools_canonical_url` to return the request's own URL — but only
alongside genuinely distinct titles and copy per combination, which is page
content work, not a plugin setting.

#### How the routing works

`statchasers_tools_tool_paths()` finds published pages containing the shortcode
and caches them in an option; `statchasers_tools_add_rewrite_rules()` registers
one rule per page on `init`, built from the slug lists in `tool-meta.json` — the
same lists the tool itself uses, so the URLs the plugin serves and the URLs the
tool produces cannot drift apart.

Rewrite rules live in the database, so they are flushed only when the generated
rule set actually changes (tracked by a signature over the pages and slugs), not
on every request. Adding the shortcode to a new page triggers a recompute via
`save_post_page`.

If filter URLs ever 404, visit **Settings → Permalinks** and save — that forces
a rewrite flush.

### Canonical

On any page hosting a tool, the plugin forces the canonical to that page's own
clean permalink, with any query string dropped. It hooks Yoast, Rank Math, AIOSEO,
SEOPress and core at priority 99, so it sees the final value each would print.

It only rewrites a canonical that is *this same page with parameters attached*.
A canonical deliberately pointing at a different page — or set to `false` to
suppress output — is left alone, so it can't silently undo an intentional
decision. If no canonical would be printed at all (a theme removed core's
`rel_canonical` and no SEO plugin is active), it prints a self-referencing one.

The canonical is always in the initial HTML response and is never touched by
JavaScript.

Set `statchasers_tools_guard_canonical` to `false` to hand the whole thing back
to your SEO plugin.

### Structured data

The page is an interactive tool, so it gets one node describing that tool:
`WebApplication` (a subtype of `SoftwareApplication`) also typed as
`SportsApplication`, which is one of Google's supported application categories.

```jsonc
{
  "@type": ["WebApplication", "SportsApplication"],
  "@id": "https://statchasers.com/…/#statchasers-rankings",
  "name": "2026 Fantasy Football Redraft Rankings",
  "url": "https://statchasers.com/…/",
  "description": "…",
  "applicationCategory": "SportsApplication",
  "applicationSubCategory": "Fantasy Football",
  "operatingSystem": "Any",
  "browserRequirements": "Requires JavaScript.",
  "isAccessibleForFree": true,
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
  "dateModified": "2026-08-03T22:13:00-04:00",
  "inLanguage": "en-US",
  "mainEntityOfPage": { "@id": "…#webpage" },      // Rank Math's WebPage node
  "publisher": { "@id": "…#organization" }          // Rank Math's Organization
}
```

It's added through `rank_math/json_ld` (or `wpseo_schema_graph` under Yoast), so
it joins the graph Rank Math already builds rather than sitting in a second,
disconnected one. Rank Math's `WebPage`, `BreadcrumbList`, `Organization` and
`WebSite` nodes are **not** modified — the new node references them by `@id`,
which is what makes it part of their graph. If a node it wants to reference
isn't in the graph, the reference is omitted rather than pointing at an `@id`
that resolves to nothing.

`name`, `description` and `dateModified` come from `/embed/tool-meta.json`,
written by the tool's build, so the schema says the same thing the page renders.

**No `aggregateRating` and no `review`.** Google's SoftwareApplication *rich
result* requires a rating alongside the offer, so this page won't qualify for
that rich result — which is the correct outcome, because there are no real
ratings to declare. Inventing them is a spam policy violation. The node is still
worth having: it tells Google what this page is.

**Nothing else is added.** No `Article`, `Product`, `FAQPage`, `Dataset` or
`ItemList`. Structured data has to accurately represent the page, and irrelevant
types don't earn ranking benefits.

If no SEO plugin is active at all, the node is printed on its own — that's the
only case where this plugin outputs a JSON-LD block directly.

### Internal links

**Player names are the links.** In the tiered position tables the player's name
is the anchor, so the anchor text is "Josh Allen" rather than "View Profile"
repeated down the column. The icon button in the Profile column goes to the same
place and is kept as a mouse affordance, but it's `aria-hidden` and out of the
tab order so each row exposes one link, not two.

Links out of the tool are absolute (`https://statchasers.com/…`) because the
fragment is built on the app origin and served inside statchasers.com; a
root-relative href would resolve against the wrong host on the standalone app.

The tool links only to player profiles. It does **not** cross-link the other
StatChasers tools — those links belong in the site navigation and page content,
not inside the widget.

### Making the titles agree

Google may derive the result title from the `<title>`, the visible title, the
H1, `og:title` and other prominent wording, so these should say the same thing.
Three of them live outside this plugin:

| Where | Set it in |
| ----- | --------- |
| SEO title, meta description, `og:title` | Rank Math fields for the page |
| `<h1>` | The WordPress page itself |
| The structured data's `name` | `name` in `public/rankings.meta.json`, then rebuild |

A consistent set for the rankings page:

- **SEO title:** `2026 Fantasy Football Redraft Rankings (PPR) | StatChasers`
- **H1:** `2026 Fantasy Football Redraft Rankings`
- **og:title:** `2026 Fantasy Football Redraft Rankings`
- **Schema `name`:** `2026 Fantasy Football Redraft Rankings` *(current value)*

Keep the meta description page-specific — snippets come mainly from page
content, but a good unique description is often used.

The tool itself contributes no title text to the page, so there is nothing here
that can drift out of agreement with the H1. The one value it does contribute is
the structured data's `name`, which lives in build data rather than in PHP for
the same reason.

## Performance

### Assets load only where the tool is

`statchasers_tools_page_uses_tool()` checks the post content for the shortcode
before `wp_head`, and the stylesheet and bundle are enqueued only when it
returns true. A visitor reading a blog post downloads none of it. Rendering from
a theme template instead? Set `statchasers_tools_enqueue_assets` to `true` —
there's no post content to detect there.

Each tool must own its own bundle and its own detection. Adding a second tool
means a second shortcode and a second `assets.json`, so a Strength of Schedule
page never pulls in rankings JavaScript and vice versa.

### Loading strategy

The bundle is enqueued in the head with `'strategy' => 'defer'` and served as
`type="module"` — modules are deferred by the browser anyway, so this starts the
download as early as possible without ever blocking rendering. The chunks the
entry statically imports get `modulepreload` hints so they aren't discovered a
round trip late.

`preconnect` hints are emitted for the app origin and the webfont hosts. The
bundle is cross-origin, so without them the browser pays a DNS lookup and TLS
handshake before the first byte of JavaScript moves.

Three things are deliberately kept **out** of the initial download:

| Chunk | Size (gzip) | Loaded when |
| ----- | ----------- | ----------- |
| `rankings-csv` | ~7.3 kB | Only on the degraded path, when there's no prerendered payload to hydrate from |
| `web-vitals` | ~6.6 kB | After `requestIdleCallback`, and only if the page has analytics |
| — | — | — |

The main chunk is ~73 kB gzip, nearly all of it React. No charting library, data
grid, animation library or date library is in it.

### Layout stability

The tool is server-rendered at full height, so it occupies its final space from
the first paint — there is no 200px container that becomes 1000px once data
arrives. On the degraded path, where the container really does start empty, it
gets an inline `min-height` (filterable via
`statchasers_tools_placeholder_height`) so the content lands in a gap that was
already there.

### Interaction latency

Switching position tabs is the tool's worst realistic interaction: all five
panels stay mounted so the whole board is crawlable, which means a naive
implementation reconciles ~570 rows on every click. Both table components are
`React.memo`-wrapped and their props are memoized upstream to keep that memo
effective.

Measured on the real payload (274 rows, React Profiler, warm):

| | median click | worst click |
| --- | --- | --- |
| Without memo | 19.4 ms | 119.7 ms |
| With memo | 1.2 ms | 1.6 ms |

The worst-case number is the one that matters — INP is set by a session's worst
interaction, and a mid-range phone runs several times slower than the machine
those were measured on.

### Caching

Nothing is recomputed per request. The rankings are baked into the fragment at
build time, the plugin caches the fetched markup and asset map in transients for
an hour, and `public/_headers` marks the content-hashed `/assets/*` immutable
with `stale-while-revalidate` on `/embed/*` and the CSV.

The "last updated" stamp comes from `public/rankings.meta.json` and changes only
when someone changes it — it is never stamped from the current time, so it can't
manufacture false freshness. **Note:** updating the rankings data doesn't touch
the WordPress post, so the sitemap's `<lastmod>` won't move either. If you want
`<lastmod>` to track real data updates, the post needs touching when the data
ships; `check:live` reports the `<lastmod>` it finds so you can see what Google
is being told.

## Testing

Three checks, each catching something the others can't:

| Command | Runs against | Catches |
| ------- | ------------ | ------- |
| `pnpm run check:seo` | The build output | A regression in the tool's own markup contract |
| `pnpm run check:live <url>` | The deployed page, **no JavaScript** | The tool going invisible to crawlers |
| `pnpm run check:rendered <url>` | The deployed page, real browser | The tool being broken for users |

`check:seo` runs as the last step of `pnpm run build`.

`check:live` is the important one. It fetches the page with a plain GET and
asserts the H1, `<title>`, meta description, a self-referencing canonical with
no query string, the structured data (including that no rating was fabricated
and that the graph isn't duplicated), a sampled set of real player names, all
five position panels, the absence of faceted URLs, and the sitemap entry. The
player names are sampled from the local build, so the assertion keeps matching
the data with no fixture to maintain. It's the test that would have caught the
tool silently reverting to an empty iframe.

`check:rendered` drives Chromium at mobile and desktop viewports and asserts
hydration succeeded, the tab click actually switches panels within the 200 ms
INP budget, CLS stays under 0.1, the console is clean, and **mobile renders the
same players as desktop**. Playwright isn't a dependency — install it where you
run this:

```sh
pnpm add -D playwright && npx playwright install chromium
```

### Field data

Lab runs measure one load on one machine and structurally cannot capture INP,
which is set by the worst interaction in a real session. `src/web-vitals.ts`
reports LCP, INP, CLS, FCP and TTFB from real users, tagged with the tool name
and — for INP and CLS — the element responsible, which is the difference between
"the page is slow" and "this button is slow".

It attaches to whatever analytics the page already has (`gtag`, then
`dataLayer`, or a `window.statchasersVitals` function you define) and does
nothing at all if there is none. It loads on idle, after hydration.

### After deploying

Two things this repo cannot check for you:

1. **Search Console → URL Inspection → Test Live URL → View Tested Page → HTML.**
   Confirm the rendered HTML contains the actual player names and table rows,
   not just the H1 and intro paragraph.
2. **Rich Results Test** on the same URL, to validate the schema as Google
   parses it.

Also confirm the page's canonical URL is in the XML sitemap — `check:live`
reports what it finds, but Rank Math's sitemap settings are the source of truth.

### Regression guard

`pnpm run check:seo` in the tool's package (also the last step of `pnpm run
build`) asserts all of the above against the prerendered fragment and the embed
source:

- no `<h1>`, and no head tags or JSON-LD in the fragment
- no anchors carrying filter state; every filter present as a `<button>`
- every exposed player link labelled with the player's name, not "View Profile"
- no `document.title` / `pushState` / `URLSearchParams` in the code that ships

The build fails on a violation. The contract is documented at the top of
`scripts/check-seo-contract.mjs`.

## Configuration

| Constant                        | Default | Purpose                                                   |
| ------------------------------- | ------- | --------------------------------------------------------- |
| `STATCHASERS_TOOLS_APP_ORIGIN`  | *(the baked-in default)* | Override the origin the tool is deployed to |
| `STATCHASERS_TOOLS_USE_BUNDLED` | `false` | Skip all remote fetching and use the committed files only  |

| Filter                             | Purpose                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `statchasers_tools_app_origin`     | Set the origin in code instead of a constant          |
| `statchasers_tools_cache_ttl`      | Cache lifetime in seconds (default 1 hour)            |
| `statchasers_tools_enqueue_assets` | Force asset loading (for theme-template rendering)    |
| `statchasers_tools_load_webfont`   | Return `false` if the theme already serves Inter      |
| `statchasers_tools_guard_canonical`| Return `false` to leave the canonical to your SEO plugin |
| `statchasers_tools_canonical_url`  | Change the canonical the plugin enforces              |
| `statchasers_tools_add_schema`     | Return `false` to omit the tool's structured data      |
| `statchasers_tools_app_schema`     | Edit the WebApplication node, or return `null` to drop it |
| `statchasers_tools_placeholder_height` | Height reserved on the degraded path (default 900px) |
| `statchasers_tools_canonical_url`  | Return the request's own URL to make filter URLs indexable |

## Refreshing after a deploy

Visit any page with the tool as an administrator with `?statchasers-refresh=1`
appended. The cache also clears on plugin activation, deactivation and upgrade.

## Styling and the surrounding theme

The embed stylesheet is built specifically so it cannot affect anything outside
the tool:

- Tailwind's Preflight is **not** included, so your theme's margins, heading
  sizes, link colours and list styles are untouched. A scoped equivalent is
  applied only inside `.statchasers-tool`.
- The build declares **no global custom properties** — the design tokens are
  rewritten onto the tool container, so a `--spacing` or `--font-sans` in your
  theme keeps its own value.
- The tool's own utilities are `!important` and scoped, so theme rules for
  `table`, `th`, `a` and `button` can't bleed into the rankings tables.

## Notes

- `statchasers_tools_render_rankings()` returns markup produced by our own
  build, so it is printed unescaped by design. It is validated for the expected
  container markers before use, and is only ever fetched from the configured
  origin.
- The tool's own URL now sends `X-Robots-Tag: noindex, indexifembedded`, so it
  won't compete with this page in search while remaining processable wherever
  it's embedded.
