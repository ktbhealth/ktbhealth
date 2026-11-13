import { authClient } from "@ktb/auth-better/client";
import { initClientTelemetry, instrumentRouter } from "@ktb/observability/client";
import { TooltipProvider } from "@ktbhealth/ui/components/tooltip";
import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRoute,
	type ErrorComponentProps,
	HeadContent,
	Link,
	Scripts,
	useLocation,
	useRouter,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { SearchXIcon, TriangleAlertIcon } from "lucide-react";
import { createElement, useEffect, type ReactNode } from "react";
import * as m from "#/paraglide/messages.js";
import { getLocale, locales } from "#/paraglide/runtime.js";
import { changeLocale, localeName, pluginFooterNote, pluginNavLabel } from "#/lib/i18n.ts";
import {
	collectChrome,
	enabledIdSet,
	enabledPlugins,
	KNOWN_CHROME_REGIONS,
	warnUnknownChromeRegions,
} from "#/lib/registry.ts";
import { sessionFn, pluginStatesFn } from "#/lib/fns.ts";
import { plugins } from "#/plugins.ts";
import type { ChromeContribution, ChromeProps } from "@ktb/kernel";
import appCss from "../styles.css?url";

// Chrome regions (P-060): this shell declares the app.* slots; plugins
// fill them via `chrome` contributions. The dev warning uses the union
// of all shell regions so console.* contributions aren't false positives.
if (import.meta.env.DEV) warnUnknownChromeRegions(plugins, KNOWN_CHROME_REGIONS);

export const Route = createRootRoute({
	// Session user + enabled plugin ids (P-058) — chrome/landing/panel
	// contributions are filtered by the enabled set before render.
	loader: async () => ({
		user: await sessionFn(),
		pluginStates: await pluginStatesFn(),
	}),
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: m.meta_title() },
			{ name: "description", content: m.meta_description() },
			{ name: "robots", content: "index, follow" },
			{ property: "og:type", content: "website" },
			{ property: "og:title", content: m.meta_title() },
			{ property: "og:description", content: m.meta_description() },
			{ name: "twitter:card", content: "summary" },
			{ name: "twitter:title", content: m.meta_title() },
			{ name: "twitter:description", content: m.meta_description() },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: RootDocument,
	errorComponent: RootError,
	notFoundComponent: () => (
		<div className="py-24 text-center">
			<SearchXIcon className="mx-auto size-12 text-muted-foreground" />
			<h1 className="mt-4 text-2xl font-bold tracking-tight">{m.notfound_title()}</h1>
			<p className="mt-1 text-sm text-muted-foreground">{m.notfound_body()}</p>
			<Link
				to="/consultations"
				className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
			>
				{m.notfound_cta()}
			</Link>
		</div>
	),
});

/**
 * Root error boundary — friendly localized message, never a stack trace.
 * `reset` re-runs the failed loader; the link offers a way out when the
 * failure is permanent.
 */
function RootError({ reset }: ErrorComponentProps) {
	return (
		<div className="py-24 text-center">
			<TriangleAlertIcon className="mx-auto size-12 text-muted-foreground" />
			<h1 className="mt-4 text-2xl font-bold tracking-tight">{m.error_title()}</h1>
			<p className="mt-1 text-sm text-muted-foreground">{m.error_body()}</p>
			<div className="mt-6 flex items-center justify-center gap-3">
				<button
					type="button"
					onClick={reset}
					className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
				>
					{m.error_retry()}
				</button>
				<Link
					to="/consultations"
					className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
				>
					{m.notfound_cta()}
				</Link>
			</div>
		</div>
	);
}

const NAV_LINK =
	"rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground";
const NAV_ACTIVE = "bg-muted text-foreground";

/**
 * Browser telemetry bootstrap (P-099): instruments fetch (injects
 * traceparent/request-id, records request timings), window errors and
 * router navigations, and batches events to /api/telemetry. Runs once
 * per document; `initClientTelemetry` is idempotent across HMR.
 */
function TelemetryInit() {
	const router = useRouter();
	useEffect(() => {
		initClientTelemetry({ endpoint: "/api/telemetry" });
		// RouterCore's subscribe is generic/overloaded — the structural
		// InstrumentableRouter view only needs the two events we read.
		instrumentRouter(router as unknown as Parameters<typeof instrumentRouter>[0]);
	}, [router]);
	return null;
}

