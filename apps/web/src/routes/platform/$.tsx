import { createElement } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { platformPageDataFn } from "#/lib/fns.ts";
import { platformPages } from "#/lib/platform-pages.ts";
import { plugins } from "#/plugins.ts";

// Generic dispatcher for /platform/<path…> console pages (P-050):
// plugins contribute `panel.pages` descriptors keyed by full path
// ("/platform" itself is the index route; anything deeper lands here).
// The splat param `_splat` carries the remainder ("patients" or
// "foo/bar"); we resolve `/platform/${_splat}` against the registry,
// 404 when no plugin owns it or its `guard` Effect denies, and render
// the contributed component with `{ data, ctx: { plugins } }`.
export const Route = createFileRoute("/platform/$")({
	loader: async ({ params }) => {
		const path = `/platform/${params._splat ?? ""}`;
		const page = platformPages.get(path);
		if (page === undefined) throw notFound();
		const result = await platformPageDataFn({ data: path });
		if (result.status === "notfound") throw notFound();
		return result.data;
	},
	component: function PlatformPageRoute() {
		const { _splat } = Route.useParams();
		const data = Route.useLoaderData();
		const page = platformPages.get(`/platform/${_splat ?? ""}`);
		if (page === undefined) return null;
		return createElement(page.component, { data, ctx: { plugins } });
	},
});
