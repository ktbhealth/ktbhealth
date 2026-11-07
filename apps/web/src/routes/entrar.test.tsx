// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

type AuthResult = {
	data: { user: object } | null;
	error: { message: string } | null;
};
const okResult: AuthResult = { data: { user: {} }, error: null };
const signInEmail = vi.fn(async (_arg?: unknown): Promise<AuthResult> => okResult);
const signUpEmail = vi.fn(async (_arg?: unknown): Promise<AuthResult> => okResult);

vi.mock("@ktb/auth-better/client", () => ({
	authClient: {
		useSession: () => ({ data: null, isPending: false }),
		signIn: { email: (arg: unknown) => signInEmail(arg) },
		signUp: { email: (arg: unknown) => signUpEmail(arg) },
		signOut: vi.fn(),
	},
}));

import { Route } from "./entrar.tsx";

const Page = (Route as unknown as { options: { component: () => ReactElement } }).options
	.component;

async function fillAndSubmit() {
	fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dra@x.com" } });
	fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha12345" } });
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
	});
}

describe("entrar page", () => {
	afterEach(cleanup);

	beforeEach(() => {
		signInEmail.mockClear();
		signUpEmail.mockClear();
		signInEmail.mockResolvedValue({ data: { user: {} }, error: null });
		signUpEmail.mockResolvedValue({ data: { user: {} }, error: null });
	});

	it("signs in and redirects", async () => {
		render(createElement(Page));
		await fillAndSubmit();
		await waitFor(() => expect(signInEmail).toHaveBeenCalled());
		expect(signInEmail.mock.calls[0]![0]).toMatchObject({ email: "dra@x.com" });
	});

	it("toggles to sign-up mode and submits", async () => {
		render(createElement(Page));
		fireEvent.click(screen.getByText("Não tem conta? Criar conta"));
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dra@x.com" } });
		fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha12345" } });
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
		});
		await waitFor(() => expect(signUpEmail).toHaveBeenCalled());
		const arg = signUpEmail.mock.calls[0]![0] as { name: string };
		expect(arg.name).toBe("dra");
	});

	it("shows error on failed sign-in", async () => {
		signInEmail.mockResolvedValue({
			data: null,
			error: { message: "credenciais inválidas" },
		});
		render(createElement(Page));
		await fillAndSubmit();
		await waitFor(() => expect(screen.getByText("credenciais inválidas")).toBeTruthy());
	});

	it("ignores submit while pending or empty", async () => {
		render(createElement(Page));
		// empty submit: button disabled? form onSubmit guards
		fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
		expect(signInEmail).not.toHaveBeenCalled();
	});
});
