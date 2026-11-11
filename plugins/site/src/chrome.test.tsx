// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
	const React = await import("react");
	return {
		Link: ({ to, children, ...props }: Record<string, unknown>) =>
			React.createElement("a", { href: String(to), ...props }, children as ReactNode),
	};
});

import type { ChromeProps } from "@ktb/kernel";

import { SiteBrand, SiteLocaleToggle } from "./chrome.tsx";

const props = (over: Partial<ChromeProps> = {}): ChromeProps => ({
	user: null,
	locale: "en",
	plugins: [],
	locales: ["en", "es"],
	localeName: (l) => l.toUpperCase(),
	setLocale: vi.fn(),
	labels: {},
	signOut: vi.fn(async () => {}),
	...over,
});

afterEach(cleanup);

describe("SiteBrand", () => {
	it("renders the KTB Health mark linking to /", () => {
		render(<SiteBrand />);
		const link = screen.getByRole("link", { name: /KTB Health/ });
		expect(link.getAttribute("href")).toBe("/");
	});
});

describe("SiteLocaleToggle", () => {
	it("renders the language menu with the host-provided label", () => {
		render(<SiteLocaleToggle {...props({ labels: { langMenu: "Idioma" } })} />);
		expect(screen.getByRole("button", { name: "Idioma" })).toBeTruthy();
	});

	it("falls back to English when the host fills no label", () => {
		render(<SiteLocaleToggle {...props()} />);
		expect(screen.getByRole("button", { name: "Language" })).toBeTruthy();
	});
});
