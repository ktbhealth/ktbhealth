import type { ComponentType } from "react";
import type { VirtualRouteNode } from "@tanstack/virtual-file-routes";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";

import type { ForbiddenContributions, PluginBase } from "./core.ts";

/** One entry in a plugin's system-console sidebar. `icon` is any
 * component accepting `className` (lucide icons qualify); the host
 * shell sizes it via `[&_svg]` rules. `exact` marks index-style items
 * that must not stay active on descendant routes. */
export interface PanelSidebarItem {
	readonly to: string;
	readonly label: string;
	readonly icon?: ComponentType<{ className?: string }>;
	readonly exact?: boolean;
	/** Sidebar group label — items cluster under it in declaration
	 * (topo) order; groups order by first appearance. Defaults to a
	 * single unlabeled group. */
	readonly group?: string;
}

/** One entry in a plugin's console top-bar right side. `component` is a
 * self-contained React component (icon button, popover, badge…) rendered
 * by the shell; data reaches it via plugin-owned contexts/props the host
 * injects — plugins cannot import apps or server fns. */
export interface PanelHeaderAction {
	readonly id: string;
	/** The host injects the active UI locale — header actions are
	 * self-contained components that cannot import the host's i18n
	 * runtime, so they resolve their own copy from it. */
	readonly component: ComponentType<{ readonly locale?: string }>;
}

/**
 * Feature plugin contract. The host (apps/web) registers plugins in a
 * static list; each plugin object contributes EXACTLY ONE kind of
 * contribution — every union member below forbids the other
 * contribution keys (`?: never`), so a multi-concern plugin object is a
 * compile error. A plugin that only anchors dependency edges (e.g.
 * `platform.admin`, `platform.panel`) is a MarkerPlugin: no contribution
 * field at all. Everything is statically imported — workerd can't do
 * dynamic module loading, and static keeps 100% type safety.
 *
 * Consumers read a contribution with optional access (`p.landingNav ?? []`) —
 * forbidden keys are declared `?: never`, so `"<field>" in p` does not
 * discriminate the union.
 */

/** Host-injected context handed to `pages` page components (P-059): the
 * discovered plugin registry, so contributed pages can render
 * plugin-aware views without importing the app host, plus the active
 * UI locale so views resolve their own localized copy, plus the
 * session user when one exists (app pages may be public). */
export interface PageContext {
	readonly plugins: readonly Plugin[];
	readonly locale: string;
	readonly user?: ChromeUser | null;
}

/** Host-injected context handed to every panel page component — the
 * discovered plugin registry, so console pages can render
 * plugin-aware views without importing the app host, plus the active
 * UI locale so views resolve their own localized copy. Same payload
 * as `PageContext` (P-059 unified the two). */
export interface PanelPageContext extends PageContext {}

/** A console page contributed via `panel.pages` (P-050): the host
 * mounts a generic dispatcher at `path` under /platform, runs `loader`
 * as an Effect under the session principal (`runAs` binds Principal +
 * AuthzLive — authz stays inside the domain services), and renders
 * `component` with the result as `data`. `loader` runs on every
 * navigation, like a route loader; pages without one get `data: null`.
 * `path` is the full route path — "/platform" itself or any nested
 * "/platform/<segment>[/<segment>…]"; the host's splat route matches
 * all of them and looks the descriptor up by exact path.
 * `guard` (optional) is an Effect run server-side under the same
 * principal BEFORE `loader`; a `false` result makes the host treat the
 * page as not found — use it for feature flags / entitlement checks.
 * Hard authorization stays inside the loader/service layer.
 * `guard`/`loader` receive the request path — exact-path pages ignore
 * it; wildcard pages (see `Page.path`) need it to resolve their data. */
export interface PanelPage {
	readonly id: string;
	readonly path: string;
	readonly component: ComponentType<{ data: unknown; ctx: PanelPageContext }>;
	readonly loader?: (path: string) => Effect.Effect<unknown, unknown, unknown>;
	readonly guard?: (path: string) => Effect.Effect<boolean, unknown, unknown>;
}

