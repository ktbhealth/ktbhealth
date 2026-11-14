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

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

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

	it("falls back to English labels and a placeholder avatar", async () => {
		const signOut = vi.fn(async () => {});
		render(
			<SessionMenu
				{...props({
					// No `name` → avatar fallback; no `signOut` label → English.
					user: { id: "u2", email: "noname@ktb.test" },
					labels: {},
					signOut,
				})}
			/>,
		);
		// The trigger renders the avatar fallback ("?") and an empty name.
		fireEvent.click(screen.getByRole("button"));
		const item = await screen.findByText("Sign out");
		fireEvent.click(item);
		await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
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

	it("offers a doctor account the profile shortcuts as full navigations", async () => {
		const assign = vi.fn();
		vi.stubGlobal("location", { assign });
		render(
			<SessionMenu
				{...props({
					user: { id: "u1", email: "bia@ktb.test", name: "Bia", patientOnly: false },
					labels: {
						switchDoctor: "Trocar de médico",
						secretaries: "Secretárias",
						patientPortal: "Portal do paciente",
					},
				})}
			/>,
		);
		fireEvent.click(screen.getByText("Bia"));
		fireEvent.click(await screen.findByText("Trocar de médico"));
		fireEvent.click(screen.getByText("Bia"));
		fireEvent.click(await screen.findByText("Secretárias"));
		fireEvent.click(screen.getByText("Bia"));
		fireEvent.click(await screen.findByText("Portal do paciente"));
		expect(assign.mock.calls).toEqual([["/doctors/select"], ["/secretaries"], ["/portal"]]);
	});

	it("falls back to English profile shortcuts when the host fills none", async () => {
		render(
			<SessionMenu
				{...props({ user: { id: "u1", email: "bia@ktb.test", name: "Bia" }, labels: {} })}
			/>,
		);
		fireEvent.click(screen.getByText("Bia"));
		expect(await screen.findByText("Switch doctor")).toBeTruthy();
		expect(screen.getByText("Secretaries")).toBeTruthy();
		expect(screen.getByText("Patient portal")).toBeTruthy();
	});

	it("narrows a patient account to its own consultations", async () => {
		const assign = vi.fn();
		vi.stubGlobal("location", { assign });
		const user = { id: "p1", email: "ana@ktb.test", name: "Ana", patientOnly: true };
		const view = render(
			<SessionMenu {...props({ user, labels: { myConsultations: "Minhas consultas" } })} />,
		);
		fireEvent.click(screen.getByText("Ana"));
		fireEvent.click(await screen.findByText("Minhas consultas"));
		expect(assign).toHaveBeenCalledWith("/portal");
		view.unmount();

		// No host label → English fallback; never the doctor shortcuts.
		render(<SessionMenu {...props({ user, labels: {} })} />);
		fireEvent.click(screen.getByText("Ana"));
		expect(await screen.findByText("My consultations")).toBeTruthy();
		expect(screen.queryByText("Switch doctor")).toBeNull();
		expect(screen.queryByText("Secretaries")).toBeNull();
		expect(screen.queryByText("Patient portal")).toBeNull();
	});
});
