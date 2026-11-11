// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	platformPageDataFn: vi.fn(),
	pluginStatesFn: vi.fn(),
	pages: new Map<
		string,
		{ page: { component: (p: { data: unknown; ctx: unknown }) => unknown }; pluginId: string }
	>(),
	loaderData: { current: undefined as unknown },
	params: { current: {} as { _splat?: string } },
	rootData: { current: { user: null as unknown } },
}));

vi.mock("#/lib/fns.ts", () => ({
	platformPageDataFn: mocks.platformPageDataFn,
	pluginStatesFn: mocks.pluginStatesFn,
}));
vi.mock("@ktb/app-host/client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@ktb/app-host/client")>();
	return { ...actual, consolePages: mocks.pages };
});
vi.mock("#/plugins.ts", () => ({ plugins: ["plugin-a"] }));
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

import { Route as SplatRoute } from "./$.tsx";
import { Route as IndexRoute } from "./index.tsx";

type Opts = {
	loader: (a?: { params: { _splat?: string } }) => Promise<unknown>;
	component: () => ReactElement | null;
};
const opts = (r: unknown) => (r as { options: Opts }).options;

const Page = ({ data, ctx }: { data: unknown; ctx: unknown }) =>
	createElement("p", { "data-testid": "page" }, `${JSON.stringify(data)}|${JSON.stringify(ctx)}`);

const entry = (path: string) => {
	mocks.pages.set(path, { page: { component: Page }, pluginId: "plugin-a" });
	mocks.pluginStatesFn.mockResolvedValue({ enabled: ["plugin-a"] });
};

afterEach(() => {
	cleanup();
	mocks.pages.clear();
	mocks.params.current = {};
	mocks.rootData.current = { user: null };
	vi.clearAllMocks();
});

describe.each([
	["/platform (index)", IndexRoute, "/platform", () => opts(IndexRoute).loader()],
	[
		"/platform/$ (splat)",
		SplatRoute,
		"/platform/patients",
		() => opts(SplatRoute).loader({ params: { _splat: "patients" } }),
	],
])("%s dispatcher", (_name, route, path, load) => {
	it("throws notFound when no plugin owns the page", async () => {
		await expect(load()).rejects.toMatchObject({ isNotFound: true });
		expect(mocks.platformPageDataFn).not.toHaveBeenCalled();
	});

	it("throws notFound when the owning plugin is disabled (P-058)", async () => {
		entry(path);
		mocks.pluginStatesFn.mockResolvedValue({ enabled: [] });
		await expect(load()).rejects.toMatchObject({ isNotFound: true });
		// The client-side gate short-circuits before the server fn.
		expect(mocks.platformPageDataFn).not.toHaveBeenCalled();
	});

	it("throws notFound when the page's guard denies", async () => {
		entry(path);
		mocks.platformPageDataFn.mockResolvedValue({ status: "notfound" });
		await expect(load()).rejects.toMatchObject({ isNotFound: true });
		expect(mocks.platformPageDataFn).toHaveBeenCalledWith({ data: path });
	});

	it("returns the loader Effect's data", async () => {
		entry(path);
		mocks.platformPageDataFn.mockResolvedValue({ status: "ok", data: { rows: 2 } });
		await expect(load()).resolves.toEqual({ rows: 2 });
	});

	it("renders nothing when the page is no longer registered", () => {
		mocks.params.current = { _splat: "patients" };
		const { container } = render(createElement(opts(route).component));
		expect(container.innerHTML).toBe("");
	});

	it("renders the contributed component with data and plugin context", () => {
		entry(path);
		mocks.params.current = { _splat: "patients" };
		mocks.loaderData.current = { rows: 2 };
		render(createElement(opts(route).component));
		expect(screen.getByTestId("page").textContent).toBe(
			'{"rows":2}|{"plugins":["plugin-a"],"locale":"en","user":null}',
		);
	});
});

describe("/platform/$ with an empty splat", () => {
	it("resolves the bare /platform/ path in the loader and the component", async () => {
		entry("/platform/");
		mocks.platformPageDataFn.mockResolvedValue({ status: "ok", data: "d" });
		await expect(opts(SplatRoute).loader({ params: {} })).resolves.toBe("d");
		expect(mocks.platformPageDataFn).toHaveBeenCalledWith({ data: "/platform/" });
		mocks.loaderData.current = "d";
		render(createElement(opts(SplatRoute).component));
		expect(screen.getByTestId("page").textContent).toContain('"d"|');
	});
});
