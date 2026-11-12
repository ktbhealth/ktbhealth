import type { PageContext } from "@ktb/kernel";

import { renderMarkdown } from "../markdown.tsx";

/** Wire shape the wildcard loader returns — the published
 * `custom_pages` row. Only the rendered fields are required; the rest
 * (id, flags, timestamps) rides along unused. */
export interface CustomPageData {
	readonly path?: unknown;
	readonly title?: unknown;
	readonly content?: unknown;
}

const asPage = (data: unknown): { title: string; content: string } | null => {
	if (typeof data !== "object" || data === null) return null;
	const d = data as CustomPageData;
	if (typeof d.title !== "string" || typeof d.content !== "string") return null;
	return { title: d.title, content: d.content };
};

/**
 * `pages` component for DB-stored custom pages (T-083): every custom
 * page renders through this single component — the wildcard descriptor
 * at "/*" supplies per-path `data` from the loader. Content is the
 * markdown subset (no raw HTML); `ctx.locale` is available but the page
 * body is user-authored content, so there is no plugin copy to localize.
 */
export function CustomPageView({ data }: { data: unknown; ctx: PageContext }) {
	const page = asPage(data);
	if (page === null) return null;
	return (
		<article className="mx-auto w-full max-w-3xl">
			<h1 className="text-3xl font-bold tracking-tight">{page.title}</h1>
			<div className="mt-6">{renderMarkdown(page.content)}</div>
		</article>
	);
}
