import { createElement } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { platformPageDataFn } from "#/lib/fns.ts";
import { platformPages } from "#/lib/platform-pages.ts";
import { plugins } from "#/plugins.ts";

// Generic dispatcher for single-segment /platform/<name> console pages
// (P-050): plugins contribute `panel.pages` descriptors keyed by path;
// this route resolves `/platform/${param}` against the registry, 404s
// when no plugin owns it, and renders the contributed component with
// `{ data, ctx: { plugins } }`. LIMITATION: `$page` is a single path
// segment — nested console paths ("/platform/a/b") are not dispatched
// and fall through to notFound.
export const Route = createFileRoute("/platform/$page")({
	loader: async ({ params }) => {
		const path = `/platform/${params.page}`;
		const page = platformPages.get(path);
		if (page === undefined) throw notFound();
		return platformPageDataFn({ data: path });
	},
	component: function PlatformPageRoute() {
		const { page: segment } = Route.useParams();
		const data = Route.useLoaderData();
		const page = platformPages.get(`/platform/${segment}`);
		if (page === undefined) return null;
		return createElement(page.component, { data, ctx: { plugins } });
	},
});