/** A page contributed via `pages` (P-059): the host mounts a generic
 * splat dispatcher that resolves `path` against the registry, runs
 * `guard` then `loader` as Effects (server-side, under the session
 * principal when one exists — app pages may be public), and renders
 * `component` with the result as `data`. `path` is the full absolute
 * route path ("/about", "/platform/x", …); the host looks descriptors
 * up by exact path. `guard` (optional) runs BEFORE `loader`; a `false`
 * result or a failure makes the host treat the page as not found —
 * use it for feature flags / entitlement checks. Hard authorization
 * stays inside the loader/service layer.
 * `context` selects the shell: "console" pages dispatch under
 * /platform behind the admin gate (console chrome); "app" pages render
 * inside the marketing shell and may be public. Defaults to "console"
 * for /platform* paths and "app" otherwise — an app-context page
 * claiming a /platform* path is a contract violation (the host warns
 * and ignores it).
 * `path` may also end in "/*" to claim a whole path subtree (same
 * syntax as chrome `when` paths): exact-path descriptors always win;
 * among wildcard entries the LONGEST matching base wins, ties break by
 * plugin topo order. This is the seam runtime/DB-driven pages use —
 * one wildcard descriptor serves every path its loader resolves (e.g.
 * the custom-pages plugin's "/*" backed by a DB lookup). `guard` and
 * `loader` receive the REQUESTED path so the descriptor can resolve
 * which entity the path names; signatures taking no argument remain
 * valid (the argument is simply ignored). */
export interface Page {
	readonly id: string;
	readonly path: string;
	readonly component: ComponentType<{ data: unknown; ctx: PageContext }>;
	readonly loader?: (path: string) => Effect.Effect<unknown, unknown, unknown>;
	readonly guard?: (path: string) => Effect.Effect<boolean, unknown, unknown>;
	readonly context?: "app" | "console";
}

/** Dependency anchor only — no contribution of its own. */
export interface MarkerPlugin extends PluginBase, ForbiddenContributions<never> {}

/** Drizzle table slice composed into @ktb/db/schema. */
export interface TablesPlugin extends PluginBase, ForbiddenContributions<"tables"> {
	readonly tables: Record<string, SQLiteTable>;
}

/** Effect layers: services the plugin needs/provides at runtime.
 * Heterogeneous by design: each plugin provides its own services.
 * Type-erased to Layer.Any; the host verifies requirements at
 * ManagedRuntime composition. */
export interface ServicesPlugin extends PluginBase, ForbiddenContributions<"services"> {
	readonly services: Layer.Any;
}

/** Route subtree composed into the host's virtualRouteConfig. */
export interface RoutesPlugin extends PluginBase, ForbiddenContributions<"routes"> {
	readonly routes: readonly VirtualRouteNode[];
}

/** A link contributed to a chrome region (header nav). */
export interface LandingLink {
	readonly to: string;
	readonly label: string;
}

/** One block in a footer region: optional heading + link list. */
export interface LandingFooterBlock {
	readonly heading?: string;
	readonly links: ReadonlyArray<LandingLink>;
}

/** Declarative per-page visibility for a chrome contribution — data,
 * not functions, so the registries stay serializable-clean and rules
 * stay unit-testable. `paths`/`exceptPaths` entries match the current
 * pathname exactly or as a `prefix/*` subtree (the bare prefix itself
 * counts); `exceptPaths` wins over `paths`. Absent `paths` means "every
 * page". */
export interface ChromeWhen {
	readonly paths?: readonly string[];
	readonly exceptPaths?: readonly string[];
}

/** Session user shape handed to chrome components — structurally
 * compatible with `SessionUser` (@ktb/auth) without a kernel→auth dep. */
export interface ChromeUser {
	readonly id: string;
	readonly email: string;
	readonly name?: string | null;
}

/** Everything the host injects into a chrome `component` contribution —
 * plugins cannot import the host's i18n runtime or session helpers, so
 * the shell resolves locale, user, labels and sign-out and hands them
 * down. `labels` carries the host-localized strings plugins need
 * (documented keys: `signIn`, `signOut`, `newConsultation`, `langMenu`);
 * plugins fall back to their own English literal per key. `signOut`
 * performs the host's sign-out flow (plugins may not import auth
 * adapters). */
