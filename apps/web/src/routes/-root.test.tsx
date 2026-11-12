// @vitest-environment jsdom
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	pathname: "/",
	user: null as { name?: string; email?: string } | null,
	pluginStates: null as { enabled: string[] } | null,
	enabledIds: [] as string[],
	chromeExtra: [] as {
		id: string;
		region: string;
		content: Record<string, unknown>;
	}[],
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	const React = await import("react");
	return {
		...actual,
		createRootRoute: (opts: Record<string, unknown>) => ({
			options: opts,
			useLoaderData: () => ({
				user: state.user,
				pluginStates: state.pluginStates ?? { enabled: state.enabledIds },
			}),
		}),
		useLocation: (opts?: { select?: (l: { pathname: string }) => unknown }) => {
			const loc = { pathname: state.pathname };
			return opts?.select ? opts.select(loc) : loc;
		},
		HeadContent: () => null,
		Scripts: () => null,
		Link: (props: Record<string, unknown>) => {
			const { to, children, activeProps: _a, ...rest } = props;
			return React.createElement("a", { href: to as string, ...rest }, children as ReactNode);
		},
	};
});
vi.mock("@tanstack/react-devtools", () => ({ TanStackDevtools: () => null }));
vi.mock("@tanstack/react-router-devtools", () => ({ TanStackRouterDevtoolsPanel: () => null }));
vi.mock("@ktb/auth-better/client", () => ({ authClient: { signOut: vi.fn() } }));
vi.mock("#/lib/registry.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/registry.ts")>();
	return {
		...actual,
		// Test-only chrome injection: real plugin contributions plus any
		// entries a test queues in state.chromeExtra for the region.
		collectChrome: (
			pluginList: Parameters<typeof actual.collectChrome>[0],
			region: string,
			pathname: string,
		) => [
			...actual.collectChrome(pluginList, region, pathname),
			...state.chromeExtra.filter((entry) => entry.region === region),
		],
	};
});
vi.mock("#/lib/fns.ts", () => ({
	sessionFn: vi.fn(async () => null),
	pluginStatesFn: vi.fn(async () => ({ enabled: [] })),
}));
vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));

import { plugins } from "#/plugins.ts";
import { Route } from "./__root.tsx";

// Populated after the registry import resolves — the react-router mock
// reads it lazily inside useLoaderData (importing #/plugins.ts inside
// the mock factory would deadlock on the circular client manifests).
state.enabledIds = plugins.map((p) => p.id);

type RootOpts = {
	shellComponent: (p: { children: ReactNode }) => ReactElement;
	loader: () => Promise<unknown>;
	head: () => { meta: unknown[]; links: unknown[] };
	errorComponent: (p: { error: Error; reset: () => void }) => ReactElement;
	notFoundComponent: () => ReactElement;
};
const opts = (Route as unknown as { options: RootOpts }).options;

const render = (children: ReactNode = createElement("div", { id: "child" }, "page")) =>
	renderToStaticMarkup(createElement(opts.shellComponent, { children }));

afterEach(() => {
	state.pathname = "/";
	state.user = null;
	state.pluginStates = null;
	state.chromeExtra = [];
});

describe("root route", () => {
	it("loads the session and enabled plugin ids, declares head tags and renders the not-found page", async () => {
		await expect(opts.loader()).resolves.toEqual({
			user: null,
			pluginStates: { enabled: [] },
		});
		const head = opts.head();
		expect(head.links).toEqual([{ rel: "stylesheet", href: "/styles.css" }]);
		expect(head.meta).toContainEqual({ charSet: "utf-8" });
		expect(head.meta).toContainEqual({
			name: "description",
			content: expect.stringContaining("KTB Health"),
		});
		expect(head.meta).toContainEqual({ property: "og:type", content: "website" });
		expect(renderToStaticMarkup(opts.notFoundComponent())).toContain("/consultations");
	});

	it("renders a friendly error page without the stack trace", () => {
		const reset = vi.fn();
		const html = renderToStaticMarkup(opts.errorComponent({ error: new Error("boom"), reset }));
		expect(html).toContain("Something went wrong");
		expect(html).toContain("Try again");
		expect(html).toContain("/consultations");
		expect(html).not.toContain("boom");
	});
});

