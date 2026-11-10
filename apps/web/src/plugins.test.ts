import { describe, expect, it } from "vitest";
import type { Plugin } from "@ktb/kernel";

import { plugins as serverPlugins } from "@ktb/app-host";
import { plugins as clientPlugins } from "./plugins.ts";

/**
 * The client registry (@ktb/app-host/client → plugins/<name>/src/client.ts)
 * must mirror the server registry (@ktb/app-host → plugins/<name>/src/index.ts)
 * on everything the browser can observe: plugin ids in topo order, dep
 * edges, and the client-consumed contributions (landingNav, landing,
 * landingFooter, panel.sidebar/headerActions/pages id+path+component).
 * Server-only fields (tables, services, routes, page loader/guard) are
 * excluded — they must never reach the client bundle.
 */
const clientView = (p: Plugin) => ({
	id: p.id,
	requiredDeps: p.requiredDeps ?? [],
	optionalDeps: p.optionalDeps ?? [],
	landingNav: p.landingNav ?? [],
	landing: p.landing ?? null,
	landingFooter: p.landingFooter ?? null,
	panel:
		p.panel === undefined
			? null
			: {
					sidebar: p.panel.sidebar ?? [],
					headerActions: (p.panel.headerActions ?? []).map((a) => ({
						id: a.id,
						component: a.component,
					})),
					pages: (p.panel.pages ?? []).map((page) => ({
						id: page.id,
						path: page.path,
						component: page.component,
					})),
				},
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
		}
	});
});
