// @vitest-environment jsdom
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	pathname: "/",
	user: null as { name?: string; email?: string } | null,
	plugins: [] as unknown[],
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	const React = await import("react");
	return {
		...actual,
		createRootRoute: (opts: Record<string, unknown>) => ({
			options: opts,
			useLoaderData: () => state.user,
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
vi.mock("#/lib/fns.ts", () => ({ sessionFn: vi.fn(async () => null) }));
vi.mock("#/plugins.ts", () => ({
	get plugins() {
		return state.plugins;
	},
}));
vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));

import { Route } from "./__root.tsx";

type RootOpts = {
	shellComponent: (p: { children: ReactNode }) => ReactElement;
	loader: () => Promise<unknown>;
	head: () => { meta: unknown[]; links: unknown[] };
	notFoundComponent: () => ReactElement;
};
const opts = (Route as unknown as { options: RootOpts }).options;

const render = (children: ReactNode = createElement("div", { id: "child" }, "page")) =>
	renderToStaticMarkup(createElement(opts.shellComponent, { children }));

afterEach(() => {
	state.pathname = "/";
	state.user = null;
	state.plugins = [];
});

describe("root route", () => {
	it("loads the session, declares head tags and renders the not-found page", async () => {
		await expect(opts.loader()).resolves.toBeNull();
		const head = opts.head();
		expect(head.links).toEqual([{ rel: "stylesheet", href: "/styles.css" }]);
		expect(head.meta).toContainEqual({ charSet: "utf-8" });
		expect(renderToStaticMarkup(opts.notFoundComponent())).toContain("/consultations");
	});
});

describe("root document", () => {
	it("wraps app pages in the header, main and footer", () => {
		const html = render();
		expect(html).toContain("<header");
		expect(html).toContain('<main class="');
		expect(html).toContain('<div id="child">page</div>');
		expect(html).toContain("<footer");
		expect(html).toContain('href="/login"');
	});

	it("renders plugin footer blocks with and without a heading", () => {
		state.plugins = [
			{
				landingFooter: {
					blocks: [
						{ heading: "Legal", links: [{ to: "/terms", label: "Terms" }] },
						{ links: [{ to: "/status", label: "Status" }] },
					],
				},
			},
			{ landingNav: [{ to: "/nav-item", label: "Nav" }] },
			{},
		];
		const html = render();
		expect(html).toContain("Legal");
		expect(html).toContain('href="/terms"');
		expect(html).toContain("Terms");
		expect(html).toContain('href="/status"');
		expect(html).toContain("Status");
		expect(html).toContain('href="/nav-item"');
		// Only the headed block renders a heading element.
		expect(html.match(/font-semibold text-foreground/g)).toHaveLength(1);
	});

	it("shows the account menu trigger for a signed-in user", () => {
		state.user = { name: "Dra. Bia", email: "bia@ktb.test" };
		const html = render();
		expect(html).toContain("Dra. Bia");
		expect(html).not.toContain('href="/login"');
	});

	it("falls back to a placeholder initial when the user has no name", () => {
		state.user = { email: "x@ktb.test" };
		expect(render()).toContain("?");
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
});