export interface ChromeProps {
	readonly user: ChromeUser | null;
	readonly locale: string;
	readonly plugins: readonly Plugin[];
	readonly locales: readonly string[];
	readonly localeName: (locale: string) => string;
	readonly setLocale: (locale: string) => void;
	readonly labels: Readonly<Record<string, string>>;
	readonly signOut: () => Promise<void>;
}

/** What a chrome contribution renders. `link` is a router link (nav
 * regions), `component` an arbitrary widget, `sidebarItem`/`headerAction`
 * the console chrome payloads (reusing the panel types), `footerBlock`
 * a footer link block, `note` a localized footer note keyed for the
 * host's i18n mapping. */
export type ChromeContent =
	| { readonly kind: "link"; readonly to: string; readonly label: string }
	| { readonly kind: "component"; readonly component: ComponentType<ChromeProps> }
	| { readonly kind: "sidebarItem"; readonly item: PanelSidebarItem }
	| {
			readonly kind: "headerAction";
			readonly id: string;
			readonly component: ComponentType<{ readonly locale?: string }>;
	  }
	| { readonly kind: "footerBlock"; readonly block: LandingFooterBlock }
	| { readonly kind: "note"; readonly key: string; readonly fallback: string };

/** One slot filled in a shell-owned region. `region` names the slot
 * (e.g. "app.header.nav", "console.sidebar") — the host declares the
 * valid set per shell; unknown regions are skipped with a dev warning.
 * `order` sorts within the region (ascending, `order ?? Infinity`),
 * ties break by plugin topo order then array index; `when` filters by
 * pathname at render time. */
export interface ChromeContribution {
	readonly id: string;
	readonly region: string;
	readonly order?: number;
	readonly when?: ChromeWhen;
	readonly content: ChromeContent;
}

/** Shell chrome slots: ordered, per-page-filtered contributions into
 * named regions owned by the host shells (app marketing chrome,
 * /platform console). Replaces the retired landingNav/landingFooter
 * fields and the sidebar/headerActions halves of `panel`. */
export interface ChromePlugin extends PluginBase, ForbiddenContributions<"chrome"> {
	readonly chrome: ReadonlyArray<ChromeContribution>;
}

/** Props the host injects into a contributed landing page — the active
 * UI locale so the page resolves its own localized copy (plugins cannot
 * import the host's i18n runtime). */
export interface LandingPageProps {
	readonly locale?: string;
}

/** Whole-page landing slot: the host renders the first landing plugin's
 * `page` at "/" in topo order instead of the built-in landing. At most
 * one landing plugin should exist — additional ones are ignored. */
export interface LandingPlugin extends PluginBase, ForbiddenContributions<"landing"> {
	readonly landing: {
		readonly page: ComponentType<LandingPageProps>;
	};
}

/** System-console (panel) contribution: pages the host dispatches
 * under /platform — each `path` gets a generic route that runs `loader`
 * and renders `component`. Paths must be unique across plugins. Console
 * chrome (sidebar items, header actions) is contributed via `chrome`
 * into the "console.*" regions instead. */
export interface PanelPlugin extends PluginBase, ForbiddenContributions<"panel"> {
	readonly panel: {
		/** Console pages the host dispatches under /platform — each
		 * `path` gets a generic route that runs `loader` and renders
		 * `component`. Paths must be unique across plugins. */
		readonly pages?: ReadonlyArray<PanelPage>;
	};
}

/** Generic page contribution (P-059): plugin-declared pages at
 * arbitrary absolute paths, dispatched by the host's splat routes —
 * the generalization of `panel.pages` beyond /platform. `context`
 * picks the shell (default derived from the path); paths must be
 * unique across ALL page contributions (panel.pages and pages
 * together) — first in topo order wins, later duplicates are dropped
 * with a dev warning. This is also the seam runtime/DB-driven pages
 * (e.g. a future custom-pages plugin) plug into. */
export interface PagesPlugin extends PluginBase, ForbiddenContributions<"pages"> {
	readonly pages: ReadonlyArray<Page>;
}

export type Plugin =
	| MarkerPlugin
	| TablesPlugin
	| ServicesPlugin
	| RoutesPlugin
	| LandingPlugin
	| ChromePlugin
	| PanelPlugin
	| PagesPlugin;
