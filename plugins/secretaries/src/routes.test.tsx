// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	sessionUserFn: vi.fn(),
	listSecretariesFn: vi.fn(),
	inviteSecretaryFn: vi.fn(async (_arg: { data: { email: string } }) => ({ ok: true })),
	revokeSecretaryFn: vi.fn(async (_arg: { data: number }) => ({ ok: true })),
	localeFn: vi.fn(async () => "pt-BR"),
	emailEnabledFn: vi.fn(async () => true),
	doctorContextFn: vi.fn(),
	invalidate: vi.fn(),
	loaderData: { current: undefined as unknown },
	props: { current: undefined as Record<string, unknown> | undefined },
}));

vi.mock("./fns.ts", () => ({
	sessionUserFn: mocks.sessionUserFn,
	listSecretariesFn: mocks.listSecretariesFn,
	inviteSecretaryFn: mocks.inviteSecretaryFn,
	revokeSecretaryFn: mocks.revokeSecretaryFn,
	localeFn: mocks.localeFn,
	emailEnabledFn: mocks.emailEnabledFn,
}));
vi.mock("@ktb/doctors/fns", () => ({
	doctorContextFn: () => mocks.doctorContextFn(),
}));
vi.mock("./views/index.ts", () => ({
	SecretariesPage: (props: Record<string, unknown>) => {
		mocks.props.current = props;
		return createElement("div", { "data-testid": "secretaries" });
	},
	SecretaryLoginPage: (props: Record<string, unknown>) => {
		mocks.props.current = props;
		return createElement("div", { "data-testid": "secretary-login" });
	},
}));
// Server fns become plain async calls; with no runtime registered the
// plugin route gate (createPluginFileRoute → pluginEnabledFn) is inert.
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		let validate: ((value: unknown) => unknown) | undefined;
		const api = {
			validator: (fn: (value: unknown) => unknown) => {
				validate = fn;
				return api;
			},
			handler: (h: (arg: { data: unknown }) => unknown) => async (call: { data?: unknown }) =>
				h({ data: validate === undefined ? call?.data : validate(call?.data) }),
		};
		return api;
	},
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useRouter: () => ({ invalidate: mocks.invalidate }),
		createFileRoute: () => (opts: Record<string, unknown>) => ({
			options: opts,
			useLoaderData: () => mocks.loaderData.current,
		}),
	};
});

import { isRedirect } from "@tanstack/react-router";

import { Route } from "./routes/index.tsx";
import { Route as LoginRoute } from "./routes/login.tsx";

const options = (
	Route as unknown as {
		options: {
			beforeLoad: () => Promise<void>;
			loader: () => Promise<unknown>;
			component: () => ReactElement;
		};
	}
).options;

const redirectTarget = async (run: () => Promise<unknown>) => {
	const caught = await run().catch((e: unknown) => e);
	expect(isRedirect(caught)).toBe(true);
	return (caught as Response & { options: { to: string } }).options.to;
};

afterEach(cleanup);

describe("/secretaries", () => {
	it("requires a session", async () => {
		mocks.sessionUserFn.mockResolvedValue({ id: "u1" });
		await expect(options.beforeLoad()).resolves.toBeUndefined();
		mocks.sessionUserFn.mockResolvedValue(null);
		expect(await redirectTarget(options.beforeLoad)).toBe("/login");
	});

	it("loads the secretaries with the locale", async () => {
		const secretaries = [{ id: 1, email: "ana@ktb.test", status: "active" }];
		mocks.listSecretariesFn.mockResolvedValue(secretaries);
		await expect(options.loader()).resolves.toEqual({ secretaries, locale: "pt-BR" });
	});

	it("sends accounts without their own doctor profile to the chooser", async () => {
		mocks.listSecretariesFn.mockResolvedValue(null);
		expect(await redirectTarget(options.loader)).toBe("/doctors/select");
	});

	it("wires the view to the server fns and refreshes on change", async () => {
		mocks.loaderData.current = { secretaries: [], locale: "en" };
		render(createElement(options.component));
		const props = mocks.props.current as {
			secretaries: unknown[];
			locale: string;
			api: { invite(email: string): Promise<unknown>; revoke(id: number): Promise<unknown> };
			onChanged(): void;
		};
		expect(props).toMatchObject({ secretaries: [], locale: "en" });
		await props.api.invite("new@ktb.test");
		expect(mocks.inviteSecretaryFn).toHaveBeenCalledWith({ data: { email: "new@ktb.test" } });
		await props.api.revoke(5);
		expect(mocks.revokeSecretaryFn).toHaveBeenCalledWith({ data: 5 });
		props.onChanged();
		expect(mocks.invalidate).toHaveBeenCalledTimes(1);
	});
});

describe("/secretaries/login", () => {
	const loginOptions = (
		LoginRoute as unknown as {
			options: {
				loader: () => Promise<unknown>;
				head: (arg: { loaderData?: { locale: string } }) => { meta: { title: string }[] };
				component: () => ReactElement;
			};
		}
	).options;

	it("loads the locale and whether email can be sent", async () => {
		await expect(loginOptions.loader()).resolves.toEqual({
			locale: "pt-BR",
			emailEnabled: true,
		});
	});

	it("titles the document in the loaded locale", () => {
		expect(loginOptions.head({ loaderData: { locale: "pt-BR" } }).meta[0]!.title).toBe(
			"Secretária | KTB Health",
		);
		expect(loginOptions.head({}).meta[0]!.title).toBe("Secretary sign-in | KTB Health");
	});

	it("wires the view with loader data and the doctor-context api", async () => {
		mocks.loaderData.current = { locale: "en", emailEnabled: true };
		mocks.doctorContextFn.mockResolvedValue({ profiles: [{ doctorId: 1 }] });
		render(createElement(loginOptions.component));
		const props = mocks.props.current as {
			locale: string;
			emailEnabled: boolean;
			api: { context(): Promise<unknown> };
		};
		expect(props).toMatchObject({ locale: "en", emailEnabled: true });
		await expect(props.api.context()).resolves.toEqual({ profiles: [{ doctorId: 1 }] });
		expect(mocks.doctorContextFn).toHaveBeenCalledTimes(1);
	});

	it("falls back to defaults without loader data", () => {
		mocks.loaderData.current = undefined;
		render(createElement(loginOptions.component));
		expect(mocks.props.current).toMatchObject({ locale: "en", emailEnabled: false });
	});
});
