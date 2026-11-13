import { describe, expect, it } from "vitest";
import type { Plugin } from "@ktb/kernel";

import { plugins as serverPlugins } from "@ktb/app-host";
import { plugins as clientPlugins } from "./plugins.ts";

/**
 * The client registry (@ktb/app-host/client → plugins/<name>/src/client.ts)
 * must mirror the server registry (@ktb/app-host → plugins/<name>/src/index.ts)
 * on everything the browser can observe: plugin ids in topo order, dep
 * edges, and the client-consumed contributions (chrome entries,
 * landing.page, panel.pages and pages id+path+component+context).
 * Server-only fields (tables, services, routes, page loader/guard)
 * are excluded — they must never reach the client bundle.
 */
const clientView = (p: Plugin) => ({
	id: p.id,
	system: p.system ?? null,
	meta: p.meta ?? null,
	requiredDeps: p.requiredDeps ?? [],
	optionalDeps: p.optionalDeps ?? [],
	chrome: p.chrome ?? [],
	landing: p.landing ?? null,
	panel:
		p.panel === undefined
			? null
			: {
					pages: (p.panel.pages ?? []).map((page) => ({
						id: page.id,
						path: page.path,
						component: page.component,
					})),
				},
	pages:
		p.pages === undefined
			? null
			: p.pages.map((page) => ({
					id: page.id,
					path: page.path,
					component: page.component,
					context: page.context ?? null,
				})),
});

describe("client plugin registry", () => {
	it("mirrors the server registry on client-visible fields, in order", () => {
		expect(clientPlugins.map(clientView)).toEqual(serverPlugins.map(clientView));
	});

	it("never carries server-only contributions", () => {
		for (const p of clientPlugins) {
			expect(p.tables).toBeUndefined();
			expect(p.services).toBeUndefined();
			for (const page of p.panel?.pages ?? []) {
				expect(page.loader).toBeUndefined();
				expect(page.guard).toBeUndefined();
			}
			for (const page of p.pages ?? []) {
				expect(page.loader).toBeUndefined();
				expect(page.guard).toBeUndefined();
			}
		}
	});

	it("keeps the config contract serializable: meta.config on both, configSchema server-only", () => {
		for (const p of serverPlugins) {
			// meta.config must be the plain JSON-Schema document — the same
			// object the client registry carries (asserted by the parity
			// test above). The runtime validator lives outside meta.
			if (p.meta?.config !== undefined) {
				expect(p.configSchema, `${p.id} declares meta.config but no configSchema`).toBeDefined();
				expect(JSON.parse(JSON.stringify(p.meta.config))).toEqual(p.meta.config);
			}
		}
		for (const p of clientPlugins) {
			// The effect/Schema is not serializable — it must never reach
			// the client registry.
			expect(p.configSchema, `${p.id} leaks configSchema to the client`).toBeUndefined();
		}
	});
});
