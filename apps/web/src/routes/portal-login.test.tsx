// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

type AuthResult = {
	data: { user: object } | null;
	error: { message?: string } | null;
};
const okResult: AuthResult = { data: { user: {} }, error: null };

const mocks = vi.hoisted(() => ({
	emailEnabledFn: vi.fn(async () => true),
	loaderData: { current: { emailEnabled: false } },
}));
const signInEmail = vi.fn(async (_arg?: unknown): Promise<AuthResult> => okResult);
const signUpEmail = vi.fn(async (_arg?: unknown): Promise<AuthResult> => okResult);

vi.mock("@ktb/auth-better/client", () => ({
	authClient: {
		signIn: { email: (arg: unknown) => signInEmail(arg) },
		signUp: { email: (arg: unknown) => signUpEmail(arg) },
	},
}));
vi.mock("#/lib/fns.ts", () => ({ emailEnabledFn: mocks.emailEnabledFn }));
// The widget needs a site key and Cloudflare's script; the stand-in
// hands the page a token on demand.
vi.mock("@ktbhealth/ui/components/turnstile", async () => {
	const React = await import("react");
	return {
		Turnstile: ({ onToken }: { onToken: (token: string | null) => void }) =>
			React.createElement(
				"button",
				{ type: "button", onClick: () => onToken("captcha-token") },
				"Solve captcha",
			),
	};
});
// Link needs a router context; the page only uses it as a plain anchor.
// The route keeps its options and reads controllable loader data.
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	const React = await import("react");
	return {
		...actual,
		Link: ({ to, children, className }: { to: string; children?: unknown; className?: string }) =>
			React.createElement("a", { href: to, className }, children as never),
		createFileRoute: () => (opts: Record<string, unknown>) => ({
			options: opts,
			useLoaderData: () => mocks.loaderData.current,
		}),
	};
});

import { Route } from "./portal-login.tsx";

const options = (
	Route as unknown as {
		options: {
			component: () => ReactElement;
			head: () => { meta: { title: string }[] };
			loader: () => Promise<{ emailEnabled: boolean }>;
		};
	}
).options;
const Page = options.component;

const assign = vi.fn<(url: string) => void>();

const type = (label: string, value: string) =>
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string) =>
	act(async () => {
		fireEvent.click(screen.getByRole("button", { name }));
	});
const openSignUp = () => fireEvent.click(screen.getByRole("tab", { name: "Create account" }));

async function signIn() {
	type("Email", "ana@x.com");
	type("Password", "senha12345");
	await press("Sign in");
}

async function signUp({ confirm = "senha12345", name = "Ana Souza" } = {}) {
	openSignUp();
	type("Full name", name);
	type("Email", "ana@x.com");
	type("Password", "senha12345");
	type("Confirm password", confirm);
	await press("Create account");
}