describe("root document", () => {
	it("wraps app pages in the header, main and footer", () => {
		const html = render();
		expect(html).toContain("<header");
		expect(html).toContain('<main class="');
		expect(html).toContain('<div id="child">page</div>');
		expect(html).toContain("<footer");
	});

	it("renders the plugin-owned chrome regions from the real registry", () => {
		const html = render();
		// site.chrome → app.header.brand
		expect(html).toContain("KTB Health");
		expect(html).toContain('href="/"');
		// patients/consultations chrome → app.header.nav
		expect(html).toContain('href="/patients"');
		expect(html).toContain('href="/consultations"');
		// consultations.chrome → app.header.actions (host-injected label)
		expect(html).toContain('href="/consultations/new"');
		expect(html).toContain("New consultation");
		// session.chrome → app.header.session (anonymous → sign-in link)
		expect(html).toContain('href="/login"');
		expect(html).toContain("Sign in");
	});

	it("renders the plugin footer note through the i18n mapping", () => {
		const html = render();
		expect(html).toContain("documentation tool");
	});

	it("shows the account menu instead of sign-in when a user is loaded", () => {
		state.user = { name: "Ada Lovelace", email: "ada@x.com" };
		const html = render();
		// The trigger renders the name; the email/sign-out live inside the
		// portaled dropdown content (covered by plugins/session tests).
		expect(html).toContain("Ada Lovelace");
		expect(html).not.toContain('href="/login"');
	});

	it("hides a disabled plugin's chrome contributions (P-058)", () => {
		state.pluginStates = {
			enabled: plugins.filter((p) => p.id !== "patients.chrome").map((p) => p.id),
		};
		const html = render();
		expect(html).not.toContain('href="/patients"');
		// Other plugins' chrome still renders.
		expect(html).toContain('href="/consultations"');
	});

	it("gives the /platform console the whole viewport", () => {
		for (const pathname of ["/platform", "/platform/consultations"]) {
			state.pathname = pathname;
			const html = render();
			expect(html).toContain('<div id="child">page</div>');
			expect(html).not.toContain("<header");
			expect(html).not.toContain("<footer");
		}
	});

	it("renders contributed footer blocks and skips chrome kinds that do not match the slot", () => {
		state.chromeExtra = [
			{
				id: "t.block-a",
				region: "app.footer.blocks",
				content: {
					kind: "footerBlock",
					block: {
						heading: "Resources",
						links: [{ to: "/docs", label: "Docs" }],
					},
				},
			},
			{
				id: "t.block-b",
				region: "app.footer.blocks",
				content: {
					kind: "footerBlock",
					block: { links: [{ to: "/about", label: "About" }] },
				},
			},
			// Non-footerBlock entries in the blocks region are skipped.
			{
				id: "t.blocks-note",
				region: "app.footer.blocks",
				content: { kind: "note", key: "x", fallback: "y" },
			},
			// Non-link/component entries in header regions render nothing.
			{
				id: "t.nav-note",
				region: "app.header.nav",
				content: { kind: "note", key: "x", fallback: "y" },
			},
			// Non-note entries in the footer-note region are skipped.
			{
				id: "t.foot-link",
				region: "app.footer.note",
				content: { kind: "link", to: "/x", label: "X" },
			},
		];
		const html = render();
		expect(html).toContain("Resources");
		expect(html).toContain("Docs");
		expect(html).toContain("About");
	});

	it("stays silent outside dev", async () => {
		// The dev chrome-region warning is module-level — re-import the
		// route with DEV stubbed off to cover the skipped branch.
		vi.stubEnv("DEV", false);
		vi.resetModules();
		try {
			await import("./__root.tsx");
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
