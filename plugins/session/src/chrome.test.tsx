// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

import { SessionMenu } from "./chrome.tsx";

const props = (over: Partial<ChromeProps> = {}): ChromeProps => ({
	user: null,
	locale: "en",
	plugins: [],
	locales: ["en"],
	localeName: (l) => l,
	setLocale: vi.fn(),
	labels: { signIn: "Entrar", signOut: "Sair" },
	signOut: vi.fn(async () => {}),
	...over,
});

afterEach(cleanup);

describe("SessionMenu", () => {
	it("renders a localized sign-in link when anonymous", () => {
		render(<SessionMenu {...props()} />);
		const link = screen.getByRole("link", { name: "Entrar" });
		expect(link.getAttribute("href")).toBe("/login");
	});

	it("falls back to English labels when the host fills none", () => {
		render(<SessionMenu {...props({ labels: {} })} />);
		expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
	});

	it("shows the account menu for a signed-in user and signs out", async () => {
		const signOut = vi.fn(async () => {});
		render(
			<SessionMenu
				{...props({
					user: { id: "u1", email: "bia@ktb.test", name: "Bia" },
					signOut,
				})}
			/>,
		);
		expect(screen.getByText("Bia")).toBeTruthy();
		fireEvent.click(screen.getByText("Bia"));
		const item = await screen.findByText("Sair");
		fireEvent.click(item);
		await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
	});
});
