// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const platformAdminFn = vi.fn(async () => true);
const adminListPatientsFn = vi.fn(async () => [] as unknown[]);
const getSessionUserFn = vi.fn(
	async (): Promise<{ id: string; email: string; name: string } | null> => ({
		id: "u1",
		email: "a@x.com",
		name: "A",
	}),
);

vi.mock("#/lib/fns.ts", () => ({
	platformAdminFn: () => platformAdminFn(),
	adminListPatientsFn: () => adminListPatientsFn(),
	getSessionUserFn: () => getSessionUserFn(),
}));

let loaderData: unknown = [];
let pathname = "/platform";

beforeAll(() => {
	// jsdom has no matchMedia; the ui sidebar's useIsMobile needs it.
	window.matchMedia =
		window.matchMedia ??
		((query: string) =>
			({
				matches: false,
				media: query,
				onchange: null,
				addListener: () => {},
				removeListener: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: () => false,
			}) as MediaQueryList);
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	const React = await import("react");
	return {
		...actual,
		createFileRoute: () => (opts: Record<string, unknown>) => ({
			options: opts,
			useLoaderData: () => loaderData,
		}),
		useLocation: (opts?: { select?: (l: { pathname: string }) => unknown }) => {
			const loc = { pathname };
			return opts?.select ? opts.select(loc) : loc;
		},
		Link: (props: Record<string, unknown>) => {
			const { to, children, ...rest } = props;
			return React.createElement("a", { href: to as string, ...rest }, children as never);
		},
		Outlet: () => React.createElement("div", { "data-testid": "platform-outlet" }),
	};
});

import { Route as PlatformRoute } from "./platform.tsx";
import { Route as PlatformIndexRoute } from "./platform/index.tsx";
import { Route as PlatformPatientsRoute } from "./platform/patients.tsx";

const component = (route: unknown) =>
	(route as { options: { component: () => ReactElement } }).options.component;
const beforeLoad = (route: unknown) =>
	(route as { options: { beforeLoad?: () => Promise<unknown> } }).options.beforeLoad;

afterEach(() => {
	cleanup();
	pathname = "/platform";
	platformAdminFn.mockReset().mockResolvedValue(true);
	adminListPatientsFn.mockReset().mockResolvedValue([]);
	getSessionUserFn.mockReset().mockResolvedValue({ id: "u1", email: "a@x.com", name: "A" });
	loaderData = [];
});

describe("/platform layout", () => {
	it("renders sidebar items aggregated from plugin panel contributions", () => {
		render(createElement(component(PlatformRoute)));
		const platform = screen.getByRole("link", { name: "Platform" });
		const patients = screen.getByRole("link", { name: "Patients" });
		expect(platform.getAttribute("href")).toBe("/platform");
		expect(patients.getAttribute("href")).toBe("/platform/patients");
		expect(platform.hasAttribute("data-active")).toBe(true);
		expect(patients.hasAttribute("data-active")).toBe(false);
		expect(screen.getByTestId("platform-outlet")).toBeTruthy();
	});

	it("marks descendant routes active unless the item is exact", () => {
		pathname = "/platform/patients";
		render(createElement(component(PlatformRoute)));
		expect(screen.getByRole("link", { name: "Platform" }).hasAttribute("data-active")).toBe(false);
		expect(screen.getByRole("link", { name: "Patients" }).hasAttribute("data-active")).toBe(true);
	});

	it("beforeLoad redirects anonymous users to /login", async () => {
		getSessionUserFn.mockResolvedValue(null);
		// redirect({ to: "/login" }) surfaces as a 307 Response.
		await expect(beforeLoad(PlatformRoute)!()).rejects.toMatchObject({ status: 307 });
	});

	it("beforeLoad 404s signed-in non-admins", async () => {
		platformAdminFn.mockResolvedValue(false);
		await expect(beforeLoad(PlatformRoute)!()).rejects.toMatchObject({ isNotFound: true });
	});

	it("beforeLoad passes for admins", async () => {
		await expect(beforeLoad(PlatformRoute)!()).resolves.toBeUndefined();
	});
});

describe("/platform index", () => {
	it("renders the overview with registered plugins", () => {
		render(createElement(component(PlatformIndexRoute)));
		expect(screen.getByText("Platform")).toBeTruthy();
		expect(screen.getByText("platform.routes")).toBeTruthy();
		expect(screen.getByText("platform.panel")).toBeTruthy();
	});
});

describe("/platform/patients", () => {
	it("loads via adminListPatientsFn and renders rows", () => {
		loaderData = [
			{
				id: 7,
				ownerId: "u1",
				name: "Ana",
				createdAt: new Date("2026-11-01T10:00:00Z"),
				ownerEmail: "d@x.com",
				ownerName: "Dra",
			},
		];
		render(createElement(component(PlatformPatientsRoute)));
		expect(screen.getByText("Ana")).toBeTruthy();
		expect(screen.getByText("Dra")).toBeTruthy();
		expect(screen.getByText("u1")).toBeTruthy();
	});

	it("loader calls the admin server fn", () => {
		const loader = (
			PlatformPatientsRoute as unknown as {
				options: { loader: () => Promise<unknown> };
			}
		).options.loader;
		return loader().then(() => {
			expect(adminListPatientsFn).toHaveBeenCalled();
		});
	});
});
