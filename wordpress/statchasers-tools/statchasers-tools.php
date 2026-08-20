<?php
/**
 * Plugin Name:       StatChasers Tools
 * Plugin URI:        https://statchasers.com/
 * Description:       Mounts StatChasers interactive tools directly into WordPress pages. The tool's default state is server-rendered into the page HTML and then hydrated by the compiled bundle, so search engines receive the real player names, teams, ranks and table headings in the initial response instead of an empty iframe.
 * Version:           1.3.2
 * Requires at least: 6.3
 * Requires PHP:      7.4
 * Author:            StatChasers
 * License:           GPL-2.0-or-later
 * Text Domain:       statchasers-tools
 *
 * @package StatChasers\Tools
 */

declare( strict_types = 1 );

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'STATCHASERS_TOOLS_VERSION', '1.3.2' );
define( 'STATCHASERS_TOOLS_FILE', __FILE__ );
define( 'STATCHASERS_TOOLS_DIR', plugin_dir_path( __FILE__ ) );

/**
 * Where the tool is deployed, when nothing overrides it.
 *
 * This is baked in so a normal install is upload-activate-shortcode with no
 * configuration step. The plugin loads the compiled bundle from here, so with
 * no origin at all the tool renders as unstyled, non-interactive markup —
 * which is a worse failure than a hardcoded default ever is for a plugin that
 * only ever runs on one site.
 */
define( 'STATCHASERS_TOOLS_DEFAULT_ORIGIN', 'https://redraftrankings.statchasers.com' );

/**
 * Origin the compiled tool is deployed to.
 *
 * Defaults to STATCHASERS_TOOLS_DEFAULT_ORIGIN. Override it by defining
 * STATCHASERS_TOOLS_APP_ORIGIN in wp-config.php or by filtering, which is what
 * a staging site pointing at a staging deploy of the tool would do.
 *
 * Setting it to an empty string is honoured, not treated as unset: the plugin
 * then runs entirely from the files bundled in assets/prerendered/, which still
 * server-renders the rankings into the page but leaves them unstyled and
 * non-interactive, since the stylesheet and bundle both live on the origin.
 */
function statchasers_tools_app_origin(): string {
	$origin = defined( 'STATCHASERS_TOOLS_APP_ORIGIN' )
		? (string) STATCHASERS_TOOLS_APP_ORIGIN
		: STATCHASERS_TOOLS_DEFAULT_ORIGIN;

	/**
	 * Filters the origin the tool bundle and prerendered markup are fetched from.
	 *
	 * @param string $origin Absolute origin, no trailing slash. E.g. https://redraftrankings.statchasers.com
	 */
	$origin = (string) apply_filters( 'statchasers_tools_app_origin', $origin );

	return untrailingslashit( trim( $origin ) );
}

/**
 * How long fetched markup and asset maps are cached.
 */
function statchasers_tools_cache_ttl(): int {
	/**
	 * Filters the cache lifetime for remotely fetched tool markup and assets.
	 *
	 * @param int $ttl Seconds.
	 */
	return (int) apply_filters( 'statchasers_tools_cache_ttl', HOUR_IN_SECONDS );
}

/* -------------------------------------------------------------------------
 * Remote fetching, with the bundled copies as a fallback
 * ---------------------------------------------------------------------- */

/**
 * Read one of the files shipped with the plugin.
 *
 * @param string $name File name inside assets/prerendered/.
 * @return string|null
 */
function statchasers_tools_bundled( string $name ): ?string {
	// Defend against a filtered/derived name ever escaping the directory.
	if ( $name !== basename( $name ) ) {
		return null;
	}

	$path = STATCHASERS_TOOLS_DIR . 'assets/prerendered/' . $name;
	if ( ! is_readable( $path ) ) {
		return null;
	}

	$contents = file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local plugin file.

	return is_string( $contents ) ? $contents : null;
}

/**
 * Fetch a file from the app origin, falling back to the bundled copy.
 *
 * The response is cached either way: a failed fetch is cached for a short
 * window so a down app host doesn't add an HTTP timeout to every page view.
 *
 * @param string   $path          Path on the app origin, e.g. /embed/rankings.html.
 * @param string   $transient     Transient key.
 * @param string   $bundled       Bundled fallback file name.
 * @param callable $is_valid      Receives the body, returns bool.
 * @return string|null
 */
function statchasers_tools_fetch( string $path, string $transient, string $bundled, callable $is_valid ): ?string {
	if ( defined( 'STATCHASERS_TOOLS_USE_BUNDLED' ) && STATCHASERS_TOOLS_USE_BUNDLED ) {
		$local = statchasers_tools_bundled( $bundled );

		return ( null !== $local && $is_valid( $local ) ) ? $local : null;
	}

	$cached = get_transient( $transient );
	if ( is_string( $cached ) ) {
		return '' === $cached ? null : $cached;
	}

	$body   = null;
	$origin = statchasers_tools_app_origin();

	if ( '' !== $origin ) {
		$response = wp_remote_get(
			$origin . $path,
			array(
				'timeout'    => 8,
				'user-agent' => 'StatChasers Tools/' . STATCHASERS_TOOLS_VERSION . '; ' . home_url( '/' ),
			)
		);

		if ( ! is_wp_error( $response ) && 200 === wp_remote_retrieve_response_code( $response ) ) {
			$candidate = wp_remote_retrieve_body( $response );
			if ( is_string( $candidate ) && $is_valid( $candidate ) ) {
				$body = $candidate;
			}
		}
	}

	// Anything unexpected upstream — unreachable host, an error page, a partial
	// response — falls through to the copy that shipped with the plugin rather
	// than putting an empty tool on the page.
	if ( null === $body ) {
		$local = statchasers_tools_bundled( $bundled );
		if ( null !== $local && $is_valid( $local ) ) {
			$body = $local;
		}
	}

	set_transient(
		$transient,
		null === $body ? '' : $body,
		null === $body ? MINUTE_IN_SECONDS * 5 : statchasers_tools_cache_ttl()
	);

	return $body;
}

