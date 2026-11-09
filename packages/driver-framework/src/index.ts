import { Graph } from "effect";
import type { Plugin } from "@ktb/kernel";

export * from "./drivers.ts";

interface PluginModule {
	readonly plugins?: unknown;
}

const isPlugin = (value: unknown): value is Plugin =>
	typeof value === "object" && value !== null && typeof (value as Plugin).id === "string";

/**
 * Collect every plugin object exported by Vite
 * `import.meta.glob(..., { eager: true })` modules. Convention: a plugin
 * entry module exports `plugins` — an array of single-concern Plugin
 * values (each built with `definePlugin`). A module that does not export
 * a `plugins` array, or one containing a non-plugin value, is a broken
 * entry and throws — discovery fails loudly rather than dropping it.
 */
export const discoverPlugins = (modules: Record<string, unknown>): Plugin[] => {
	const plugins: Plugin[] = [];
	for (const [path, m] of Object.entries(modules)) {
		const exported = typeof m === "object" && m !== null ? (m as PluginModule).plugins : undefined;
		if (!Array.isArray(exported))
			throw new Error(`plugin module "${path}" must export \`plugins\` as a Plugin array`);
		for (const p of exported) {
			if (!isPlugin(p))
				throw new Error(`plugin module "${path}" exports a value that is not a Plugin`);
			plugins.push(p);
		}
	}
	return plugins;
};

/**
 * Topologically sort plugins by their deps using effect/Graph.
 * `requiredDeps` are hard edges: an id that resolves to no discovered
 * plugin throws eagerly, and absent deps would also fail layer
 * composition. `optionalDeps` are ordering hints — edges are added only
 * when the id resolves, so a missing optional dep is silently ignored.
 * Duplicate plugin ids throw eagerly; dependency cycles surface as
 * GraphError from Graph.topo.
 */
export const orderPlugins = (plugins: readonly Plugin[]): Plugin[] => {
	const byId = new Map<string, Plugin>();
	for (const p of plugins) {
		if (byId.has(p.id)) throw new Error(`duplicate plugin id "${p.id}"`);
		byId.set(p.id, p);
	}
	for (const p of plugins)
		for (const dep of p.requiredDeps ?? [])
			if (!byId.has(dep)) throw new Error(`plugin "${p.id}" requires unknown plugin "${dep}"`);

	const edges = (p: Plugin): readonly string[] => [
		...new Set([...(p.requiredDeps ?? []), ...(p.optionalDeps ?? []).filter((d) => byId.has(d))]),
	];

	const graph = Graph.directed<Plugin, null>((mutable) => {
		const nodes = new Map<string, Graph.NodeIndex>();
		for (const p of plugins) nodes.set(p.id, Graph.addNode(mutable, p));
		for (const p of plugins)
			for (const dep of edges(p)) Graph.addEdge(mutable, nodes.get(dep)!, nodes.get(p.id)!, null);
	});
	return Array.from(Graph.values(Graph.topo(graph)));
};
