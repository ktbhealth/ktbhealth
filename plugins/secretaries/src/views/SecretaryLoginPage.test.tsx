// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
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

// The view renders outside a router: Link degrades to a plain anchor.
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	const React = await import("react");
	return {
		...actual,
		Link: ({ to, children, className }: { to: string; children?: unknown; className?: string }) =>
			React.createElement("a", { href: to, className }, children as never),
	};
});

import { SecretaryLoginPage, type SecretaryLoginApi } from "./SecretaryLoginPage.tsx";

type Context = Awaited<ReturnType<SecretaryLoginApi["context"]>>;
const oneProfile: Context = { profiles: [{ doctorId: 1 }] };
const context = vi.fn<SecretaryLoginApi["context"]>(async () => oneProfile);

const loaderData = { emailEnabled: false };
const Page = () =>
	createElement(SecretaryLoginPage, {
		locale: "en",
		emailEnabled: loaderData.emailEnabled,
		api: { context },
	}) as ReactElement;

async function fillAndSubmit() {
	fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sec@x.com" } });
	fireEvent.change(screen.getByLabelText("Password"), { target: { value: "senha12345" } });
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
	});
}

describe("secretary sign-in page", () => {
	afterEach(cleanup);

	beforeEach(() => {
		signInEmail.mockClear();
		signUpEmail.mockClear();
		context.mockClear();
		signInEmail.mockResolvedValue({ data: { user: {} }, error: null });
		signUpEmail.mockResolvedValue({ data: { user: {} }, error: null });
		context.mockResolvedValue(oneProfile);
	});

	it("signs in and asks the api for the doctor context", async () => {
		render(createElement(Page));
		await fillAndSubmit();
		await waitFor(() => expect(signInEmail).toHaveBeenCalled());
		expect(signInEmail.mock.calls[0]![0]).toMatchObject({ email: "sec@x.com" });
		await waitFor(() => expect(context).toHaveBeenCalled());
	});

	it("signs up with name and never asks for a doctor context", async () => {
		render(createElement(Page));
		fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Maria Souza" } });
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sec@x.com" } });
		fireEvent.change(screen.getByLabelText("Password"), { target: { value: "senha12345" } });
		fireEvent.change(screen.getByLabelText("Confirm password"), {
			target: { value: "senha12345" },
		});
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Create account" }));
		});
		await waitFor(() => expect(signUpEmail).toHaveBeenCalled());
		expect(signUpEmail.mock.calls[0]![0]).toMatchObject({
			email: "sec@x.com",
			name: "Maria Souza",
			callbackURL: "/verify-email",
		});
		expect(context).not.toHaveBeenCalled();
	});

	it("blocks sign-up when passwords do not match", async () => {
		render(createElement(Page));
		fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Maria" } });
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sec@x.com" } });
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

	it("shows error on failed sign-in", async () => {
		signInEmail.mockResolvedValue({ data: null, error: { message: "invalid credentials" } });
		render(createElement(Page));
		await fillAndSubmit();
		await waitFor(() => expect(screen.getByText("invalid credentials")).toBeTruthy());
	});

	it("shows the fallback when the error has no message", async () => {
		signInEmail.mockResolvedValue({
			data: null,
			error: { message: undefined },
		} as unknown as AuthResult);
		render(createElement(Page));
		await fillAndSubmit();
		await screen.findByText("Could not sign in. Please try again.");
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
			fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Maria" } });
			fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sec@x.com" } });
			fireEvent.change(screen.getByLabelText("Password"), { target: { value: "senha12345" } });
			fireEvent.change(screen.getByLabelText("Confirm password"), {
				target: { value: "senha12345" },
			});
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Create account" }));
			});
		};

		it("sends a new account to the verification step when email is enabled", async () => {
			loaderData.emailEnabled = true;
			await signUp();
			await waitFor(() => expect(assign).toHaveBeenCalledWith("/verify-email"));
		});

		it("sends a new account to the chooser when email is disabled", async () => {
			await signUp();
			await waitFor(() => expect(assign).toHaveBeenCalledWith("/doctors/select"));
		});

		it("sends a sign-in with a single doctor profile straight home", async () => {
			render(createElement(Page));
			await fillAndSubmit();
			await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
		});

		it("sends a sign-in with several profiles to the chooser", async () => {
			context.mockResolvedValueOnce({ profiles: [{ doctorId: 1 }, { doctorId: 2 }] });
			render(createElement(Page));
			await fillAndSubmit();
			await waitFor(() => expect(assign).toHaveBeenCalledWith("/doctors/select"));
		});

		it.each([
			["no profiles", { profiles: [] }],
			["no context", null],
		] as const)("stays and explains when sign-in yields %s", async (_label, ctx) => {
			context.mockResolvedValueOnce(ctx);
			render(createElement(Page));
			await fillAndSubmit();
			await screen.findByText(/No delegation found/);
			expect(assign).not.toHaveBeenCalled();
		});
	});

	it("links to the resend-verification and doctor screens", () => {
		render(createElement(Page));
		expect(
			screen.getByRole("link", { name: "Didn't get the verification email?" }).getAttribute("href"),
		).toBe("/verify-email");
		expect(screen.getByRole("link", { name: "I am a doctor" }).getAttribute("href")).toBe("/login");
	});
});
