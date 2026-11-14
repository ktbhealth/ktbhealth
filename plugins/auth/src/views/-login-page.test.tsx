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

const loaderData = { emailEnabled: false };

// The view renders outside a router: Link degrades to a plain anchor and
// `emailEnabled` arrives via the mutable `loaderData` above.
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	const React = await import("react");
	return {
		...actual,
		Link: ({ to, children, className }: { to: string; children?: unknown; className?: string }) =>
			React.createElement("a", { href: to, className }, children as never),
	};
});

import { LoginPage } from "../views/LoginPage.tsx";

const Page = () =>
	createElement(LoginPage, {
		locale: "en",
		emailEnabled: loaderData.emailEnabled,
	}) as ReactElement;

async function fillAndSubmit() {
	fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dra@x.com" } });
	fireEvent.change(screen.getByLabelText("Password"), { target: { value: "senha12345" } });
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
	});
}

describe("sign-in page", () => {
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
		fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dra@x.com" } });
		fireEvent.change(screen.getByLabelText("Password"), { target: { value: "senha12345" } });
		fireEvent.change(screen.getByLabelText("Confirm password"), {
			target: { value: "senha12345" },
		});
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Create account" }));
		});
		await waitFor(() => expect(signUpEmail).toHaveBeenCalled());
		const arg = signUpEmail.mock.calls[0]![0] as { name: string };
		expect(arg.name).toBe("dra");
	});

	it("blocks sign-up when passwords do not match", async () => {
		render(createElement(Page));
		fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dra@x.com" } });
		fireEvent.change(screen.getByLabelText("Password"), { target: { value: "senha12345" } });
		fireEvent.change(screen.getByLabelText("Confirm password"), {
			target: { value: "different1" },
		});
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Create account" }));
		});
		expect(signUpEmail).not.toHaveBeenCalled();
		await screen.findByText("Passwords do not match.");
	});

	it("clears confirm password when switching modes", async () => {
		render(createElement(Page));
		fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
		const confirm = screen.getByLabelText("Confirm password") as HTMLInputElement;
		fireEvent.change(confirm, { target: { value: "senha12345" } });
		expect(confirm.value).toBe("senha12345");
		fireEvent.click(screen.getByRole("tab", { name: "Sign in" }));
		expect(screen.queryByLabelText("Confirm password")).toBeNull();
		fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
		expect((screen.getByLabelText("Confirm password") as HTMLInputElement).value).toBe("");
	});

	it("shows error on failed sign-in", async () => {
		signInEmail.mockResolvedValue({
			data: null,
			error: { message: "invalid credentials" },
		});
		render(createElement(Page));
		await fillAndSubmit();
		await waitFor(() => expect(screen.getByText("invalid credentials")).toBeTruthy());
	});

	it("ignores double submit while pending", async () => {
		let resolveSignIn: ((v: AuthResult) => void) | null = null;
		signInEmail.mockImplementation(
			() =>
				new Promise<AuthResult>((r) => {
					resolveSignIn = r;
				}),
		);
		render(createElement(Page));
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
		fireEvent.change(screen.getByLabelText("Password"), { target: { value: "senha12345" } });
		const btn = screen.getByRole("button", { name: "Sign in" });
		await act(async () => {
			fireEvent.click(btn);
		});
		await waitFor(() => expect(btn).toHaveProperty("disabled", true));
		await act(async () => {
			fireEvent.click(btn);
		});
		expect(signInEmail).toHaveBeenCalledTimes(1);
		await act(async () => {
			resolveSignIn?.({ data: { user: {} }, error: null });
		});
	});

	it("ignores submit while pending or empty", async () => {
		render(createElement(Page));
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(signInEmail).not.toHaveBeenCalled();
	});

	it("form submit guard rejects empty email, empty password and pending", async () => {
		let resolveSignIn: ((v: AuthResult) => void) | null = null;
		signInEmail.mockImplementation(
			() =>
				new Promise<AuthResult>((r) => {
					resolveSignIn = r;
				}),
		);
		const { container } = render(createElement(Page));
		const form = container.querySelector("form")!;
		fireEvent.submit(form);
		expect(signInEmail).not.toHaveBeenCalled();
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
		fireEvent.submit(form);
		expect(signInEmail).not.toHaveBeenCalled();
		fireEvent.change(screen.getByLabelText("Password"), { target: { value: "senha12345" } });
		fireEvent.submit(form);
		await waitFor(() => expect(signInEmail).toHaveBeenCalledTimes(1));
		fireEvent.submit(form);
		expect(signInEmail).toHaveBeenCalledTimes(1);
		await act(async () => {
			resolveSignIn?.({ data: { user: {} }, error: null });
		});
	});

	it("shows fallback message when error has no message", async () => {
		signInEmail.mockResolvedValue({
			data: null,
			error: { message: undefined },
		} as unknown as AuthResult);
		render(createElement(Page));
		await fillAndSubmit();
		await screen.findByText("Could not sign in. Please try again.");
	});

	describe("post-submit destination", () => {
		const assign = vi.fn<(url: string) => void>();

		beforeEach(() => {
			assign.mockClear();
			loaderData.emailEnabled = false;
			vi.stubGlobal("location", { assign });
		});

		afterEach(() => vi.unstubAllGlobals());

		const signUp = async () => {
			render(createElement(Page));
			fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
			fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dra@x.com" } });
			fireEvent.change(screen.getByLabelText("Password"), { target: { value: "senha12345" } });
			fireEvent.change(screen.getByLabelText("Confirm password"), {
				target: { value: "senha12345" },
			});
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Create account" }));
			});
		};

		it("sends a new account to the verification step", async () => {
			loaderData.emailEnabled = true;
			await signUp();
			await waitFor(() => expect(assign).toHaveBeenCalledWith("/verify-email"));
		});

		it("sends a new account home when email is disabled", async () => {
			await signUp();
			await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
		});

		it("sends a sign-in straight home", async () => {
			loaderData.emailEnabled = true;
			render(createElement(Page));
			await fillAndSubmit();
			await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
		});
	});

	it("links to the resend-verification screen", () => {
		render(createElement(Page));
		expect(
			screen.getByRole("link", { name: "Didn't get the verification email?" }).getAttribute("href"),
		).toBe("/verify-email");
	});
});
