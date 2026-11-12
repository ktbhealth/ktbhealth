// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	loaderData: { current: "en" as string | undefined },
	pageProps: { current: undefined as Record<string, unknown> | undefined },
}));

vi.mock("@ktb/server-fns", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@ktb/server-fns")>();
	return {
		...actual,
		// The plugin route gate is inert without a registered runtime; the
		// fake keeps the options object and a controllable useLoaderData.
		createPluginFileRoute: () => (path: string) => (opts: Record<string, unknown>) => ({
			path,
			options: opts,
			useLoaderData: () => mocks.loaderData.current,
		}),
	};
});
vi.mock("../fns.ts", () => ({ localeFn: vi.fn(async () => "pt-BR") }));
vi.mock("../views/LoginPage.tsx", () => ({
	LoginPage: (props: Record<string, unknown>) => {
		mocks.pageProps.current = props;
		return createElement("div");
	},
}));

import { Route } from "./login.tsx";

type Opts = {
	loader: () => Promise<unknown>;
	head: (ctx: { loaderData?: string }) => { meta: { title: string }[] };
	component: () => ReactElement;
};
const opts = (Route as unknown as { options: Opts }).options;

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("/login route", () => {
	it("loads the active locale through localeFn", async () => {
		await expect(opts.loader()).resolves.toBe("pt-BR");
	});

	it("sets the localized document title from loader data", () => {
		expect(opts.head({ loaderData: "pt-BR" }).meta[0]!.title).toBe("Entrar | KTB Health");
		expect(opts.head({ loaderData: "es" }).meta[0]!.title).toBe("Iniciar sesión | KTB Health");
		// Missing loader data falls back to the base locale.
		expect(opts.head({}).meta[0]!.title).toBe("Sign in | KTB Health");
	});

	it("renders LoginPage with the loader locale", () => {
		mocks.loaderData.current = "es";
		render(createElement(opts.component));
		expect(mocks.pageProps.current).toEqual({ locale: "es" });
	});
});
