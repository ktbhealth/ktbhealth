// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

type SessionState = {
	data: { user: { email: string; emailVerified: boolean } } | null;
	isPending: boolean;
};
type SendResult = { data: object | null; error: { message?: string } | null };

const state: { session: SessionState; account: { patientOnly: boolean } | null } = {
	session: { data: null, isPending: false },
	account: null,
};
const sendVerificationEmail = vi.fn<(arg?: unknown) => Promise<SendResult>>(async () => ({
	data: {},
	error: null,
}));

vi.mock("@ktb/auth-better/client", () => ({
	authClient: {
		useSession: () => state.session,
		sendVerificationEmail: (arg: unknown) => sendVerificationEmail(arg),
	},
}));

// Link needs a router context; the page only uses it as a plain anchor.
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	const React = await import("react");
	return {
		...actual,
		Link: ({ to, children, className }: { to: string; children?: unknown; className?: string }) =>
			React.createElement("a", { href: to, className }, children as never),
		// The root session, as the root route's loader returns it.
		useLoaderData: () => ({ user: state.account }),
	};
});

import { Route } from "./verify-email.tsx";

const options = (
	Route as unknown as {
		options: { component: () => ReactElement; head: () => { meta: { title: string }[] } };
	}
).options;
const Page = options.component;

const SENT = "If this address has an account awaiting verification, a new link is on its way.";

const resend = () =>
	act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Resend verification link" }));
	});

describe("verify-email page", () => {
	afterEach(cleanup);

	beforeEach(() => {
		state.session = { data: null, isPending: false };
		state.account = null;
		sendVerificationEmail.mockClear();
		sendVerificationEmail.mockResolvedValue({ data: {}, error: null });
	});

	it("sets the page title", () => {
		expect(options.head().meta[0]!.title).toBe("Verify email | KTB Health");
	});

	it("waits for the session before rendering the form", () => {
		state.session = { data: null, isPending: true };
		render(createElement(Page));
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.queryByText("Verify your email")).toBeNull();
	});

	it("resends to the signed-in user's own address", async () => {
		state.session = {
			data: { user: { email: "dra@x.com", emailVerified: false } },
			isPending: false,
		};
		render(createElement(Page));
		expect(screen.getByText(/We sent a verification link to dra@x.com/)).toBeTruthy();
		expect(screen.queryByLabelText("Email")).toBeNull();
		await resend();
		await waitFor(() => expect(screen.getByText(SENT)).toBeTruthy());
		expect(sendVerificationEmail.mock.calls[0]![0]).toMatchObject({
			email: "dra@x.com",
			callbackURL: "/verify-email",
		});
	});

	it("lets an anonymous visitor type the address", async () => {
		render(createElement(Page));
		// Empty address: nothing is sent.
		await act(async () => {
			fireEvent.submit(screen.getByRole("button", { name: "Resend verification link" }));
		});
		expect(sendVerificationEmail).not.toHaveBeenCalled();
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: " dra@x.com " } });
		await resend();
		await waitFor(() => expect(screen.getByText(SENT)).toBeTruthy());
		expect(sendVerificationEmail.mock.calls[0]![0]).toMatchObject({ email: "dra@x.com" });
	});

	it("shows the server error, or a fallback when it has no message", async () => {
		state.session = {
			data: { user: { email: "dra@x.com", emailVerified: false } },
			isPending: false,
		};
		sendVerificationEmail.mockResolvedValueOnce({ data: null, error: { message: "Too many" } });
		render(createElement(Page));
		await resend();
		await waitFor(() => expect(screen.getByText("Too many")).toBeTruthy());
		expect(screen.queryByText(SENT)).toBeNull();
		sendVerificationEmail.mockResolvedValueOnce({ data: null, error: {} });
		await resend();
		await waitFor(() =>
			expect(screen.getByText("Could not send the link. Please try again.")).toBeTruthy(),
		);
	});

	it("ignores a second submit while one is in flight", async () => {
		state.session = {
			data: { user: { email: "dra@x.com", emailVerified: false } },
			isPending: false,
		};
		let release: (value: SendResult) => void = () => {};
		sendVerificationEmail.mockImplementationOnce(
			() => new Promise<SendResult>((resolve) => (release = resolve)),
		);
		render(createElement(Page));
		await resend();
		await act(async () => {
			fireEvent.submit(screen.getByRole("button", { name: /Please wait…/ }));
		});
		expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
		await act(async () => release({ data: {}, error: null }));
		await waitFor(() => expect(screen.getByText(SENT)).toBeTruthy());
	});

	it("shows the verified state with a way forward", () => {
		state.session = {
			data: { user: { email: "dra@x.com", emailVerified: true } },
			isPending: false,
		};
		render(createElement(Page));
		expect(screen.getByText("Email verified")).toBeTruthy();
		expect(screen.getByText("Your address dra@x.com is confirmed.")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe("/");
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("sends a verified doctor home and a verified patient account to the portal", () => {
		state.session = {
			data: { user: { email: "ana@x.com", emailVerified: true } },
			isPending: false,
		};
		state.account = { patientOnly: false };
		render(createElement(Page));
		expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe("/");
		cleanup();
		state.account = { patientOnly: true };
		render(createElement(Page));
		expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe("/portal");
	});
});
