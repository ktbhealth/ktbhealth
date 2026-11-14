import type { Plugin } from "./contributions.ts";

/**
 * Contribution-kind registry (P-070).
 *
 * Contribution kinds are DECLARATIVE: each kind is described by a
 * `ContributionKindDescriptor` — its slot on the plugin object, the
 * consumers that collect it, and its ordering contract. The seven
 * built-in kinds map 1:1 onto the dedicated typed fields of the Plugin
 * union (see contributions.ts); domain kinds ("eval.stage", …) ride the
 * generic `contributions` channel on PluginBase and are described by
 * descriptors exported from their owning package (e.g.
 * `EVAL_CONTRIBUTION_KINDS` in @ktb/eval-core).
 *
 * Consumers OPT IN: each surface collects only the kinds it knows —
 * the app host reads the dedicated fields through its own collectors
 * (pages.ts/chrome.ts), apps/eval collects `eval.*` entries from the
 * same plugin graph. The dep graph (requiredDeps/optionalDeps) stays
 * kind-agnostic: it orders plugins, never kinds.
 */

/** The plugin field that carries generic (`contributions[]`) entries. */
export const GENERIC_CONTRIBUTION_SLOT = "contributions";

/**
 * Declarative descriptor for one contribution kind.
 *
 * - `id` — the kind id. For field-carried kinds this equals the Plugin
 *   field name ("pages", "chrome", …); for generic kinds it is the
 *   `kind` value entries carry in `Plugin.contributions`
 *   ("eval.stage", …).
 * - `slot` — where payloads live on the plugin object: a dedicated
 *   field name, or `GENERIC_CONTRIBUTION_SLOT` ("contributions").
 * - `consumers` — free-form ids of the surfaces that collect this
 *   kind ("app-host.server", "app-host.client", "app.routes",
 *   "eval-cli", "plugin-manager"). Documentation and tooling metadata;
 *   collection itself is always opt-in per consumer.
 * - `ordering` — advisory ordering contract: "topo" means plugin
 *   registry (topo) order dominates and declaration order breaks ties
 *   (every built-in kind); "declared" means the payload's own ordering
 *   metadata governs inside the plugin (e.g. chrome `order`).
 */
export interface ContributionKindDescriptor {
	readonly id: string;
	readonly slot: string;
	readonly consumers: readonly string[];
	readonly ordering: "topo" | "declared";
}

const fieldKind = (
	id: string,
	consumers: readonly string[],
	ordering: "topo" | "declared" = "topo",
): ContributionKindDescriptor => ({ id, slot: id, consumers, ordering });

/**
 * The built-in kinds — one per dedicated Plugin union field, in
 * declaration order. These are the kinds the app host's surfaces
 * consume; new kinds register the same way by exporting a descriptor
 * from their owning package and collecting it with
 * `collectKindContributions`.
 */
export const FIELD_CONTRIBUTION_KINDS: readonly ContributionKindDescriptor[] = [
	// Drizzle table slice — carried on the registry for tooling
	// (plugin manager "kinds" column); the drizzle schema itself is
	// aggregated by tools/gen-db-schema.mjs from schema.ts modules.
	fieldKind("tables", ["app-host.server", "plugin-manager"]),
	// Effect layers composed by app-host createApp in topo order.
	fieldKind("services", ["app-host.server", "plugin-manager"]),
	// Route subtree composed by apps/web routes.ts.
	fieldKind("routes", ["app.routes", "plugin-manager"]),
	// Whole-page "/" slot, read by apps/web routes/index.tsx.
	fieldKind("landing", ["app-host.client", "app.routes"]),
	// Shell chrome regions; per-entry `order`/`when` govern render order.
	fieldKind("chrome", ["app-host.client", "app.routes"], "declared"),
	// Console pages under /platform — collected server-side (loaders)
	// and mirrored client-side (id/path/component).
	fieldKind("panel", ["app-host.server", "app-host.client", "plugin-manager"]),
	// Generic pages at arbitrary paths (P-059) — same dual collection.
	fieldKind("pages", ["app-host.server", "app-host.client", "app.routes"]),
];

/** One collected payload of a kind: which plugin carries it, where it
 * sits in the (topo-ordered) registry, and the payload itself. For
 * array fields and generic `contributions` entries `entryIndex` is the
 * element's position; single-payload fields report `entryIndex: 0`. */
export interface CollectedContribution {
	readonly kind: string;
	readonly plugin: Plugin;
	readonly pluginIndex: number;
	readonly entryIndex: number;
	readonly payload: unknown;
}

/**
 * Collect every payload of `kind` across `plugins` (expected in topo
 * order — pass the output of `orderPlugins`). Field-carried kinds fan
 * out over array values and yield one entry per element; non-array
 * field values yield a single entry. Generic kinds (`slot:
 * "contributions"`) yield one entry per matching `contributions[]`
 * element, in declaration order. Kinds a consumer does not pass are
 * never collected — opt-in by construction.
 */
export const collectKindContributions = (
	plugins: readonly Plugin[],
	kind: ContributionKindDescriptor,
): readonly CollectedContribution[] => {
	const out: CollectedContribution[] = [];
	plugins.forEach((plugin, pluginIndex) => {
		if (kind.slot === GENERIC_CONTRIBUTION_SLOT) {
			(plugin.contributions ?? []).forEach((entry, entryIndex) => {
				if (entry.kind === kind.id) {
					out.push({ kind: kind.id, plugin, pluginIndex, entryIndex, payload: entry });
				}
			});
			return;
		}
		const value = (plugin as unknown as Record<string, unknown>)[kind.slot];
		if (value === undefined) return;
		if (Array.isArray(value)) {
			value.forEach((payload, entryIndex) =>
				out.push({ kind: kind.id, plugin, pluginIndex, entryIndex, payload }),
			);
		} else {
			out.push({ kind: kind.id, plugin, pluginIndex, entryIndex: 0, payload: value });
		}
	});
	return out;
};

/** Collect several kinds at once — flatMap over `collectKindContributions`. */
export const collectContributions = (
	plugins: readonly Plugin[],
	kinds: readonly ContributionKindDescriptor[] = FIELD_CONTRIBUTION_KINDS,
): readonly CollectedContribution[] =>
	kinds.flatMap((kind) => collectKindContributions(plugins, kind));

/**
 * Kind ids a single plugin carries: the dedicated field names that are
 * present, plus the distinct `contributions[].kind` values in
 * declaration order. Used by tooling surfaces (plugin manager) that
 * summarize what a plugin contributes.
 */
export const pluginContributionKinds = (plugin: Plugin): readonly string[] => {
	const kinds = new Set<string>();
	for (const kind of FIELD_CONTRIBUTION_KINDS) {
		if ((plugin as unknown as Record<string, unknown>)[kind.slot] !== undefined) {
			kinds.add(kind.id);
		}
	}
	for (const entry of plugin.contributions ?? []) kinds.add(entry.kind);
	return [...kinds];
};
