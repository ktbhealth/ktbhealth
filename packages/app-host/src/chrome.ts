import type { ChromeContribution, Plugin } from "@ktb/kernel";

/**
 * Chrome region collection (P-060): shells own named regions and plugins
 * fill them via `chrome` contributions. `collectChrome` filters by
 * region + `when` rules against the current pathname and orders by
 * `order ?? Infinity`, ties broken by plugin topo order then array
 * index. `unknownChromeRegions` feeds the dev warning for contributions
 * aimed at regions no shell declares.
 */

/** `prefix/*` matches the bare prefix and its descendants; anything
 * else is an exact pathname match. */
const pathMatches = (pattern: string, pathname: string): boolean => {
	if (pattern.endsWith("/*")) {
		const base = pattern.slice(0, -2);
		return pathname === base || pathname.startsWith(`${base}/`);
	}
	return pathname === pattern;
};

/** Whether a contribution's `when` rules admit `pathname`. */
export const chromeWhenMatches = (when: ChromeContribution["when"], pathname: string): boolean => {
	if (when === undefined) return true;
	if (when.exceptPaths?.some((p) => pathMatches(p, pathname))) return false;
	if (when.paths === undefined || when.paths.length === 0) return true;
	return when.paths.some((p) => pathMatches(p, pathname));
};

interface Ranked {
	readonly entry: ChromeContribution;
	readonly pluginIndex: number;
	readonly entryIndex: number;
}

/** Chrome contributions for `region` visible at `pathname`, in render
 * order. Plugins without `chrome` contribute nothing. */
export const collectChrome = (
	plugins: readonly Plugin[],
	region: string,
	pathname: string,
): ChromeContribution[] => {
	const ranked: Ranked[] = [];
	plugins.forEach((plugin, pluginIndex) => {
		(plugin.chrome ?? []).forEach((entry, entryIndex) => {
			if (entry.region === region && chromeWhenMatches(entry.when, pathname)) {
				ranked.push({ entry, pluginIndex, entryIndex });
			}
		});
	});
	ranked.sort(
		(a, b) =>
			(a.entry.order ?? Number.POSITIVE_INFINITY) - (b.entry.order ?? Number.POSITIVE_INFINITY) ||
			a.pluginIndex - b.pluginIndex ||
			a.entryIndex - b.entryIndex,
	);
	return ranked.map((r) => r.entry);
};

/** Region names contributed by `plugins` that `knownRegions` does not
 * declare — each is skipped by every shell; the caller warns in dev. */
export const unknownChromeRegions = (
	plugins: readonly Plugin[],
	knownRegions: ReadonlySet<string>,
): string[] => {
	const unknown = new Set<string>();
	for (const plugin of plugins) {
		for (const entry of plugin.chrome ?? []) {
			if (!knownRegions.has(entry.region)) unknown.add(entry.region);
		}
	}
	return [...unknown].sort();
};

/** Every region a first-party shell declares (app shell in
 * `routes/__root.tsx`, console shell in `routes/platform.tsx`). The dev
 * warning uses the union so a contribution aimed at the *other* shell's
 * region isn't a false positive. */
export const KNOWN_CHROME_REGIONS: ReadonlySet<string> = new Set([
	"app.header.brand",
	"app.header.nav",
	"app.header.actions",
	"app.header.session",
	"app.footer.blocks",
	"app.footer.note",
	"console.sidebar",
	"console.header.actions",
]);

/** Dev-only warning for chrome contributions aimed at undeclared
 * regions — skipped everywhere, so surface the typo loudly. */
export const warnUnknownChromeRegions = (
	plugins: readonly Plugin[],
	knownRegions: ReadonlySet<string>,
): void => {
	for (const region of unknownChromeRegions(plugins, knownRegions)) {
		// eslint-disable-next-line no-console -- dev-only diagnostic
		console.warn(`[chrome] no shell declares region "${region}" — contribution skipped`);
	}
};
