// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	search: {} as Record<string, unknown>,
	navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => state.navigate,
	useSearch: (opts: { strict: false; select: (s: Record<string, unknown>) => unknown }) =>
		opts.select(state.search),
}));

// Base UI's Select needs pointer/portal plumbing jsdom lacks; a native
// <select> exposes the same value/onValueChange contract.
vi.mock("@ktbhealth/ui/components/select", () => ({
	Select: ({
		value,
		onValueChange,
		children,
	}: {
		value: string;
		onValueChange: (v: string | null) => void;
		children: ReactNode;
	}) =>
		createElement(
			"div",
			null,
			createElement(
				"select",
				{
					"data-testid": "audience",
					value,
					onChange: (e: { target: { value: string } }) => onValueChange(e.target.value),
				},
				createElement("option", { value: "doctors" }, "doctors"),
				createElement("option", { value: "patients" }, "patients"),
				createElement("option", { value: "developers" }, "developers"),
				createElement("option", { value: "business" }, "business"),
			),
			children,
		),
	SelectTrigger: ({ children, ...props }: { children: ReactNode }) =>
		createElement("button", props, children),
	SelectValue: () => null,
	SelectContent: ({ children }: { children: ReactNode }) => createElement("ul", null, children),
	SelectItem: ({ children, value }: { children: ReactNode; value: string }) =>
		createElement("li", { "data-value": value }, children),
}));

import { audienceMessages } from "./i18n.ts";
import { AudienceSelect } from "./select.tsx";

const t = audienceMessages("en");

afterEach(() => {
	cleanup();
	state.search = {};
	state.navigate.mockReset();
});

const select = () => screen.getByTestId("audience") as unknown as HTMLSelectElement;

describe("AudienceSelect", () => {
	it("shows the audience from the URL and lists every audience", () => {
		state.search = { audience: "patients" };
		render(createElement(AudienceSelect, { t }));
		expect(select().value).toBe("patients");
		expect(screen.getByRole("button", { name: "View as" })).toBeTruthy();
		expect(
			screen.getAllByRole("listitem").map((li) => [li.getAttribute("data-value"), li.textContent]),
		).toEqual([
			["doctors", "Doctors"],
			["patients", "Patients"],
			["developers", "Developers"],
			["business", "Business"],
		]);
	});

	it("falls back to doctors for an unknown audience", () => {
		state.search = { audience: "admins" };
		render(createElement(AudienceSelect, { t }));
		expect(select().value).toBe("doctors");
	});

	it("writes the chosen audience to the URL, replacing the history entry", () => {
		render(createElement(AudienceSelect, { t }));
		fireEvent.change(select(), { target: { value: "business" } });
		expect(state.navigate).toHaveBeenCalledWith({
			to: "/",
			search: { audience: "business" },
			replace: true,
		});
	});
});
