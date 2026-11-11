import { createElement } from "react";
import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";

import { appPageDataFn, pluginStatesFn } from "#/lib/fns.ts";
import { appPages, enabledIdSet, enabledPlugins } from "#/lib/registry.ts";
import { plugins } from "#/plugins.ts";
import { getLocale } from "#/paraglide/runtime.js";

const rootApi = getRouteApi("__root__");

// Generic dispatcher for app-shell pages contributed via `pages`
// (P-059): plugins declare descriptors keyed by absolute path
// ("/about", "/status", …); this root splat catches every path the
// static file routes don't claim (TanStack ranks literals above
// splats, so /login, /consultations etc. keep winning) and resolves
// `/${_splat}` against the app-context registry. Unknown paths 404
// exactly like before; a disabled owning plugin or a `guard` denial
// 404s the same way. App pages may be PUBLIC — `appPageDataFn` runs
// the loader Effect without a bound Principal when nobody is signed
// in, so page authors guard/authz inside their Effects as usual.
// `ctx.plugins` is the enabled-filtered client registry (P-058),
// `ctx.user` the session user or null.
export const Route = createFileRoute("/$")({
	loader: async ({ params }) => {
		const path = `/${params._splat ?? ""}`;
		const entry = appPages.get(path);
		if (entry === undefined) throw notFound();
		// Client-side early gate: a disabled plugin's page 404s before the
		// server fn round-trip (appPageDataFn re-checks server-side).
		const states = await pluginStatesFn();
		if (!enabledIdSet(states).has(entry.pluginId)) throw notFound();
		const result = await appPageDataFn({ data: path });
		if (result.status === "notfound") throw notFound();
		return { data: result.data, pluginStates: states };
	},
	component: function AppPageRoute() {
		const { _splat } = Route.useParams();
		const { data, pluginStates } = Route.useLoaderData();
		const { user } = rootApi.useLoaderData();
		const entry = appPages.get(`/${_splat ?? ""}`);
		if (entry === undefined) return null;
		return createElement(entry.page.component, {
			data,
			ctx: {
				plugins: enabledPlugins(plugins, enabledIdSet(pluginStates)),
				locale: getLocale(),
				user,
			},
		});
	},
});
