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
}));
vi.mock("./views/index.ts", () => ({
	SecretariesPage: (props: Record<string, unknown>) => {
		mocks.props.current = props;
		return createElement("div", { "data-testid": "secretaries" });
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
