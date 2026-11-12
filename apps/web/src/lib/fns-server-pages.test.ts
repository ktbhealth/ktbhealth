import { describe, expect, it, vi } from "vitest";

// serverPageMap (fns.ts) merges every server plugin's panel.pages/pages
// first-wins by path. The real registry has no duplicate page paths, so
// this file mocks #/lib/platform.ts with two plugins claiming the same
// console page path and asserts the first contributor's loader wins.

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => new Headers(),
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		let validate: ((x: unknown) => unknown) | undefined;
		const chain = {
			validator: (v: (x: unknown) => unknown) => {
				validate = v;
				return chain;
			},
			handler: (h: (arg?: { data?: unknown }) => unknown) => async (arg?: { data?: unknown }) =>
				h(arg === undefined ? {} : { ...arg, data: validate ? validate(arg.data) : arg.data }),
		};
		return chain;
	},
}));

const user = { id: "u1", email: "a@x.com", name: "A" };
vi.mock("#/lib/auth.ts", () => ({
	getSessionUser: async () => user,
	ensureSessionUser: async () => user,
}));

vi.mock("#/lib/platform.ts", async () => {
	const Effect = await import("effect/Effect");
	const { PluginStates } = await import("@ktb/platform/plugin-states");
	const states = {
		isEnabled: () => Effect.succeed(true),
		enabledIds: () => Effect.succeed(new Set<string>()),
		config: () => Effect.succeed(undefined),
		setEnabled: () => Effect.void,
		setConfig: () => Effect.void,
		entries: () => Effect.succeed([]),
	};
	const runEffect = (effect: any) =>
		Effect.runPromise(effect.pipe(Effect.provideService(PluginStates, states as never)));
	const dupPath = "/platform/dup-page";
	const page = (id: string, data: string) =>
		({
			id,
			path: dupPath,
			loader: () => Effect.succeed(data),
		}) as never;
	return {
		run: (effect: any) => runEffect(effect),
		runAs: (_user: unknown, effect: any) => runEffect(effect),
		// Two server plugins claim the same page path — topo order wins.
		serverPlugins: [
			{ id: "first.routes", panel: { pages: [page("first.page", "first")] } },
			{ id: "second.routes", panel: { pages: [page("second.page", "second")] } },
		] as never,
	};
});

import type { PanelPage } from "@ktb/kernel";
import { consolePages } from "./registry.ts";
import { platformPageDataFn } from "./fns.ts";

describe("serverPageMap duplicate paths", () => {
	it("keeps the first server plugin's page when two claim one path", async () => {
		const path = "/platform/dup-page";
		const pages = consolePages as unknown as Map<
			string,
			{ page: PanelPage; pluginId: string; context?: string }
		>;
		pages.set(path, {
			page: { id: "test.dup", path, component: () => null } as PanelPage,
			pluginId: "platform.routes",
		});
		try {
			// The client-registry entry has no loader — the merged server
			// page supplies it, and the FIRST contributor wins the dup.
			expect(await platformPageDataFn({ data: path })).toEqual({
				status: "ok",
				data: "first",
			});
		} finally {
			pages.delete(path);
		}
	});
});
