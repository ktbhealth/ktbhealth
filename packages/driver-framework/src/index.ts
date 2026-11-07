import type { Plugin } from "@ktb/kernel";

interface PluginModule {
	readonly plugin?: Plugin;
}

const isPlugin = (value: unknown): value is Plugin =>
	typeof value === "object" && value !== null && typeof (value as Plugin).id === "string";

/**
 * Filter Vite `import.meta.glob(..., { eager: true })` modules down to
 * plugin exports. Convention: a module is a plugin iff it exports a
 * `plugin` value satisfying the Plugin contract.
 */
export const discoverPlugins = (modules: Record<string, unknown>): Plugin[] =>
	Object.values(modules)
		.map((m) => (typeof m === "object" && m !== null ? (m as PluginModule).plugin : undefined))
		.filter(isPlugin);

/**
 * Topologically sort plugins by `deps` (plugin ids). Throws on unknown
 * deps and cycles so misconfiguration fails at startup, not at runtime.
 */
export const orderPlugins = (plugins: readonly Plugin[]): Plugin[] =>
	(() => {
		const byId = new Map(plugins.map((p) => [p.id, p]));
		for (const p of plugins)
			for (const dep of p.deps ?? [])
				if (!byId.has(dep)) throw new Error(`plugin "${p.id}" depends on unknown plugin "${dep}"`);

		const ordered: Plugin[] = [];
		const state = new Map<string, "visiting" | "done">();
		const visit = (p: Plugin): void => {
			const s = state.get(p.id);
			if (s === "done") return;
			if (s === "visiting") throw new Error(`plugin dependency cycle at "${p.id}"`);
			state.set(p.id, "visiting");
			for (const dep of p.deps ?? []) visit(byId.get(dep)!);
			state.set(p.id, "done");
			ordered.push(p);
		};
		for (const p of plugins) visit(p);
		return ordered;
	})();
