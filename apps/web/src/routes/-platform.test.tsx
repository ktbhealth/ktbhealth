// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const platformAdminFn = vi.fn(async () => true);
const adminListPatientsFn = vi.fn(async () => [] as unknown[]);
const adminListUsersFn = vi.fn(async () => [] as unknown[]);
const adminListGroupsFn = vi.fn(async () => [] as unknown[]);
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
	adminListConsultationsFn: () => adminListConsultationsFn(),
	adminListUsersFn: () => adminListUsersFn(),
	adminListGroupsFn: () => adminListGroupsFn(),
	getSessionUserFn: () => getSessionUserFn(),
}));

const adminListConsultationsFn = vi.fn(async () => [] as unknown[]);
let loaderData: unknown = { patients: [], consultations: [] };
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
		getRouteApi: () => ({
			useLoaderData: () => ({ id: "u1", email: "admin@ktb.test", name: "Admin" }),
		}),
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
import { Route as PlatformUsersRoute } from "./platform/users.tsx";
import { Route as PlatformGroupsRoute } from "./platform/groups.tsx";

const component = (route: unknown) =>
	(route as { options: { component: () => ReactElement } }).options.component;
const beforeLoad = (route: unknown) =>
	(route as { options: { beforeLoad?: () => Promise<unknown> } }).options.beforeLoad;

afterEach(() => {
	cleanup();
	pathname = "/platform";
	platformAdminFn.mockReset().mockResolvedValue(true);
	adminListPatientsFn.mockReset().mockResolvedValue([]);
	adminListConsultationsFn.mockReset().mockResolvedValue([]);
	adminListUsersFn.mockReset().mockResolvedValue([]);
	adminListGroupsFn.mockReset().mockResolvedValue([]);
	getSessionUserFn.mockReset().mockResolvedValue({ id: "u1", email: "a@x.com", name: "A" });
	loaderData = { patients: [], consultations: [] };
});

describe("/platform layout", () => {
	// The layout's Route.useLoaderData is the /platform loader — an array of
	// consultation rows fed to jobsFromAudioRows (jobs plugin, d7922a1).
	beforeEach(() => {
		loaderData = [];
	});

	it("renders sidebar items aggregated from plugin panel contributions", () => {
		render(createElement(component(PlatformRoute)));
		const platform = screen
			.getAllByRole("link", { name: "Dashboard" })
			.find((el) => el.getAttribute("href") === "/platform")!;
		const patients = screen
			.getAllByRole("link", { name: "Patients" })
			.find((el) => el.getAttribute("href") === "/platform/patients")!;
		expect(platform.getAttribute("href")).toBe("/platform");
		expect(patients.getAttribute("href")).toBe("/platform/patients");
		expect(platform.hasAttribute("data-active")).toBe(true);
		expect(patients.hasAttribute("data-active")).toBe(false);
		expect(screen.getByTestId("platform-outlet")).toBeTruthy();
	});

	it("marks descendant routes active unless the item is exact", () => {
		pathname = "/platform/patients";
		render(createElement(component(PlatformRoute)));
		// BreadcrumbPage also renders role="link" — select sidebar items
		// by href + data-active instead of accessible name.
		const sidebarLink = (href: string) =>
			screen
				.getAllByRole("link")
				.find((el) => el.getAttribute("href") === href && el.hasAttribute("data-active"));
		expect(sidebarLink("/platform")).toBeUndefined();
		expect(sidebarLink("/platform/patients")).toBeTruthy();
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
	it("renders the dashboard with registered plugins", () => {
		render(createElement(component(PlatformIndexRoute)));
		expect(screen.getByText("dashboard")).toBeTruthy();
		expect(screen.getByText("platform.routes")).toBeTruthy();
		expect(screen.getByText("platform.panel")).toBeTruthy();
		expect(screen.getByText("dashboard.panel")).toBeTruthy();
	});

	it("loader calls both admin list fns", () => {
		const loader = (
			PlatformIndexRoute as unknown as {
				options: { loader: () => Promise<unknown> };
			}
		).options.loader;
		return loader().then(() => {
			expect(adminListPatientsFn).toHaveBeenCalled();
			expect(adminListConsultationsFn).toHaveBeenCalled();
		});
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

describe("/platform/users", () => {
	it("loads via adminListUsersFn and renders rows", () => {
		loaderData = [
			{
				id: "u9",
				name: "Admin",
				email: "admin@ktb.test",
				emailVerified: true,
				image: null,
				createdAt: new Date("2026-11-01T10:00:00Z"),
				updatedAt: new Date("2026-11-01T10:00:00Z"),
				patientCount: 2,
				consultationCount: 5,
				isAdmin: true,
			},
		];
		render(createElement(component(PlatformUsersRoute)));
		expect(screen.getByText("admin@ktb.test")).toBeTruthy();
		expect(screen.getByText("admin")).toBeTruthy();
	});

	it("loader calls the admin server fn", () => {
		const loader = (
			PlatformUsersRoute as unknown as {
				options: { loader: () => Promise<unknown> };
			}
		).options.loader;
		return loader().then(() => {
			expect(adminListUsersFn).toHaveBeenCalled();
		});
	});
});

describe("/platform/groups", () => {
	it("loads via adminListGroupsFn and renders rows", () => {
		loaderData = [
			{
				id: 3,
				name: "Clinic A",
				slug: "clinic-a",
				kind: "clinic",
				meta: null,
				createdAt: new Date("2026-11-01T10:00:00Z"),
				updatedAt: new Date("2026-11-01T10:00:00Z"),
				memberCount: 4,
			},
		];
		render(createElement(component(PlatformGroupsRoute)));
		expect(screen.getByText("Clinic A")).toBeTruthy();
		expect(screen.getByText("clinic-a")).toBeTruthy();
	});

	it("loader calls the admin server fn", () => {
		const loader = (
			PlatformGroupsRoute as unknown as {
				options: { loader: () => Promise<unknown> };
			}
		).options.loader;
		return loader().then(() => {
			expect(adminListGroupsFn).toHaveBeenCalled();
		});
	});
});