/**
 * The server-rendered rankings markup for one scoring format.
 *
 * The build emits a fragment per scoring format, because scoring changes the
 * rankings themselves. Position does not — every panel is in every fragment,
 * only which one is `hidden` differs — so position is applied by the client
 * before first paint rather than multiplying these files by five.
 *
 * @param string $scoring Scoring slug, already validated against the route map.
 */
function statchasers_tools_rankings_markup( string $scoring = '' ): ?string {
	$routes = statchasers_tools_routes();
	if ( '' === $scoring || ! in_array( $scoring, $routes['scoring'], true ) ) {
		$scoring = $routes['default_scoring'];
	}

	$is_valid = static function ( string $body ): bool {
		// A real fragment, not an error page or a truncated response.
		return false !== strpos( $body, 'data-statchasers-tool="rankings"' )
			&& false !== strpos( $body, 'data-statchasers-root' );
	};

	$markup = statchasers_tools_fetch(
		'/embed/rankings-' . $scoring . '.html',
		'statchasers_tools_rankings_html_' . $scoring,
		'rankings-' . $scoring . '.html',
		$is_valid
	);

	if ( null !== $markup ) {
		return $markup;
	}

	// A plugin built before the per-scoring split has only the one file. Serving
	// the default board is wrong for /standard/, but it is much better than an
	// empty container, and the client corrects the position either way.
	return statchasers_tools_fetch(
		'/embed/rankings.html',
		'statchasers_tools_rankings_html',
		'rankings.html',
		$is_valid
	);
}

/**
 * Hashed filenames for the compiled bundle.
 *
 * @return array{js:string,css:string[],imports:string[]}|null
 */
function statchasers_tools_assets(): ?array {
	$raw = statchasers_tools_fetch(
		'/embed/assets.json',
		'statchasers_tools_assets',
		'assets.json',
		static function ( string $body ): bool {
			$data = json_decode( $body, true );

			return is_array( $data ) && ! empty( $data['js'] ) && is_string( $data['js'] );
		}
	);

	if ( null === $raw ) {
		return null;
	}

	$data = json_decode( $raw, true );
	if ( ! is_array( $data ) || empty( $data['js'] ) ) {
		return null;
	}

	return array(
		'js'      => (string) $data['js'],
		'css'     => array_values( array_filter( (array) ( $data['css'] ?? array() ), 'is_string' ) ),
		'imports' => array_values( array_filter( (array) ( $data['imports'] ?? array() ), 'is_string' ) ),
	);
}

/**
 * The URL slugs the tool is willing to produce, and the plugin agrees to serve.
 *
 * Read from tool-meta.json, which the tool's build writes from the same lists
 * the tool itself uses. Retyping them here would let the two drift, and the
 * failure mode of that drift is a 404 on a URL the tool just wrote into the
 * address bar. The hardcoded values are a floor for the case where the file
 * predates this feature, not a second source of truth.
 *
 * @return array{scoring:string[],positions:string[],default_scoring:string}
 */
function statchasers_tools_routes(): array {
	static $routes = null;
	if ( null !== $routes ) {
		return $routes;
	}

	$defaults = array(
		'scoring'         => array( 'standard', 'half-ppr', 'ppr' ),
		'positions'       => array( 'all', 'qb', 'rb', 'wr', 'te' ),
		'default_scoring' => 'ppr',
	);

	$meta = statchasers_tools_tool_meta();
	$raw  = is_array( $meta ) && isset( $meta['routes'] ) ? $meta['routes'] : array();

	$clean = static function ( $values, array $fallback ): array {
		if ( ! is_array( $values ) ) {
			return $fallback;
		}
		$out = array();
		foreach ( $values as $value ) {
			if ( is_string( $value ) && preg_match( '/^[a-z0-9-]+$/', $value ) ) {
				$out[] = $value;
			}
		}

		return empty( $out ) ? $fallback : $out;
	};

	$routes = array(
		'scoring'   => $clean( $raw['scoring'] ?? null, $defaults['scoring'] ),
		'positions' => $clean( $raw['positions'] ?? null, $defaults['positions'] ),
	);

	$default = isset( $raw['defaultScoring'] ) ? (string) $raw['defaultScoring'] : '';
	$routes['default_scoring'] = in_array( $default, $routes['scoring'], true )
		? $default
		: $defaults['default_scoring'];

	return $routes;
}

/**
 * Name, description and last-modified date for the tool.
 *
 * Written by the tool's build alongside the markup. The tool renders no heading
 * of its own — the WordPress page's H1 names it — so this is the single place
 * the tool's name is defined for structured data, rather than a second copy
 * maintained in PHP that would quietly drift from the build.
 *
 * @return array{name:string,description:string,dateModified:string}|null
 */
function statchasers_tools_tool_meta(): ?array {
	$raw = statchasers_tools_fetch(
		'/embed/tool-meta.json',
		'statchasers_tools_tool_meta',
		'tool-meta.json',
		static function ( string $body ): bool {
			$data = json_decode( $body, true );

			return is_array( $data ) && ! empty( $data['name'] ) && is_string( $data['name'] );
		}
	);

	if ( null === $raw ) {
		return null;
	}

	$data = json_decode( $raw, true );
	if ( ! is_array( $data ) || empty( $data['name'] ) ) {
		return null;
	}

	return array(
		'name'         => (string) $data['name'],
		'description'  => isset( $data['description'] ) ? (string) $data['description'] : '',
		'dateModified' => isset( $data['dateModified'] ) ? (string) $data['dateModified'] : '',
		'routes'       => isset( $data['routes'] ) && is_array( $data['routes'] ) ? $data['routes'] : array(),
	);
}