describe("portal sign-in page", () => {
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	beforeEach(() => {
		assign.mockClear();
		signInEmail.mockReset();
		signUpEmail.mockReset();
		signInEmail.mockResolvedValue(okResult);
		signUpEmail.mockResolvedValue(okResult);
		mocks.loaderData.current = { emailEnabled: false };
		vi.stubGlobal("location", { assign });
	});

	it("sets the page title", () => {
		expect(options.head().meta[0]!.title).toBe("Patient sign in | KTB Health");
	});

	it("loads whether this deployment can send email", async () => {
		await expect(options.loader()).resolves.toEqual({ emailEnabled: true });
		mocks.emailEnabledFn.mockResolvedValueOnce(false);
		await expect(options.loader()).resolves.toEqual({ emailEnabled: false });
	});

	it("opens on sign-in, asking only for the credentials", () => {
		render(createElement(Page));
		expect(screen.getByText("Patient portal")).toBeTruthy();
		expect(screen.getByText("Sign in to see your consultations.")).toBeTruthy();
		expect(screen.queryByLabelText("Full name")).toBeNull();
		expect(screen.queryByLabelText("Confirm password")).toBeNull();
		expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe("current-password");
		expect(screen.getByRole("button", { name: "Sign in" })).toHaveProperty("disabled", false);
	});

	it("switches to the create-account form", () => {
		render(createElement(Page));
		openSignUp();
		expect(screen.getByText("Create patient account")).toBeTruthy();
		expect(screen.queryByText("Patient portal")).toBeNull();
		expect(screen.getByLabelText("Full name")).toBeTruthy();
		expect(screen.getByLabelText("Confirm password")).toBeTruthy();
		expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe("new-password");
		expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
	});

	it("signs in with the credentials and lands on the portal", async () => {
		render(createElement(Page));
		await signIn();
		await waitFor(() => expect(assign).toHaveBeenCalledWith("/portal"));
		expect(signInEmail).toHaveBeenCalledTimes(1);
		expect(signInEmail).toHaveBeenCalledWith({
			email: "ana@x.com",
			password: "senha12345",
			captchaToken: undefined,
		});
		expect(signUpEmail).not.toHaveBeenCalled();
		// Stays pending until the browser navigates away.
		expect(screen.getByRole("button", { name: /Please wait…/ })).toHaveProperty("disabled", true);
	});

	it("forwards the captcha token once the challenge is solved", async () => {
		render(createElement(Page));
		fireEvent.click(screen.getByRole("button", { name: "Solve captcha" }));
		await signIn();
		await waitFor(() => expect(signInEmail).toHaveBeenCalled());
		expect(signInEmail.mock.calls[0]![0]).toMatchObject({ captchaToken: "captcha-token" });
	});

	it("creates a patient account under the trimmed name", async () => {
		render(createElement(Page));
		await signUp({ name: "  Ana Souza " });
		await waitFor(() => expect(signUpEmail).toHaveBeenCalledTimes(1));
		expect(signUpEmail).toHaveBeenCalledWith({
			email: "ana@x.com",
			password: "senha12345",
			captchaToken: undefined,
			name: "Ana Souza",
			callbackURL: "/verify-email",
		});
		expect(signInEmail).not.toHaveBeenCalled();
	});

	it("sends a new account to the verification step when email is enabled", async () => {
		mocks.loaderData.current = { emailEnabled: true };
		render(createElement(Page));
		await signUp();
		await waitFor(() => expect(assign).toHaveBeenCalledWith("/verify-email"));
		expect(assign).toHaveBeenCalledTimes(1);
	});

	it("sends a new account straight to the portal when email is disabled", async () => {
		render(createElement(Page));
		await signUp();
		await waitFor(() => expect(assign).toHaveBeenCalledWith("/portal"));
		expect(assign).toHaveBeenCalledTimes(1);
	});

	it("blocks sign-up when the passwords do not match", async () => {
		render(createElement(Page));
		await signUp({ confirm: "different1" });
		await screen.findByText("Passwords do not match.");
		expect(signUpEmail).not.toHaveBeenCalled();
		expect(assign).not.toHaveBeenCalled();
	});

	it("drops the error and the confirmation when switching tabs", async () => {
		render(createElement(Page));
		await signUp({ confirm: "different1" });
		await screen.findByText("Passwords do not match.");
		fireEvent.click(screen.getByRole("tab", { name: "Sign in" }));
		expect(screen.queryByText("Passwords do not match.")).toBeNull();
		openSignUp();
		expect((screen.getByLabelText("Confirm password") as HTMLInputElement).value).toBe("");
		// The rest of the form survives the round trip.
		expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("ana@x.com");
	});

	it("shows the server error and lets the user try again", async () => {
		signInEmail.mockResolvedValueOnce({ data: null, error: { message: "Invalid credentials" } });
		render(createElement(Page));
		await signIn();
		await screen.findByText("Invalid credentials");
		expect(assign).not.toHaveBeenCalled();
		await press("Sign in");
		await waitFor(() => expect(assign).toHaveBeenCalledWith("/portal"));
		expect(screen.queryByText("Invalid credentials")).toBeNull();
	});

	it("shows a fallback when the error has no message", async () => {
		signUpEmail.mockResolvedValueOnce({ data: null, error: {} });
		render(createElement(Page));
		await signUp();
		await screen.findByText("Could not sign in. Please try again.");
		expect(assign).not.toHaveBeenCalled();
	});

	it("ignores a submit without an email or a password", async () => {
		const { container } = render(createElement(Page));
		const form = container.querySelector("form")!;
		const submit = () =>
			act(async () => {
				fireEvent.submit(form);
			});
		await submit();
		type("Email", "   ");
		type("Password", "senha12345");
		await submit();
		type("Email", "ana@x.com");
		type("Password", "");
		await submit();
		expect(signInEmail).not.toHaveBeenCalled();
		expect(assign).not.toHaveBeenCalled();
	});

	it("ignores a second submit while one is in flight", async () => {
		let release: (value: AuthResult) => void = () => {};
		signInEmail.mockImplementationOnce(
			() => new Promise<AuthResult>((resolve) => (release = resolve)),
		);
		const { container } = render(createElement(Page));
		await signIn();
		expect(screen.getByRole("button", { name: /Please wait…/ })).toHaveProperty("disabled", true);
		await act(async () => {
			fireEvent.submit(container.querySelector("form")!);
		});
		expect(signInEmail).toHaveBeenCalledTimes(1);
		await act(async () => release(okResult));
		await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
	});

	it("points doctors to their own sign-in page", () => {
		render(createElement(Page));
		expect(screen.getByRole("link", { name: "I am a doctor" }).getAttribute("href")).toBe("/login");
	});
});
