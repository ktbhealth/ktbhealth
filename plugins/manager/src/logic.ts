import type { Plugin, PluginConfigSchema } from "@ktb/kernel";

/**
 * Pure plugin-manager logic (P-058) — dep-graph walks and row derivation
 * shared by the /platform/plugins view. Everything here is plain data in,
 * plain data out: unit-tested without React or the app runtime.
 */

/** Display name for a plugin row: `meta.name` when declared, else id. */
export const pluginDisplayName = (plugin: Pick<Plugin, "id" | "meta">): string =>
	plugin.meta?.name ?? plugin.id;

/** Contribution kinds a plugin object carries — drives the "kinds" column. */
export const contributionKinds = (plugin: Plugin): readonly string[] => {
	const kinds: string[] = [];
	if (plugin.tables !== undefined) kinds.push("tables");
	if (plugin.services !== undefined) kinds.push("services");
	if (plugin.routes !== undefined) kinds.push("routes");
	if (plugin.landing !== undefined) kinds.push("landing");
	if (plugin.chrome !== undefined) kinds.push("chrome");
	if (plugin.panel !== undefined) kinds.push("panel");
	return kinds;
};

/** Direct `requiredDeps` ids of `pluginId` that are NOT in `enabled` —
 * the "blocked" reason shown when enabling is refused. */
export const missingRequiredDeps = (
	plugins: readonly Plugin[],
	enabled: ReadonlySet<string>,
	pluginId: string,
): readonly string[] => {
	const plugin = plugins.find((p) => p.id === pluginId);
	return (plugin?.requiredDeps ?? []).filter((dep) => !enabled.has(dep));
};

/** Transitive `requiredDeps` closure of `pluginId` (excluding itself),
 * in declaration order, deduplicated. */
export const requiredClosure = (
	plugins: readonly Plugin[],
	pluginId: string,
): readonly string[] => {
	const byId = new Map(plugins.map((p) => [p.id, p] as const));
	const seen = new Set<string>();
	const out: string[] = [];
	const visit = (id: string) => {
		for (const dep of byId.get(id)?.requiredDeps ?? []) {
			if (seen.has(dep)) continue;
			seen.add(dep);
			out.push(dep);
			visit(dep);
		}
	};
	visit(pluginId);
	return out;
};

/**
 * Every plugin that transitively `requiredDep`s on `pluginId` — the
 * cascade set that must be disabled together with it (P-058). Excludes
 * `pluginId` itself; order follows registry (topo) order.
 */
export const dependentClosure = (
	plugins: readonly Plugin[],
	pluginId: string,
): readonly string[] => {
	const dependents = new Set<string>();
	let frontier = [pluginId];
	while (frontier.length > 0) {
		const next: string[] = [];
		for (const p of plugins) {
			if (dependents.has(p.id) || p.id === pluginId) continue;
			if ((p.requiredDeps ?? []).some((dep) => frontier.includes(dep))) {
				dependents.add(p.id);
				next.push(p.id);
			}
		}
		frontier = next;
	}
	return plugins.filter((p) => dependents.has(p.id)).map((p) => p.id);
};

/**
 * The full id set a disable of `pluginId` must send to
 * `setPluginEnabledFn`: the plugin plus every transitive dependent —
 * disabling a dep without its dependents would violate the
 * PluginStates dep invariant and be rejected server-side.
 */
export const disabledClosure = (
	plugins: readonly Plugin[],
	pluginId: string,
): readonly string[] => [pluginId, ...dependentClosure(plugins, pluginId)];

// ---------- generated config form (JSON Schema → fields) ----------

/** One renderable config field derived from the JSON-Schema document. */
export interface ConfigFormField {
	readonly key: string;
	/** `title` annotation when present, else the property key. */
	readonly label: string;
	readonly type: "string" | "number" | "boolean" | "enum";
	/** Allowed values for `type: "enum"`. */
	readonly options?: readonly string[];
	readonly default?: unknown;
	readonly required: boolean;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Project a plugin's `meta.config` JSON-Schema document into the flat
 * field list the generated settings form renders. v1 supports scalar
 * properties only: `type: "string" | "number" | "integer" | "boolean"`
 * and string `enum`s; anything else (`anyOf`/`oneOf`/`const`/nested
 * objects/arrays) is skipped — those plugins need a bespoke
 * `panel.settings` UI. `required` comes from the document's `required`
 * array; `default`/`title` from the property keywords.
 */
export const configFormFields = (config: PluginConfigSchema): readonly ConfigFormField[] => {
	const root = config.schema.schema;
	const properties = isPlainObject(root.properties) ? root.properties : {};
	const required = Array.isArray(root.required) ? root.required : [];
	const fields: ConfigFormField[] = [];
	for (const [key, prop] of Object.entries(properties)) {
		if (!isPlainObject(prop)) continue;
		const type = prop.type;
		const field: ConfigFormField = {
			key,
			label: typeof prop.title === "string" ? prop.title : key,
			required: required.includes(key),
			...("default" in prop ? { default: prop.default } : {}),
			type: "string",
		};
		if (Array.isArray(prop.enum)) {
			// String enums render as a Select; non-string enums have no
			// faithful v1 control — skip rather than degrade to a free input.
			if (prop.enum.every((o) => typeof o === "string")) {
				fields.push({ ...field, type: "enum", options: prop.enum as readonly string[] });
			}
			continue;
		}
		if (type === "boolean") {
			fields.push({ ...field, type: "boolean" });
		} else if (type === "number" || type === "integer") {
			fields.push({ ...field, type: "number" });
		} else if (type === "string") {
			fields.push(field);
		}
		// Unsupported shapes are skipped entirely (see doc comment).
	}
	return fields;
};
