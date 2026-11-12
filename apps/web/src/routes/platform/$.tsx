import { createElement } from "react";
import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";

import { platformPageDataFn, pluginStatesFn } from "#/lib/fns.ts";
import { consolePages, enabledIdSet, findPage } from "#/lib/registry.ts";
import { plugins } from "#/plugins.ts";
import { getLocale } from "#/paraglide/runtime.js";

const rootApi = getRouteApi("__root__");

// Generic dispatcher for /platform/<path…> console pages (P-050):
// plugins contribute `panel.pages` descriptors keyed by full path
// ("/platform" itself is the index route; anything deeper lands here).
// The splat param `_splat` carries the remainder ("patients" or
// "foo/bar"); we resolve `/platform/${_splat}` against the registry,
// 404 when no plugin owns it, when its owner plugin is disabled (P-058)
// or when its `guard` Effect denies, and render the contributed
// component with `{ data, ctx: { plugins } }`.
export const Route = createFileRoute("/platform/$")({
	loader: async ({ params }) => {
		const path = `/platform/${params._splat ?? ""}`;
		// findPage: exact descriptors win; "/*" wildcards (DB-backed
		// pages) resolve by longest matching base.
		const entry = findPage(consolePages, path);
		if (entry === undefined) throw notFound();
		// Client-side early gate: a disabled plugin's page 404s before the
		// server fn round-trip (platformPageDataFn re-checks server-side).
		const states = await pluginStatesFn();
		if (!enabledIdSet(states).has(entry.pluginId)) throw notFound();
		const result = await platformPageDataFn({ data: path });
		if (result.status === "notfound") throw notFound();
		return result.data;
	},
	component: function PlatformPageRoute() {
		const { _splat } = Route.useParams();
		const data = Route.useLoaderData();
		const { user } = rootApi.useLoaderData();
		const entry = findPage(consolePages, `/platform/${_splat ?? ""}`);
		if (entry === undefined) return null;
		// ctx.plugins is the FULL discovered registry (P-058): the
		// /platform/plugins manager needs disabled plugins too; enabled
		// filtering already happened in the loader gate above.
		return createElement(entry.page.component, {
			data,
			ctx: { plugins, locale: getLocale(), user },
		});
	},
});
