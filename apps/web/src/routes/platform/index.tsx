import { createElement } from "react";
import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";

import { platformPageDataFn, pluginStatesFn } from "#/lib/fns.ts";
import { consolePages, enabledIdSet, findPage } from "#/lib/registry.ts";
import { plugins } from "#/plugins.ts";
import { getLocale } from "#/paraglide/runtime.js";

const PATH = "/platform";
const rootApi = getRouteApi("__root__");

// Console landing page (P-050): the dashboard plugin contributes a
// `panel.pages` descriptor for "/platform"; this route is a generic
// dispatcher — it resolves the descriptor, 404s when absent, when the
// owning plugin is disabled (P-058) or when the page's `guard` Effect
// denies, fetches the loader Effect's result via the platformPageDataFn
// server fn (isomorphic: direct on SSR, RPC on client navigation), and
// renders the contributed component with `{ data, ctx: { plugins } }`.
export const Route = createFileRoute("/platform/")({
	loader: async () => {
		const entry = findPage(consolePages, PATH);
		if (entry === undefined) throw notFound();
		const states = await pluginStatesFn();
		if (!enabledIdSet(states).has(entry.pluginId)) throw notFound();
		const result = await platformPageDataFn({ data: PATH });
		if (result.status === "notfound") throw notFound();
		return result.data;
	},
	component: function PlatformIndexRoute() {
		const data = Route.useLoaderData();
		const { user } = rootApi.useLoaderData();
		const entry = findPage(consolePages, PATH);
		if (entry === undefined) return null;
		// ctx.plugins is the FULL discovered registry — see platform/$.
		return createElement(entry.page.component, {
			data,
			ctx: { plugins, locale: getLocale(), user },
		});
	},
});
