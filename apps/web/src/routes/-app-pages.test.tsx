// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	appPageDataFn: vi.fn(),
	pluginStatesFn: vi.fn(),
	pages: new Map<
		string,
		{
			page: { component: (p: { data: unknown; ctx: unknown }) => unknown };
			pluginId: string;
			context?: string;
		}
	>(),
	loaderData: { current: undefined as unknown },
	params: { current: {} as { _splat?: string } },
	rootData: { current: { user: null as unknown, pluginStates: { enabled: [] as string[] } } },
}));

vi.mock("#/lib/fns.ts", () => ({
	appPageDataFn: mocks.appPageDataFn,
	pluginStatesFn: mocks.pluginStatesFn,
}));
vi.mock("@ktb/app-host/client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@ktb/app-host/client")>();
	return { ...actual, appPages: mocks.pages };
});
vi.mock("#/plugins.ts", () => ({ plugins: [{ id: "plugin-a" }] }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		createFileRoute: () => (opts: Record<string, unknown>) => ({
			options: opts,
			useLoaderData: () => mocks.loaderData.current,
			useParams: () => mocks.params.current,
		}),
		getRouteApi: () => ({ useLoaderData: () => mocks.rootData.current }),
	};
});

import { Route } from "./$.tsx";

type Opts = {
	loader: (a?: { params: { _splat?: string } }) => Promise<unknown>;
	component: () => ReactElement | null;
};
const opts = (r: unknown) => (r as { options: Opts }).options;

const Page = ({ data, ctx }: { data: unknown; ctx: unknown }) =>
	createElement("p", { "data-testid": "page" }, `${JSON.stringify(data)}|${JSON.stringify(ctx)}`);

const entry = (path: string, pluginId = "plugin-a") => {
	mocks.pages.set(path, { page: { component: Page }, pluginId, context: "app" });
	mocks.pluginStatesFn.mockResolvedValue({ enabled: [pluginId] });
};

afterEach(() => {
	cleanup();
	mocks.pages.clear();
	mocks.params.current = {};
	mocks.rootData.current = { user: null, pluginStates: { enabled: [] } };
	vi.clearAllMocks();
});

describe("/$ app page dispatcher (P-059)", () => {
	it("throws notFound when no plugin owns the path", async () => {
		await expect(opts(Route).loader({ params: { _splat: "nope" } })).rejects.toMatchObject({
			isNotFound: true,
		});
		expect(mocks.appPageDataFn).not.toHaveBeenCalled();
	});

	it("throws notFound when the owning plugin is disabled (P-058)", async () => {
		entry("/about");
		mocks.pluginStatesFn.mockResolvedValue({ enabled: [] });
		await expect(opts(Route).loader({ params: { _splat: "about" } })).rejects.toMatchObject({
			isNotFound: true,
		});
		expect(mocks.appPageDataFn).not.toHaveBeenCalled();
	});

	it("throws notFound when the page's guard denies", async () => {
		entry("/about");
		mocks.appPageDataFn.mockResolvedValue({ status: "notfound" });
		await expect(opts(Route).loader({ params: { _splat: "about" } })).rejects.toMatchObject({
			isNotFound: true,
		});
		expect(mocks.appPageDataFn).toHaveBeenCalledWith({ data: "/about" });
	});

	it("returns the loader Effect's data", async () => {
		entry("/about");
		mocks.appPageDataFn.mockResolvedValue({ status: "ok", data: { rows: 2 } });
		await expect(opts(Route).loader({ params: { _splat: "about" } })).resolves.toEqual({
			data: { rows: 2 },
			pluginStates: { enabled: ["plugin-a"] },
		});
	});

	it("resolves nested splat paths against the registry", async () => {
		entry("/docs/guide");
		mocks.appPageDataFn.mockResolvedValue({ status: "ok", data: null });
		await opts(Route).loader({ params: { _splat: "docs/guide" } });
		expect(mocks.appPageDataFn).toHaveBeenCalledWith({ data: "/docs/guide" });
	});

	it("404s an empty splat (the index route owns /)", async () => {
		await expect(opts(Route).loader({ params: {} })).rejects.toMatchObject({
			isNotFound: true,
		});
	});

	it("renders nothing when the path resolves no page", () => {
		mocks.params.current = {};
		mocks.loaderData.current = { data: null, pluginStates: { enabled: [] } };
		const { container } = render(createElement(opts(Route).component));
		expect(container.innerHTML).toBe("");
	});

	it("renders the contributed component with data, enabled plugins, locale and user", () => {
		entry("/about");
		mocks.params.current = { _splat: "about" };
		mocks.loaderData.current = {
			data: { rows: 2 },
			pluginStates: { enabled: ["plugin-a"] },
		};
		mocks.rootData.current = {
			user: { id: "u1", email: "a@x.com", name: "A" },
			pluginStates: { enabled: ["plugin-a"] },
		};
		render(createElement(opts(Route).component));
		expect(screen.getByTestId("page").textContent).toBe(
			'{"rows":2}|{"plugins":[{"id":"plugin-a"}],"locale":"en","user":{"id":"u1","email":"a@x.com","name":"A"}}',
		);
	});
});
