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

import { NewConsultationLink } from "./chrome.tsx";

const props = (over: Partial<ChromeProps> = {}): ChromeProps => ({
	user: null,
	locale: "en",
	plugins: [],
	locales: ["en"],
	localeName: (l) => l,
	setLocale: vi.fn(),
	labels: { newConsultation: "+ Nova consulta" },
	signOut: vi.fn(async () => {}),
	...over,
});

afterEach(cleanup);

describe("NewConsultationLink", () => {
	it("links to /consultations/new with the host-provided label", () => {
		render(<NewConsultationLink {...props()} />);
		const link = screen.getByRole("link", { name: "+ Nova consulta" });
		expect(link.getAttribute("href")).toBe("/consultations/new");
	});

	it("falls back to the English label when the host fills none", () => {
		render(<NewConsultationLink {...props({ labels: {} })} />);
		expect(screen.getByRole("link", { name: "+ New consultation" })).toBeTruthy();
	});

	it("renders nothing for a patient account", () => {
		render(
			<NewConsultationLink
				{...props({ user: { id: "p1", email: "paciente@ktb.test", patientOnly: true } })}
			/>,
		);
		expect(screen.queryByRole("link")).toBeNull();
	});
});