/**
 * Absolute URL for a built asset path.
 */
function statchasers_tools_asset_url( string $file ): string {
	$origin = statchasers_tools_app_origin();

	return '' === $origin ? '' : $origin . '/' . ltrim( $file, '/' );
}

/* -------------------------------------------------------------------------
 * Asset loading
 * ---------------------------------------------------------------------- */

/**
 * Whether the current request renders a tool.
 *
 * Checked before wp_head so the bundle can be registered in the head rather
 * than appended in the footer after the shortcode has already run.
 */
function statchasers_tools_page_uses_tool(): bool {
	if ( is_admin() ) {
		return false;
	}

	$uses = false;

	if ( is_singular() ) {
		$post = get_post();
		if ( $post instanceof WP_Post && has_shortcode( (string) $post->post_content, 'statchasers_rankings' ) ) {
			$uses = true;
		}
	}

	/**
	 * Filters whether the tool assets should load on this request.
	 *
	 * Set this to true when calling statchasers_tools_render_rankings() directly
	 * from a theme template, where there is no post content to detect.
	 *
	 * @param bool $uses Whether the assets are needed.
	 */
	return (bool) apply_filters( 'statchasers_tools_enqueue_assets', $uses );
}

/**
 * Register and enqueue the compiled bundle.
 *
 * The tool ships as an ES module, so the tag is rewritten to type="module" in
 * statchasers_tools_script_tag(). Module scripts are deferred by the browser,
 * which means loading from the head costs nothing in render-blocking time and
 * gets the download started as early as possible.
 */
function statchasers_tools_enqueue(): void {
	static $done = false;
	if ( $done ) {
		return;
	}

	$assets = statchasers_tools_assets();
	if ( null === $assets ) {
		return;
	}

	$done = true;

	/**
	 * Filters whether to load Inter from Google Fonts.
	 *
	 * Themes that already serve Inter can return false to avoid a second copy.
	 *
	 * @param bool $load Whether to enqueue the webfont.
	 */
	if ( apply_filters( 'statchasers_tools_load_webfont', true ) ) {
		wp_enqueue_style(
			'statchasers-tools-font',
			'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
			array(),
			null // phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion -- versioned upstream.
		);
	}

	foreach ( $assets['css'] as $index => $file ) {
		$url = statchasers_tools_asset_url( $file );
		if ( '' === $url ) {
			continue;
		}
		wp_enqueue_style(
			0 === $index ? 'statchasers-tools' : 'statchasers-tools-' . $index,
			$url,
			array(),
			null // phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion -- filename is content-hashed.
		);
	}

	$js = statchasers_tools_asset_url( $assets['js'] );
	if ( '' !== $js ) {
		wp_enqueue_script(
			'statchasers-tools',
			$js,
			array(),
			null, // phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion -- filename is content-hashed.
			array(
				// Loaded from the head so the download starts early, but never
				// render-blocking. The tag is rewritten to type="module", which
				// the browser already defers; declaring the strategy as well
				// makes that explicit through the WordPress 6.3+ API and keeps
				// the behaviour correct if the module rewrite is ever removed.
				// Nothing depends on this handle, so deferring is safe.
				'in_footer' => false,
				'strategy'  => 'defer',
			)
		);
	}
}

/**
 * Warm the connections the tool's assets need.
 *
 * The bundle, stylesheet and webfont all come from origins other than this one,
 * and each costs a DNS lookup plus a TLS handshake before its first byte moves.
 * Opening those connections while the HTML is still being parsed takes that
 * cost off the critical path.
 *
 * @param string[] $urls          Hints of this type.
 * @param string   $relation_type Hint type.
 * @return string[]
 */
function statchasers_tools_resource_hints( array $urls, string $relation_type ): array {
	if ( 'preconnect' !== $relation_type || ! statchasers_tools_page_uses_tool() ) {
		return $urls;
	}

	$origin = statchasers_tools_app_origin();
	if ( '' !== $origin ) {
		$urls[] = array(
			'href'        => $origin,
			// Module scripts are fetched in CORS mode, so the preconnected
			// socket only gets reused if the hint is credentialless too.
			'crossorigin' => 'anonymous',
		);
	}

	/** This filter is documented in statchasers_tools_enqueue(). */
	if ( apply_filters( 'statchasers_tools_load_webfont', true ) ) {
		$urls[] = 'https://fonts.googleapis.com';
		$urls[] = array(
			'href'        => 'https://fonts.gstatic.com',
			'crossorigin' => 'anonymous',
		);
	}

	return $urls;
}

/**
 * Serve the bundle as an ES module.
 *
 * @param string $tag    The script tag.
 * @param string $handle Script handle.
 */
function statchasers_tools_script_tag( string $tag, string $handle ): string {
	if ( 'statchasers-tools' !== $handle ) {
		return $tag;
	}

	// Cross-origin module scripts are always fetched in CORS mode; the app host
	// sends Access-Control-Allow-Origin for /assets/*.
	return str_replace( '<script ', '<script type="module" crossorigin ', $tag );
}

/**
 * Preload the chunks the entry statically imports.
 *
 * The entry point is a few hundred bytes and immediately imports the bulk of the
 * app. Without this the browser only discovers those chunks after parsing the
 * entry, which costs a round trip before the tool becomes interactive.
 */
