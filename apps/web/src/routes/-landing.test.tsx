// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ search: { persona: "doctors" } as Record<string, unknown> }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	const React = await import("react");
	return {
		...actual,
		createFileRoute: () => (opts: Record<string, unknown>) => ({
			options: opts,
			useSearch: () => state.search,
		}),
		Link: (props: Record<string, unknown>) => {
			const { to, children, ...rest } = props;
			return React.createElement("a", { href: to as string, ...rest }, children as ReactNode);
		},
	};
});
vi.mock("#/plugins.ts", () => ({ plugins: [] }));

import { DEFAULT_DOCS_URL } from "#/lib/persona.ts";
import { Home, Route } from "./index.tsx";

type Opts = {
	component: unknown;
	validateSearch: (s: Record<string, unknown>) => { persona: string };
};
const opts = (Route as unknown as { options: Opts }).options;

afterEach(() => {
	cleanup();
	state.search = { persona: "doctors" };
});

const renderAs = (persona: string) => {
	state.search = opts.validateSearch({ persona });
	render(createElement(Home));
};
const heading = () => screen.getByRole("heading", { level: 1 }).textContent;

describe("landing page", () => {
	it("uses the built-in Home and validates ?persona", () => {
		expect(opts.component).toBe(Home);
		expect(opts.validateSearch({ persona: "patients" })).toEqual({ persona: "patients" });
		expect(opts.validateSearch({})).toEqual({ persona: "doctors" });
	});

	it("doctors: the pitch line, the app CTAs and the shared story", () => {
		renderAs("doctors");
		expect(heading()).toBe("The doctor decides. KTB Health records.");
		expect(screen.getByText("Start consultation").closest("a")?.getAttribute("href")).toBe(
			"/consultations/new",
		);
		expect(screen.getByText("View consultations").closest("a")?.getAttribute("href")).toBe(
			"/consultations",
		);
		// sourced problem data
		expect(screen.getByText("27%")).toBeTruthy();
		expect(screen.getByText("49%")).toBeTruthy();
		expect(screen.getByText(/Annals of Internal Medicine, 2016/)).toBeTruthy();
		// four-step flow, never-does section and closing line
		for (const step of ["Listens", "Transcribes", "Structures", "The doctor reviews"]) {
			expect(screen.getByText(step)).toBeTruthy();
		}
		expect(screen.getByText("Never makes a diagnosis")).toBeTruthy();
		expect(screen.getByText("Nothing enters the record without a signature.")).toBeTruthy();
		expect(screen.getByText("Always documentation. Never decision.")).toBeTruthy();
		// for-you section links to the doctors docs
		expect(screen.getByText(/For you · Doctors/)).toBeTruthy();
		expect(
			screen.getAllByText("Read the docs").map((el) => el.closest("a")?.getAttribute("href")),
		).toEqual([`${DEFAULT_DOCS_URL}/en/docs/doctors/getting-started`]);
	});

	it.each([
		[
			"patients",
			"Your doctor looks at you. KTB Health records.",
			"Your data, your consent",
			"patients/what-to-expect",
		],
		[
			"developers",
			"Clinical documentation, built to plug in.",
			"Ports, adapters and plugins",
			"developers/tutorials/getting-started",
		],
		[
			"business",
			"Less paperwork. More time with patients.",
			"Documentation, never decision",
			"business/positioning",
		],
	])("%s: own hero, for-you points and docs links", (persona, title, forYou, docsPath) => {
		renderAs(persona);
		expect(heading()).toBe(title);
		expect(screen.getByRole("heading", { name: forYou })).toBeTruthy();
		// no app CTAs: docs + "how it works" instead
		expect(screen.queryByText("Start consultation")).toBeNull();
		const how = screen.getAllByText("How it works").find((el) => el.closest("a"));
		expect(how?.closest("a")?.getAttribute("href")).toBe("#how");
		const docs = screen
			.getAllByText("Read the docs")
			.map((el) => el.closest("a")?.getAttribute("href"));
		expect(docs).toEqual([
			`${DEFAULT_DOCS_URL}/en/docs/${docsPath}`,
			`${DEFAULT_DOCS_URL}/en/docs/${docsPath}`,
		]);
	});
});
