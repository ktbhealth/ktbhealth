import { createElement } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { platformPageDataFn } from "#/lib/fns.ts";
import { platformPages } from "#/lib/platform-pages.ts";
import { plugins } from "#/plugins.ts";
import { getLocale } from "#/paraglide/runtime.js";

const PATH = "/platform";

// Console landing page (P-050): the dashboard plugin contributes a
// `panel.pages` descriptor for "/platform"; this route is a generic
// dispatcher — it resolves the descriptor, 404s when absent or when
// the page's `guard` Effect denies, fetches
// the loader Effect's result via the platformPageDataFn server fn
// (isomorphic: direct on SSR, RPC on client navigation), and renders
// the contributed component with `{ data, ctx: { plugins } }`.
export const Route = createFileRoute("/platform/")({
	loader: async () => {
		const page = platformPages.get(PATH);
		if (page === undefined) throw notFound();
		const result = await platformPageDataFn({ data: PATH });
		if (result.status === "notfound") throw notFound();
		return result.data;
	},
	component: function PlatformIndexRoute() {
		const data = Route.useLoaderData();
		const page = platformPages.get(PATH);
		if (page === undefined) return null;
		return createElement(page.component, { data, ctx: { plugins, locale: getLocale() } });
	},
});