function statchasers_tools_modulepreload(): void {
	if ( ! statchasers_tools_page_uses_tool() ) {
		return;
	}

	$assets = statchasers_tools_assets();
	if ( null === $assets ) {
		return;
	}

	foreach ( $assets['imports'] as $file ) {
		$url = statchasers_tools_asset_url( $file );
		if ( '' === $url ) {
			continue;
		}
		printf(
			'<link rel="modulepreload" href="%s" crossorigin>' . "\n",
			esc_url( $url )
		);
	}
}

/* -------------------------------------------------------------------------
 * Canonicalization
 *
 * The tool's filters are buttons and never write their state into the URL, so
 * there is no ?position=RB&scoring=ppr URL space for this page to begin with.
 * What this section guards against is the same duplication arriving from
 * somewhere else — a share link with tracking parameters, the plugin's own
 * ?statchasers-refresh, a future deep-link feature — and quietly becoming the
 * canonical URL of the page.
 *
 * The rule is single: on a page that hosts a tool, the canonical is that page's
 * own clean permalink, in the initial HTML, unaffected by query parameters.
 * Titles and descriptions are left entirely to the SEO plugin.
 *
 * https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
 * ---------------------------------------------------------------------- */

/**
 * The clean self-referencing canonical for the current tool page.
 *
 * `get_permalink()` returns the post's own URL with no query string, which is
 * exactly the canonical we want — it cannot inherit a tool-state parameter from
 * the request no matter what the visitor arrived with.
 *
 * @return string Absolute URL, or '' when this request has no single canonical.
 */
function statchasers_tools_canonical_url(): string {
	if ( ! is_singular() ) {
		return '';
	}

	$post = get_post();
	if ( ! $post instanceof WP_Post ) {
		return '';
	}

	$permalink = get_permalink( $post );
	if ( ! is_string( $permalink ) || '' === $permalink ) {
		return '';
	}

	// A comment-paged or multi-page post has its own legitimate canonicals per
	// page; only the unpaginated view is safe to force to the bare permalink.
	if ( get_query_var( 'page' ) || get_query_var( 'cpage' ) ) {
		return '';
	}

	/**
	 * Filters the canonical URL forced on tool pages.
	 *
	 * @param string  $permalink Absolute, query-string-free URL.
	 * @param WP_Post $post      The post being rendered.
	 */
	return (string) apply_filters( 'statchasers_tools_canonical_url', $permalink, $post );
}

/**
 * Whether this request should have its canonical guarded.
 */
function statchasers_tools_should_guard_canonical(): bool {
	if ( ! statchasers_tools_page_uses_tool() ) {
		return false;
	}

	/**
	 * Filters whether the plugin enforces the canonical on this request.
	 *
	 * Return false to hand canonicalization back to the SEO plugin entirely.
	 *
	 * @param bool $guard Whether to enforce.
	 */
	return (bool) apply_filters( 'statchasers_tools_guard_canonical', true );
}

/**
 * Replace a canonical produced by an SEO plugin or by core.
 *
 * Yoast, Rank Math and core's own `rel_canonical()` all normally emit the clean
 * permalink already. This keeps that true when they don't — a filter elsewhere
 * appending parameters, or a setting that preserves the query string — without
 * taking over the title and description those plugins own.
 *
 * @param mixed $canonical Whatever the upstream filter passed.
 * @return mixed
 */
function statchasers_tools_filter_canonical( $canonical ) {
	if ( ! statchasers_tools_should_guard_canonical() ) {
		return $canonical;
	}

	// An SEO plugin deliberately setting a cross-page canonical (or false, to
	// suppress it) is a decision we shouldn't silently reverse. Only a canonical
	// that is *this page with parameters attached* gets cleaned up.
	$clean = statchasers_tools_canonical_url();
	if ( '' === $clean ) {
		return $canonical;
	}

	if ( ! is_string( $canonical ) || '' === $canonical ) {
		return $canonical;
	}

	if ( statchasers_tools_is_same_page_url( $canonical, $clean ) ) {
		return $clean;
	}

	// The tool's own filter paths. These are real URLs the plugin serves, so an
	// SEO plugin may well produce one as the canonical of the current request —
	// and 15 self-canonical variants of one board is precisely the duplicate URL
	// space this guard exists to prevent. They fold onto the page itself.
	//
	// To make them indexable landing pages instead, filter
	// `statchasers_tools_canonical_url` to return the request's own URL. That
	// only makes sense alongside genuinely distinct titles and copy per
	// combination — without those it is thin, duplicated content.
	if ( statchasers_tools_is_route_url( $canonical, $clean ) ) {
		return $clean;
	}

	return $canonical;
}

/**
 * Whether two URLs are the same page, ignoring the query string and fragment.
 *
 * @param string $candidate URL to test.
 * @param string $clean     The clean canonical.
 */
/**
 * Whether `$candidate` is `$clean` plus one of the tool's filter path segments.
 *
 * Matched against the known slug lists rather than "any two extra segments", so
 * an unrelated child page under the same parent is never mistaken for tool
 * state and silently canonicalised away.
 */
function statchasers_tools_is_route_url( string $candidate, string $clean ): bool {
	$path_of = static function ( string $url ): string {
		$parts = wp_parse_url( $url );
		if ( ! is_array( $parts ) || ! isset( $parts['path'] ) ) {
			return '';
		}

		return untrailingslashit( (string) $parts['path'] );
	};

	$candidate_path = $path_of( $candidate );
	$clean_path     = $path_of( $clean );

	if ( '' === $candidate_path || '' === $clean_path ) {
		return false;
	}
	if ( 0 !== strpos( $candidate_path, $clean_path . '/' ) ) {
		return false;
	}

	$rest = explode( '/', trim( substr( $candidate_path, strlen( $clean_path ) ), '/' ) );
	if ( 2 !== count( $rest ) ) {
		return false;
	}

	$routes = statchasers_tools_routes();

	return in_array( $rest[0], $routes['scoring'], true )
		&& in_array( $rest[1], $routes['positions'], true );
}

