// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	platformPageDataFn: vi.fn(),
	pages: new Map<string, { component: (p: { data: unknown; ctx: unknown }) => unknown }>(),
	loaderData: { current: undefined as unknown },
	params: { current: {} as { _splat?: string } },
}));

vi.mock("#/lib/fns.ts", () => ({ platformPageDataFn: mocks.platformPageDataFn }));
vi.mock("#/lib/platform-pages.ts", () => ({ platformPages: mocks.pages }));
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

afterEach(() => {
	cleanup();
	mocks.pages.clear();
	mocks.params.current = {};
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

	it("throws notFound when the page's guard denies", async () => {
		mocks.pages.set(path, { component: Page });
		mocks.platformPageDataFn.mockResolvedValue({ status: "notfound" });
		await expect(load()).rejects.toMatchObject({ isNotFound: true });
		expect(mocks.platformPageDataFn).toHaveBeenCalledWith({ data: path });
	});

	it("returns the loader Effect's data", async () => {
		mocks.pages.set(path, { component: Page });
		mocks.platformPageDataFn.mockResolvedValue({ status: "ok", data: { rows: 2 } });
		await expect(load()).resolves.toEqual({ rows: 2 });
	});

	it("renders nothing when the page is no longer registered", () => {
		mocks.params.current = { _splat: "patients" };
		const { container } = render(createElement(opts(route).component));
		expect(container.innerHTML).toBe("");
	});

	it("renders the contributed component with data and plugin context", () => {
		mocks.pages.set(path, { component: Page });
		mocks.params.current = { _splat: "patients" };
		mocks.loaderData.current = { rows: 2 };
		render(createElement(opts(route).component));
		expect(screen.getByTestId("page").textContent).toBe(
			'{"rows":2}|{"plugins":["plugin-a"],"locale":"en"}',
		);
	});
});

describe("/platform/$ with an empty splat", () => {
	it("resolves the bare /platform/ path in the loader and the component", async () => {
		mocks.pages.set("/platform/", { component: Page });
		mocks.platformPageDataFn.mockResolvedValue({ status: "ok", data: "d" });
		await expect(opts(SplatRoute).loader({ params: {} })).resolves.toBe("d");
		expect(mocks.platformPageDataFn).toHaveBeenCalledWith({ data: "/platform/" });
		mocks.loaderData.current = "d";
		render(createElement(opts(SplatRoute).component));
		expect(screen.getByTestId("page").textContent).toContain('"d"|');
	});
});
