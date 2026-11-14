// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	doctorContextFn: vi.fn(),
	selectDoctorFn: vi.fn(async (_arg: { data: number }) => ({ ok: true })),
	localeFn: vi.fn(async () => "pt-BR"),
	loaderData: { current: undefined as unknown },
	props: { current: undefined as Record<string, unknown> | undefined },
}));

vi.mock("./fns.ts", () => ({
	doctorContextFn: mocks.doctorContextFn,
	selectDoctorFn: mocks.selectDoctorFn,
	localeFn: mocks.localeFn,
}));
vi.mock("./views/index.ts", () => ({
	DoctorSelectPage: (props: Record<string, unknown>) => {
		mocks.props.current = props;
		return createElement("div", { "data-testid": "select" });
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
		createFileRoute: () => (opts: Record<string, unknown>) => ({
			options: opts,
			useLoaderData: () => mocks.loaderData.current,
		}),
	};
});

import { isRedirect } from "@tanstack/react-router";

import { Route } from "./routes/select.tsx";

const options = (
	Route as unknown as { options: { loader: () => Promise<unknown>; component: () => ReactElement } }
).options;

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("/doctors/select", () => {
	it("loads the profile context with the locale", async () => {
		const context = { profiles: [{ doctorId: 1 }], activeDoctorId: 1 };
		mocks.doctorContextFn.mockResolvedValue(context);
		await expect(options.loader()).resolves.toEqual({ ...context, locale: "pt-BR" });
	});

	it("sends anonymous visitors to /login", async () => {
		mocks.doctorContextFn.mockResolvedValue(null);
		const caught = await options.loader().catch((e: unknown) => e);
		expect(isRedirect(caught)).toBe(true);
		expect((caught as Response & { options: { to: string } }).options.to).toBe("/login");
	});

	it("sends an account with no doctor profile home", async () => {
		mocks.doctorContextFn.mockResolvedValue({ profiles: [], activeDoctorId: null });
		const caught = await options.loader().catch((e: unknown) => e);
		expect(isRedirect(caught)).toBe(true);
		expect((caught as Response & { options: { to: string } }).options.to).toBe("/");
	});

	it("wires the view to the server fns and reloads home when done", async () => {
		const assign = vi.fn<(url: string) => void>();
		vi.stubGlobal("location", { assign });
		const profiles = [{ doctorId: 4 }];
		mocks.loaderData.current = { profiles, activeDoctorId: null, locale: "en" };
		render(createElement(options.component));
		const props = mocks.props.current as {
			profiles: unknown[];
			activeDoctorId: number | null;
			locale: string;
			api: Record<string, (id: number) => Promise<unknown>>;
			onDone(): void;
		};
		expect(props).toMatchObject({ profiles, activeDoctorId: null, locale: "en" });
		// Selecting is all the chooser can do — it creates no profiles.
		expect(Object.keys(props.api)).toEqual(["select"]);
		await props.api.select!(4);
		expect(mocks.selectDoctorFn).toHaveBeenCalledWith({ data: 4 });
		props.onDone();
		expect(assign).toHaveBeenCalledWith("/");
	});
});