function statchasers_tools_is_same_page_url( string $candidate, string $clean ): bool {
	$strip = static function ( string $url ): string {
		$parts = wp_parse_url( $url );
		if ( ! is_array( $parts ) ) {
			return '';
		}

		$host = isset( $parts['host'] ) ? strtolower( $parts['host'] ) : '';
		$path = isset( $parts['path'] ) ? untrailingslashit( $parts['path'] ) : '';

		return $host . $path;
	};

	$a = $strip( $candidate );
	$b = $strip( $clean );

	return '' !== $a && $a === $b;
}

/**
 * Print a canonical when nothing else did.
 *
 * Core prints one via `rel_canonical()` on `wp_head`, and SEO plugins remove
 * that hook and print their own. If a theme has removed core's without adding a
 * replacement, the page would ship with no canonical at all — so emit one, but
 * only in that gap.
 */
function statchasers_tools_maybe_print_canonical(): void {
	if ( ! statchasers_tools_should_guard_canonical() ) {
		return;
	}

	if ( has_action( 'wp_head', 'rel_canonical' ) ) {
		return; // Core will print it, and our filter has already cleaned it.
	}

	foreach ( array( 'WPSEO_VERSION', 'RANK_MATH_VERSION', 'AIOSEO_VERSION', 'SEOPRESS_VERSION' ) as $seo_plugin ) {
		if ( defined( $seo_plugin ) ) {
			return; // Its own canonical output runs through our filters instead.
		}
	}

	$canonical = statchasers_tools_canonical_url();
	if ( '' === $canonical ) {
		return;
	}

	printf( '<link rel="canonical" href="%s" />' . "\n", esc_url( $canonical ) );
}

/* -------------------------------------------------------------------------
 * Structured data
 *
 * The page is an interactive tool, so it gets one node describing that tool:
 * WebApplication (a subtype of SoftwareApplication) also typed as
 * SportsApplication, which is one of Google's supported application categories.
 *
 * What this section deliberately does NOT do:
 *
 *   - It does not emit its own @graph when an SEO plugin is present. Rank Math
 *     already builds a graph with WebPage, BreadcrumbList, Organization and
 *     WebSite nodes that reference each other by @id; a second, disconnected
 *     graph would describe the same page twice. The node is inserted into the
 *     existing graph and wired to the WebPage and Organization nodes already
 *     in it, so there is one description of the page, not two.
 *   - It does not add Article, Product, FAQPage, Dataset or ItemList. Structured
 *     data has to represent what the page actually is, and irrelevant types earn
 *     nothing.
 *   - It does not invent aggregateRating or review. Those are required for the
 *     SoftwareApplication rich result, which means this page will not qualify
 *     for it — that is the correct outcome, because we have no real ratings.
 *     Fabricating them is a spam policy violation, and the node is still useful
 *     for entity understanding without them.
 *   - It does not touch titles, descriptions, robots directives or breadcrumbs.
 *     Those stay Rank Math's.
 *
 * https://developers.google.com/search/docs/appearance/structured-data/software-app
 * ---------------------------------------------------------------------- */

/**
 * Whether structured data should be added to this request.
 */
function statchasers_tools_should_add_schema(): bool {
	if ( ! statchasers_tools_page_uses_tool() ) {
		return false;
	}

	/**
	 * Filters whether the tool contributes structured data.
	 *
	 * @param bool $add Whether to add the WebApplication node.
	 */
	return (bool) apply_filters( 'statchasers_tools_add_schema', true );
}

/**
 * Find a node's @id in an existing schema graph.
 *
 * Both Rank Math and Yoast build their graphs as nodes with `@id` values that
 * cross-reference each other. Reusing those identifiers is what makes our node
 * part of their graph rather than a parallel one; if the node we're looking for
 * isn't there, we simply omit the reference instead of inventing an @id that
 * resolves to nothing.
 *
 * @param array    $graph Schema nodes.
 * @param string[] $types Acceptable @type values.
 * @return string
 */
function statchasers_tools_find_node_id( array $graph, array $types ): string {
	foreach ( $graph as $node ) {
		if ( ! is_array( $node ) || empty( $node['@id'] ) || ! isset( $node['@type'] ) ) {
			continue;
		}

		$node_types = (array) $node['@type'];
		if ( array_intersect( $node_types, $types ) ) {
			return (string) $node['@id'];
		}
	}

	return '';
}

/**
 * The WebApplication node for the tool.
 *
 * @param array $graph Existing schema nodes to wire into, if any.
 * @return array|null
 */
