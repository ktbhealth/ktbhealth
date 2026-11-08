// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";

vi.mock("@ktbhealth/ui/components/dropdown-menu", async () => {
	const React = await import("react");
	const passthrough =
		(tag: string) =>
		({ children, ...props }: Record<string, unknown>) =>
			React.createElement(tag, props, children as never);
	return {
		DropdownMenu: passthrough("div"),
		DropdownMenuTrigger: passthrough("button"),
		DropdownMenuContent: passthrough("div"),
		DropdownMenuLabel: passthrough("div"),
		DropdownMenuItem: ({ children, onClick, ...props }: Record<string, unknown>) =>
			React.createElement("button", { ...props, onClick: onClick as never }, children as never),
	};
});

import { LanguageToggle } from "./language-toggle.tsx";

describe("LanguageToggle", () => {
	afterEach(cleanup);

	it("renders a trigger with an accessible label", () => {
		render(
			createElement(LanguageToggle, {
				locales: ["en", "pt-BR"],
				value: "en",
				onChange: vi.fn<(locale: string) => void>(),
			}),
		);
		expect(screen.getByRole("button", { name: "Language" })).toBeTruthy();
	});

	it("lists locales with the active one checked and calls onChange", () => {
		const onChange = vi.fn<(locale: string) => void>();
		const { container } = render(
			createElement(LanguageToggle, {
				locales: ["en", "pt-BR"],
				value: "en",
				onChange,
			}),
		);
		// active locale renders the check icon, inactive renders none
		expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
		fireEvent.click(screen.getByRole("button", { name: "Português (Brasil)" }));
		expect(onChange).toHaveBeenCalledWith("pt-BR");
	});

	it("falls back to the raw locale tag for unknown locales", () => {
		render(
			createElement(LanguageToggle, {
				locales: ["en", "xx"],
				value: "xx",
				onChange: vi.fn<(locale: string) => void>(),
			}),
		);
		expect(screen.getByRole("button", { name: "xx" })).toBeTruthy();
	});
});
