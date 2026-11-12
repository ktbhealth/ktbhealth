import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import type { ChromeProps } from "@ktb/kernel";

import { navPagesFn, type NavPageWire } from "./fns.ts";

const NAV_LINK =
	"rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground";

/**
 * App-header nav contributed to `app.header.nav` (P-060/T-083): renders
 * one link per published `custom_pages` row flagged `showInNav`, fetched
 * through the plugin's public server fn — nav membership is data, not
 * code. Renders nothing while loading or when the list is empty (the
 * chrome slot collapses cleanly). The whole contribution is already
 * filtered out when the plugin is disabled; the fn re-checks
 * `pages.render` enabled-state server-side as a backstop.
 */
export function CustomNavLinks(_props: ChromeProps) {
	const [pages, setPages] = useState<readonly NavPageWire[]>([]);
	useEffect(() => {
		let cancelled = false;
		navPagesFn()
			.then((rows) => {
				if (!cancelled) setPages(rows);
			})
			.catch(() => {
				if (!cancelled) setPages([]);
			});
		return () => {
			cancelled = true;
		};
	}, []);
	if (pages.length === 0) return null;
	return (
		<>
			{pages.map((page) => (
				// Custom paths aren't in the typed route tree — the cast keeps
				// the link type-safe while the splat dispatcher resolves the
				// real path at runtime.
				<Link key={page.path} to={page.path as "/"} className={NAV_LINK}>
					{page.title}
				</Link>
			))}
		</>
	);
}