function statchasers_tools_app_schema( array $graph = array() ): ?array {
	$url = statchasers_tools_canonical_url();
	if ( '' === $url ) {
		return null;
	}

	$meta = statchasers_tools_tool_meta();
	if ( null === $meta ) {
		return null;
	}

	$schema = array(
		'@type'                  => array( 'WebApplication', 'SportsApplication' ),
		'@id'                    => $url . '#statchasers-rankings',
		'name'                   => $meta['name'],
		'url'                    => $url,
		// Google's supported application categories; "SportsApplication" is one
		// of them, and the subcategory is free text describing it further.
		'applicationCategory'    => 'SportsApplication',
		'applicationSubCategory' => 'Fantasy Football',
		// It runs in the browser, so there is no OS requirement to speak of.
		'operatingSystem'        => 'Any',
		'browserRequirements'    => 'Requires JavaScript.',
		'isAccessibleForFree'    => true,
		// A real, accurate offer: the tool is free. Deliberately unaccompanied
		// by aggregateRating — see the note at the top of this section.
		'offers'                 => array(
			'@type'         => 'Offer',
			'price'         => '0',
			'priceCurrency' => 'USD',
		),
	);

	if ( '' !== $meta['description'] ) {
		$schema['description'] = $meta['description'];
	}

	if ( '' !== $meta['dateModified'] ) {
		$schema['dateModified'] = $meta['dateModified'];
	}

	$language = get_bloginfo( 'language' );
	if ( is_string( $language ) && '' !== $language ) {
		$schema['inLanguage'] = $language;
	}

	// Attach to the page and publisher the SEO plugin already described, so this
	// becomes part of its graph instead of a free-floating node.
	$webpage_id = statchasers_tools_find_node_id( $graph, array( 'WebPage', 'CollectionPage', 'ItemPage' ) );
	if ( '' !== $webpage_id ) {
		$schema['mainEntityOfPage'] = array( '@id' => $webpage_id );
	}

	$publisher_id = statchasers_tools_find_node_id( $graph, array( 'Organization', 'Person' ) );
	if ( '' !== $publisher_id ) {
		$schema['publisher'] = array( '@id' => $publisher_id );
	}

	/**
	 * Filters the tool's structured data node.
	 *
	 * Return null to omit it entirely.
	 *
	 * @param array|null $schema The WebApplication node.
	 * @param array      $graph  The existing graph it is being added to.
	 */
	return apply_filters( 'statchasers_tools_app_schema', $schema, $graph );
}

/**
 * Add the node to Rank Math's schema graph.
 *
 * Rank Math keys its pieces by name, so we add ours under our own key. Its
 * WebPage, BreadcrumbList and Organization pieces are left exactly as they are.
 *
 * @param array $data Rank Math's schema pieces.
 * @return array
 */
function statchasers_tools_rank_math_schema( $data ): array {
	if ( ! is_array( $data ) ) {
		return array();
	}

	if ( ! statchasers_tools_should_add_schema() ) {
		return $data;
	}

	$schema = statchasers_tools_app_schema( $data );
	if ( null !== $schema ) {
		$data['statchasersRankings'] = $schema;
	}

	return $data;
}

/**
 * Add the node to Yoast's schema graph.
 *
 * Yoast's graph is a plain list, so ours is appended to it.
 *
 * @param array $graph Yoast's graph pieces.
 * @return array
 */
function statchasers_tools_yoast_schema( $graph ): array {
	if ( ! is_array( $graph ) ) {
		return array();
	}

	if ( ! statchasers_tools_should_add_schema() ) {
		return $graph;
	}

	$schema = statchasers_tools_app_schema( $graph );
	if ( null !== $schema ) {
		$graph[] = $schema;
	}

	return $graph;
}

/**
 * Print the node on its own, for sites with no SEO plugin.
 *
 * Only runs when there is no graph to join. With Rank Math, Yoast, AIOSEO or
 * SEOPress active the filters above handle it and this prints nothing, so the
 * page never carries two descriptions of itself.
 */
function statchasers_tools_print_standalone_schema(): void {
	if ( ! statchasers_tools_should_add_schema() ) {
		return;
	}

	foreach ( array( 'RANK_MATH_VERSION', 'WPSEO_VERSION', 'AIOSEO_VERSION', 'SEOPRESS_VERSION' ) as $seo_plugin ) {
		if ( defined( $seo_plugin ) ) {
			return;
		}
	}

	$schema = statchasers_tools_app_schema();
	if ( null === $schema ) {
		return;
	}

	$schema = array_merge( array( '@context' => 'https://schema.org' ), $schema );

	// Slashes stay escaped (no JSON_UNESCAPED_SLASHES) so a "</script>" can never
	// appear in the output and terminate the block early.
	$json = wp_json_encode( $schema, JSON_UNESCAPED_UNICODE );
	if ( false === $json ) {
		return;
	}

	printf(
		'<script type="application/ld+json">%s</script>' . "\n",
		$json // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- wp_json_encode output in a JSON-LD block.
	);
}

/* -------------------------------------------------------------------------
 * Rendering
 * ---------------------------------------------------------------------- */

/**
 * The rankings tool as HTML, ready to print.
 *
 * On the happy path this is the fragment rendered at build time: real table
 * markup with every position's players, teams and ranks already in it. If that
 * cannot be obtained, an empty mount point is returned instead so the bundle can
 * still render the tool client-side.
 */
function statchasers_tools_render_rankings(): string {
	$origin = statchasers_tools_app_origin();
	$route  = statchasers_tools_current_route();
	$markup = statchasers_tools_rankings_markup( $route['scoring'] );

	if ( null === $markup ) {
		/**
		 * Filters the height reserved for a client-rendered tool, in pixels.
		 *
		 * Only used on the degraded path. Normally the tool is server-rendered
		 * at full height into the page and occupies its final space from the
		 * first paint, so there is nothing to reserve. When the markup could not
		 * be obtained the container starts empty and fills in after the bundle
		 * loads and parses its data — the classic asynchronous-widget layout
		 * shift, and one of the largest CLS contributors there is. Holding the
		 * space up front means the content lands where the gap already was.
		 *
		 * @param int $height Reserved height in pixels.
		 */
		$min_height = (int) apply_filters( 'statchasers_tools_placeholder_height', 900 );

		// Inline rather than in the stylesheet on purpose: this is the path
		// where fetching from the app origin already failed, so the stylesheet
		// on that same origin may not arrive either.
		return sprintf(
			'<div class="statchasers-tool statchasers-tool--rankings" data-statchasers-tool="rankings" data-statchasers-src="%s">'
				. '<div data-statchasers-root data-prerendered="0" style="min-height:%dpx"></div></div>',
			esc_attr( $origin ),
			$min_height
		);
	}

	// Give the client the app origin too, so the degraded path still has
	// somewhere to fetch from if the embedded payload ever fails to parse. The
	// fragment's opening tag is generated by our own renderer, so this match is
	// exact rather than a guess at arbitrary markup.
	$attributes = 'data-statchasers-tool="rankings"';

	if ( '' !== $origin ) {
		$attributes .= sprintf( ' data-statchasers-src="%s"', esc_attr( $origin ) );
	}

	// Only this plugin knows the page's path, and only this plugin registered
	// the rewrite rules that make sub-paths of it resolve. Supplying it is what
	// authorises the tool to rewrite the URL at all.
	$base = statchasers_tools_base_path();
	if ( '' !== $base ) {
		$attributes .= sprintf( ' data-statchasers-base="%s"', esc_attr( $base ) );
	}

	$markup = str_replace( 'data-statchasers-tool="rankings"', $attributes, $markup );

	return $markup;
}