function RootDocument({ children }: { children: React.ReactNode }) {
	const { user, pluginStates } = Route.useLoaderData();
	const pathname = useLocation({ select: (l) => l.pathname });
	// /platform is a system console, not an app page — it owns the whole
	// viewport (own chrome) so the marketing header/footer and the
	// max-w-6xl column don't wrap it.
	const isConsole = pathname === "/platform" || pathname.startsWith("/platform/");
	// Enabled-state filter (P-058): disabled plugins contribute nothing
	// to any chrome region.
	const visiblePlugins = enabledPlugins(plugins, enabledIdSet(pluginStates));
	// Chrome regions (P-060): the shell owns the slots; plugins fill
	// them via `chrome` contributions filtered by `when` + pathname.
	const chromeProps: ChromeProps = {
		user,
		locale: getLocale(),
		plugins: visiblePlugins,
		locales,
		localeName,
		setLocale: changeLocale,
		labels: {
			signIn: m.nav_sign_in(),
			signOut: m.nav_sign_out(),
			newConsultation: m.nav_new_consultation(),
			langMenu: m.lang_menu_label(),
		},
		signOut: async () => {
			await authClient.signOut();
			window.location.assign("/");
		},
	};
	const entries = (region: string) => collectChrome(visiblePlugins, region, pathname);
	const renderEntry = (entry: ChromeContribution): ReactNode => {
		const { content } = entry;
		switch (content.kind) {
			case "link":
				return (
					<Link
						key={entry.id}
						to={content.to}
						className={NAV_LINK}
						activeProps={{ className: `${NAV_LINK} ${NAV_ACTIVE}` }}
					>
						{pluginNavLabel(content.to, content.label)}
					</Link>
				);
			case "component":
				return createElement(content.component, { key: entry.id, ...chromeProps });
			default:
				// sidebarItem/headerAction/footerBlock/note belong to other
				// shells or footer regions — never rendered in the header.
				return null;
		}
	};
	const brand = entries("app.header.brand").map(renderEntry);
	const nav = entries("app.header.nav").map(renderEntry);
	const actions = entries("app.header.actions").map(renderEntry);
	const session = entries("app.header.session").map(renderEntry);
	const footerBlocks = entries("app.footer.blocks").flatMap((entry) =>
		entry.content.kind === "footerBlock" ? [entry.content.block] : [],
	);
	const footerNotes = entries("app.footer.note").flatMap((entry) =>
		entry.content.kind === "note"
			? [<div key={entry.id}>{pluginFooterNote(entry.content.key, entry.content.fallback)}</div>]
			: [],
	);
	return (
		<html lang={getLocale()}>
			<head>
				<HeadContent />
			</head>
			<body className="flex min-h-screen flex-col bg-background text-foreground antialiased">
				<TooltipProvider>
					<TelemetryInit />
					{isConsole ? (
						children
					) : (
						<>
							<header className="sticky top-0 z-40 border-b border-border bg-background">
								<nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
									{brand}
									<div className="flex items-center gap-1.5">
										{nav}
										{actions}
										{session}
									</div>
								</nav>
							</header>
							<main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
							<footer className="mx-auto max-w-6xl px-6 pb-8 text-xs text-muted-foreground">
								{footerBlocks.length > 0 ? (
									<div className="mb-4 flex flex-wrap gap-x-10 gap-y-4">
										{footerBlocks.map((block, i) => (
											<div key={block.heading ?? i}>
												{block.heading ? (
													<div className="font-semibold text-foreground">{block.heading}</div>
												) : null}
												<ul className="mt-1 space-y-1">
													{block.links.map((link) => (
														<li key={link.to}>
															<Link to={link.to} className="transition hover:text-foreground">
																{link.label}
															</Link>
														</li>
													))}
												</ul>
											</div>
										))}
									</div>
								) : null}
								{footerNotes}
							</footer>
							<TanStackDevtools
								config={{ position: "bottom-right" }}
								plugins={[
									{
										name: "Tanstack Router",
										render: <TanStackRouterDevtoolsPanel />,
									},
								]}
							/>
						</>
					)}
				</TooltipProvider>
				<Scripts />
			</body>
		</html>
	);
}
