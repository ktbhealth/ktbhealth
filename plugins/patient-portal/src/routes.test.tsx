// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	portalFn: vi.fn(),
	portalConsultationFn: vi.fn(),
	selectPatientFn: vi.fn(async (_arg: { data: number }) => ({ ok: true })),
	setCpfFn: vi.fn(async (_arg: { data: string }) => ({ ok: true })),
	localeFn: vi.fn(async () => "pt-BR"),
	invalidate: vi.fn(),
	loaderData: { current: undefined as unknown },
	props: { current: undefined as Record<string, unknown> | undefined },
}));

vi.mock("./fns.ts", () => ({
	portalFn: mocks.portalFn,
	portalConsultationFn: mocks.portalConsultationFn,
	selectPatientFn: mocks.selectPatientFn,
	setCpfFn: mocks.setCpfFn,
	localeFn: mocks.localeFn,
}));
vi.mock("./views/index.ts", () => {
	const capture = (testId: string) => (props: Record<string, unknown>) => {
		mocks.props.current = props;
		return createElement("div", { "data-testid": testId });
	};
	return { PortalPage: capture("portal"), PortalConsultationPage: capture("consultation") };
});
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
		useRouter: () => ({ invalidate: mocks.invalidate }),
	};
});

import { isNotFound, isRedirect } from "@tanstack/react-router";

import { Route as ConsultationRoute } from "./routes/consultations.$id.tsx";
import { Route as HomeRoute } from "./routes/index.tsx";

type Options<LoaderArgs> = {
	loader: (args: LoaderArgs) => Promise<unknown>;
	component: () => ReactElement;
};
const home = (HomeRoute as unknown as { options: Options<void> }).options;
const detail = (ConsultationRoute as unknown as { options: Options<{ params: { id: string } }> })
	.options;

const redirectTarget = (caught: unknown) =>
	(caught as Response & { options: { to: string } }).options.to;

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("/portal", () => {
	const portal = {
		user: { name: "Ana", email: "ana@ktb.test" },
		hasCpf: true,
		awaitingInvites: 0,
		profiles: [{ patientId: 1 }],
		profile: { patientId: 1 },
		consultations: [{ id: 10 }],
	};

	it("loads the portal with the locale", async () => {
		mocks.portalFn.mockResolvedValue(portal);
		await expect(home.loader()).resolves.toEqual({ ...portal, locale: "pt-BR" });
	});

	it("sends anonymous visitors to the patient sign-in page", async () => {
		mocks.portalFn.mockResolvedValue(null);
		const caught = await home.loader().catch((e: unknown) => e);
		expect(isRedirect(caught)).toBe(true);
		expect(redirectTarget(caught)).toBe("/portal/login");
	});

	it("wires the view to the server fns and reloads after a change", async () => {
		mocks.loaderData.current = { ...portal, locale: "en" };
		render(createElement(home.component));
		const props = mocks.props.current as {
			api: { select(id: number): Promise<unknown>; setCpf(cpf: string): Promise<unknown> };
			onChanged(): void;
		};
		expect(props).toMatchObject({ ...portal, locale: "en" });
		await props.api.select(2);
		expect(mocks.selectPatientFn).toHaveBeenCalledWith({ data: 2 });
		await props.api.setCpf("52998224725");
		expect(mocks.setCpfFn).toHaveBeenCalledWith({ data: "52998224725" });
		props.onChanged();
		expect(mocks.invalidate).toHaveBeenCalledTimes(1);
	});
});

describe("/portal/consultations/$id", () => {
	const consultation = { id: 10, patientName: "Ana", sections: [] };
	const load = () => detail.loader({ params: { id: "10" } });

	it("loads the consultation with the locale", async () => {
		mocks.portalConsultationFn.mockResolvedValue({ status: "ok", consultation });
		await expect(load()).resolves.toEqual({ consultation, locale: "pt-BR" });
		expect(mocks.portalConsultationFn).toHaveBeenCalledWith({ data: 10 });
	});

	it("sends anonymous visitors to the patient sign-in page", async () => {
		mocks.portalConsultationFn.mockResolvedValue({ status: "anonymous" });
		const caught = await load().catch((e: unknown) => e);
		expect(isRedirect(caught)).toBe(true);
		expect(redirectTarget(caught)).toBe("/portal/login");
	});

	it("is a 404 for a consultation the user may not see", async () => {
		mocks.portalConsultationFn.mockResolvedValue({ status: "missing" });
		expect(isNotFound(await load().catch((e: unknown) => e))).toBe(true);
	});

	it("renders the read-only view — no server actions are wired", () => {
		mocks.loaderData.current = { consultation, locale: "en" };
		render(createElement(detail.component));
		expect(mocks.props.current).toEqual({ consultation, locale: "en" });
	});
});