/**
 * [statchasers_rankings] shortcode.
 */
function statchasers_tools_rankings_shortcode(): string {
	// Covers the theme-template case, where the shortcode wasn't detected early
	// enough to enqueue in the head; WordPress prints these in the footer.
	statchasers_tools_enqueue();

	return statchasers_tools_render_rankings();
}

/* -------------------------------------------------------------------------
 * Cache management
 * ---------------------------------------------------------------------- */

/**
 * Drop cached markup and asset maps.
 */
function statchasers_tools_flush_cache(): void {
	// Resolved first: statchasers_tools_routes() reads tool-meta, and reading it
	// after its transient was deleted would refetch from the origin as a side
	// effect of a cache clear.
	$scoring_slugs = statchasers_tools_routes()['scoring'];

	delete_transient( 'statchasers_tools_rankings_html' );
	delete_transient( 'statchasers_tools_assets' );
	delete_transient( 'statchasers_tools_tool_meta' );

	// One fragment per scoring format, each cached under its own key.
	foreach ( $scoring_slugs as $scoring ) {
		delete_transient( 'statchasers_tools_rankings_html_' . $scoring );
	}
}

/**
 * Let an administrator pull a fresh copy after deploying the tool.
 */
function statchasers_tools_maybe_flush_cache(): void {
	if ( ! isset( $_GET['statchasers-refresh'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only cache bust, gated on capability below.
		return;
	}

	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	statchasers_tools_flush_cache();
}


/* -------------------------------------------------------------------------
 * Routing
 *
 * `/redraft-rankings/ppr/te/` has to be an address WordPress answers, not just
 * something the tool writes into the address bar — otherwise it 404s the moment
 * anyone reloads or shares it. These rewrite rules are that promise.
 *
 * They are deliberately built from the *known* slugs rather than a catch-all
 * `([^/]+)/([^/]+)`, so `/redraft-rankings/foo/bar/` still 404s like it should
 * instead of quietly rendering the default board at a nonsense URL.
 * ---------------------------------------------------------------------- */

/**
 * Paths of the pages that host a tool, e.g. `redraft-rankings`.
 *
 * Rewrite rules have to be registered on `init`, long before the query has told
 * us which page is being viewed, so the pages are found up front and cached in
 * an option. A direct query is used because `WP_Query`'s `s` parameter tokenises
 * and would not reliably match a bracketed shortcode.
 *
 * @param bool $refresh Recompute rather than reading the cached list.
 *
 * @return string[]
 */
function statchasers_tools_tool_paths( bool $refresh = false ): array {
	$cached = get_option( 'statchasers_tools_tool_paths', null );
	if ( ! $refresh && is_array( $cached ) ) {
		return $cached;
	}

	global $wpdb;

	$ids = $wpdb->get_col( // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- no core API matches shortcode content; result is cached in an option.
		$wpdb->prepare(
			"SELECT ID FROM {$wpdb->posts}
			 WHERE post_type = 'page' AND post_status = 'publish' AND post_content LIKE %s
			 LIMIT 50",
			'%' . $wpdb->esc_like( '[statchasers_rankings' ) . '%'
		)
	);

	$paths = array();
	foreach ( (array) $ids as $id ) {
		$uri = get_page_uri( (int) $id );
		if ( is_string( $uri ) && '' !== $uri ) {
			$paths[] = trim( $uri, '/' );
		}
	}
	$paths = array_values( array_unique( array_filter( $paths ) ) );

	update_option( 'statchasers_tools_tool_paths', $paths, false );

	return $paths;
}

/**
 * Register a rule per hosting page, and flush only when the rule set changed.
 *
 * `flush_rewrite_rules()` rewrites an option holding every rule on the site, so
 * calling it per request would be a real cost on a large site. The signature
 * covers both the pages and the slug lists, which is exactly what the generated
 * rules depend on.
 */
function statchasers_tools_add_rewrite_rules(): void {
	$paths  = statchasers_tools_tool_paths();
	$routes = statchasers_tools_routes();

	if ( empty( $paths ) ) {
		return;
	}

	$scoring   = implode( '|', array_map( 'preg_quote', $routes['scoring'] ) );
	$positions = implode( '|', array_map( 'preg_quote', $routes['positions'] ) );

	foreach ( $paths as $path ) {
		add_rewrite_rule(
			'^' . preg_quote( $path ) . '/(' . $scoring . ')/(' . $positions . ')/?$',
			'index.php?pagename=' . $path . '&sc_scoring=$matches[1]&sc_position=$matches[2]',
			'top'
		);
	}

	$signature = md5( wp_json_encode( array( $paths, $routes ) ) );
	if ( get_option( 'statchasers_tools_rewrite_signature' ) !== $signature ) {
		update_option( 'statchasers_tools_rewrite_signature', $signature, false );
		flush_rewrite_rules( false );
	}
}

/**
 * Recompute the hosting pages when content changes, so a new tool page starts
 * serving its sub-paths without anyone visiting Settings > Permalinks.
 */
function statchasers_tools_refresh_routes(): void {
	$before = get_option( 'statchasers_tools_tool_paths', null );
	$after  = statchasers_tools_tool_paths( true );

	if ( $before !== $after ) {
		// Forces the signature check in statchasers_tools_add_rewrite_rules() to
		// miss on the next request, which is where the rules are registered.
		delete_option( 'statchasers_tools_rewrite_signature' );
	}
}

/**
 * The scoring/position this request is asking for.
 *
 * Query vars only — never parsed out of REQUEST_URI. If a value is here at all
 * it arrived through a rewrite rule built from the slug lists, so it is already
 * one of the values the tool recognises; it is re-validated anyway because the
 * query var is publicly settable via `?sc_scoring=`.
 *
 * @return array{scoring:string,position:string}
 */
function statchasers_tools_current_route(): array {
	$routes = statchasers_tools_routes();

	$scoring  = (string) get_query_var( 'sc_scoring' );
	$position = (string) get_query_var( 'sc_position' );

	return array(
		'scoring'  => in_array( $scoring, $routes['scoring'], true )
			? $scoring
			: $routes['default_scoring'],
		'position' => in_array( $position, $routes['positions'], true )
			? $position
			: '',
	);
}

/**
 * The hosting page's own path, e.g. `/redraft-rankings/`.
 *
 * Handed to the tool so it knows what to prefix when it rewrites the URL. It is
 * also the tool's permission to rewrite at all: without it the tool leaves the
 * address bar alone, which is what keeps the standalone app — where no rewrite
 * rules exist — from writing URLs that would 404.
 */
function statchasers_tools_base_path(): string {
	if ( ! is_singular() ) {
		return '';
	}

	$post = get_post();
	if ( ! $post instanceof WP_Post ) {
		return '';
	}

	$permalink = get_permalink( $post );
	if ( ! is_string( $permalink ) || '' === $permalink ) {
		return '';
	}

	$path = wp_parse_url( $permalink, PHP_URL_PATH );

	return is_string( $path ) ? user_trailingslashit( $path ) : '';
}

/* -------------------------------------------------------------------------
 * Hooks
 * ---------------------------------------------------------------------- */

add_action(
	'init',
	static function (): void {
		add_shortcode( 'statchasers_rankings', 'statchasers_tools_rankings_shortcode' );
		statchasers_tools_add_rewrite_rules();
	}
);

// The rewrite rules hand the matched slugs over as query vars, so they have to
// be registered as public ones or WordPress discards them.
add_filter(
	'query_vars',
	static function ( array $vars ): array {
		$vars[] = 'sc_scoring';
		$vars[] = 'sc_position';

		return $vars;
	}
);

// Adding the shortcode to a new page, or moving a page that has it, changes
// which paths need rules.
add_action( 'save_post_page', 'statchasers_tools_refresh_routes', 10, 0 );
add_action( 'deleted_post', 'statchasers_tools_refresh_routes', 10, 0 );

add_action( 'template_redirect', 'statchasers_tools_maybe_flush_cache' );

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		if ( statchasers_tools_page_uses_tool() ) {
			statchasers_tools_enqueue();
		}
	}
);

