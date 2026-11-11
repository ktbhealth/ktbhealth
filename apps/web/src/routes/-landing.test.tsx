// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	plugins: [] as unknown[],
	audiencePlugins: [] as unknown[],
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	const React = await import("react");
	return {
		...actual,
		createFileRoute: () => (opts: Record<string, unknown>) => ({
			options: opts,
			useSearch: () => ({ audience: "doctors" }),
		}),
		useNavigate: () => vi.fn(),
		useSearch: (opts: { strict: false; select: (s: Record<string, unknown>) => unknown }) =>
			opts.select({ audience: "doctors" }),
		Link: (props: Record<string, unknown>) => {
			const { to, children, ...rest } = props;
			return React.createElement("a", { href: to as string, ...rest }, children as ReactNode);
		},
	};
});

// The audience plugin is the only landing contribution — the host test
// wires the real plugin object without loading the whole registry.
vi.mock("#/plugins.ts", async () => {
	const { plugins } = await import("@ktb/audience");
	state.audiencePlugins = [...plugins];
	return {
		get plugins() {
			return state.plugins;
		},
	};
});
vi.mock("#/paraglide/runtime.js", () => ({ getLocale: () => "en" }));

// Base UI's Select needs pointer/portal plumbing jsdom lacks.
vi.mock("@ktbhealth/ui/components/select", () => ({
	Select: ({ children }: { children: ReactNode }) => createElement("div", null, children),
	SelectTrigger: ({ children, ...props }: { children: ReactNode }) =>
		createElement("button", props, children),
	SelectValue: () => null,
	SelectContent: ({ children }: { children: ReactNode }) => createElement("ul", null, children),
	SelectItem: ({ children, value }: { children: ReactNode; value: string }) =>
		createElement("li", { "data-value": value }, children),
}));

import { Route } from "./index.tsx";

type Opts = {
	component: unknown;
	validateSearch: (s: Record<string, unknown>) => { audience: string };
};
const opts = (Route as unknown as { options: Opts }).options;
const Landing = opts.component as () => ReactNode;

afterEach(() => {
	cleanup();
	state.plugins = [];
});

describe("landing route", () => {
	it("validates ?audience with doctors as the fallback", () => {
		expect(opts.validateSearch({ audience: "patients" })).toEqual({ audience: "patients" });
		expect(opts.validateSearch({ audience: "x" })).toEqual({ audience: "doctors" });
		expect(opts.validateSearch({})).toEqual({ audience: "doctors" });
	});

	it("renders the audience plugin's landing page", () => {
		state.plugins = state.audiencePlugins;
		render(createElement(Landing));
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
			"The doctor decides. KTB Health records.",
		);
	});

	it("renders the fallback when no landing plugin is registered", () => {
		state.plugins = [];
		render(createElement(Landing));
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("KTB Health");
		expect(screen.getByText("Consultations").closest("a")?.getAttribute("href")).toBe(
			"/consultations",
		);
	});
});