add_action( 'wp_head', 'statchasers_tools_modulepreload', 2 );
add_filter( 'script_loader_tag', 'statchasers_tools_script_tag', 10, 2 );
add_filter( 'wp_resource_hints', 'statchasers_tools_resource_hints', 10, 2 );

// Canonicalization. Late priority so we see the final value each SEO plugin
// intends to print, rather than one another filter then overrides.
add_filter( 'get_canonical_url', 'statchasers_tools_filter_canonical', 99 );          // core
add_filter( 'wpseo_canonical', 'statchasers_tools_filter_canonical', 99 );            // Yoast SEO
add_filter( 'rank_math/frontend/canonical', 'statchasers_tools_filter_canonical', 99 ); // Rank Math
add_filter( 'aioseo_canonical_url', 'statchasers_tools_filter_canonical', 99 );       // All in One SEO
add_filter( 'seopress_titles_canonical', 'statchasers_tools_filter_canonical', 99 );  // SEOPress

// Runs after both core's rel_canonical (10) and the SEO plugins' head output, so
// it can tell whether a canonical was printed at all.
add_action( 'wp_head', 'statchasers_tools_maybe_print_canonical', 99 );

// Structured data. The SEO plugin's graph is extended in place; the standalone
// printer only fires when there is no graph to extend.
add_filter( 'rank_math/json_ld', 'statchasers_tools_rank_math_schema', 99 );
add_filter( 'wpseo_schema_graph', 'statchasers_tools_yoast_schema', 99 );
add_action( 'wp_head', 'statchasers_tools_print_standalone_schema', 99 );

// A new deploy of the tool changes the hashed filenames, so clear on upgrade.
add_action( 'upgrader_process_complete', 'statchasers_tools_flush_cache' );

register_activation_hook(
	__FILE__,
	static function (): void {
		statchasers_tools_flush_cache();
		// The rules are registered on `init`, which has already run by now, so
		// this only clears the signature — the next request registers and
		// flushes. Doing it this way means one flush, not two.
		statchasers_tools_tool_paths( true );
		delete_option( 'statchasers_tools_rewrite_signature' );
	}
);

register_deactivation_hook(
	__FILE__,
	static function (): void {
		statchasers_tools_flush_cache();
		delete_option( 'statchasers_tools_rewrite_signature' );
		// Leaves no rules behind pointing at a plugin that is no longer running.
		flush_rewrite_rules( false );
	}
);
