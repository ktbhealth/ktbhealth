// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useContext, type ReactElement } from "react";
import { NotificationsActionsContext, type NotificationsActions } from "@ktb/notifications/context";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const platformAdminFn = vi.fn(async () => true);
const platformPageDataFn = vi.fn(
	async (_path: string): Promise<{ status: string; data?: unknown }> => ({
		status: "ok",
		data: null,
	}),
);
const adminListAudioJobsFn = vi.fn(async () => [] as unknown[]);
const countMyUnreadNotificationsFn = vi.fn(async () => 0);
const markMyNotificationsReadFn = vi.fn(async (_arg?: unknown) => true);
const markAllMyNotificationsReadFn = vi.fn(async () => true);
const getSessionUserFn = vi.fn(
	async (): Promise<{ id: string; email: string; name: string } | null> => ({
		id: "u1",
		email: "a@x.com",
		name: "A",
	}),
);
const listMyNotificationsFn = vi.fn(async () => [] as unknown[]);
const signOut = vi.fn(async () => {});

vi.mock("@ktb/auth-better/client", () => ({ authClient: { signOut: () => signOut() } }));

vi.mock("#/lib/fns.ts", () => ({
	platformAdminFn: () => platformAdminFn(),
	platformPageDataFn: (arg: { data: string }) => platformPageDataFn(arg.data),
	adminListAudioJobsFn: () => adminListAudioJobsFn(),
	listMyNotificationsFn: () => listMyNotificationsFn(),
	countMyUnreadNotificationsFn: () => countMyUnreadNotificationsFn(),
	markMyNotificationsReadFn: (arg: unknown) => markMyNotificationsReadFn(arg),
	markAllMyNotificationsReadFn: () => markAllMyNotificationsReadFn(),
	getSessionUserFn: () => getSessionUserFn(),
}));

let loaderData: unknown = { patients: [], consultations: [] };
let pathname = "/platform";
let pageParam = "patients";
// When set, replaces the <Outlet /> stub so a test can read context values.
let outletChild: (() => ReactElement | null) | null = null;

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
			useParams: () => ({ _splat: pageParam }),
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
		Outlet: () =>
			outletChild
				? React.createElement(outletChild)
				: React.createElement("div", { "data-testid": "platform-outlet" }),
	};
});

import { Route as PlatformRoute } from "./platform.tsx";
import { Route as PlatformIndexRoute } from "./platform/index.tsx";
import { Route as PlatformPageRoute } from "./platform/$.tsx";
import { platformPages } from "#/lib/platform-pages.ts";
import type { PanelPage } from "@ktb/kernel";

const component = (route: unknown) =>
	(route as { options: { component: () => ReactElement } }).options.component;
const beforeLoad = (route: unknown) =>
	(route as { options: { beforeLoad?: () => Promise<unknown> } }).options.beforeLoad;
const loader = (route: unknown) =>
	(
		route as {
			options: { loader: (arg?: { params?: { _splat: string } }) => Promise<unknown> };
		}
	).options.loader;

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	outletChild = null;
	signOut.mockClear();
	pathname = "/platform";
	pageParam = "patients";
	platformAdminFn.mockReset().mockResolvedValue(true);
	platformPageDataFn.mockReset().mockResolvedValue({ status: "ok", data: null });
	adminListAudioJobsFn.mockReset().mockResolvedValue([]);
	listMyNotificationsFn.mockReset().mockResolvedValue([]);
	countMyUnreadNotificationsFn.mockReset().mockResolvedValue(0);
	markMyNotificationsReadFn.mockReset().mockResolvedValue(true);
	markAllMyNotificationsReadFn.mockReset().mockResolvedValue(true);
	getSessionUserFn.mockReset().mockResolvedValue({ id: "u1", email: "a@x.com", name: "A" });
	loaderData = {
		patients: [],
		consultations: [],
		notifications: undefined,
		unreadCount: undefined,
	};
});

describe("/platform layout", () => {
	// The layout's Route.useLoaderData is the /platform loader —
	// { audioJobs, notifications } seeded into the jobs/notifications
	// header-action contexts.
	beforeEach(() => {
		loaderData = { audioJobs: [], notifications: [] };
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

	it("loader seeds the jobs and notifications feeds", async () => {
		adminListAudioJobsFn.mockResolvedValue([{ id: 1 }]);
		listMyNotificationsFn.mockResolvedValue([{ id: 2 }]);
		await expect(loader(PlatformRoute)!()).resolves.toEqual({
			audioJobs: [{ id: 1 }],
			notifications: [{ id: 2 }],
		});
	});

	it("injects mark-read actions for the notifications popover", async () => {
		let actions: NotificationsActions | null = null;
		outletChild = function Probe() {
			actions = useContext(NotificationsActionsContext);
			return null;
		};
		render(createElement(component(PlatformRoute)));
		await actions!.markRead([1, 2]);
		expect(markMyNotificationsReadFn).toHaveBeenCalledWith({ data: [1, 2] });
		await actions!.markAllRead();
		expect(markAllMyNotificationsReadFn).toHaveBeenCalledOnce();
	});

	it("signs out, then returns to the home page", async () => {
		const assign = vi.fn();
		vi.stubGlobal("location", { assign });
		render(createElement(component(PlatformRoute)));
		fireEvent.click(screen.getByTitle("Sign out"));
		await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
		expect(signOut).toHaveBeenCalledOnce();
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

	it("loader dispatches the /platform page descriptor", async () => {
		await loader(PlatformIndexRoute)!();
		expect(platformPageDataFn).toHaveBeenCalledWith("/platform");
	});
});

describe("/platform/$ splat dispatcher", () => {
	it("renders the patients page contributed by the patients plugin", () => {
		pageParam = "patients";
		loaderData = {
			patients: [
				{
					id: 7,
					ownerId: "u1",
					name: "Ana",
					createdAt: new Date("2026-11-01T10:00:00Z"),
					ownerEmail: "d@x.com",
					ownerName: "Dra",
				},
			],
			owners: [],
		};
		render(createElement(component(PlatformPageRoute)));
		expect(screen.getByText("Ana")).toBeTruthy();
		expect(screen.getByText("Dra")).toBeTruthy();
		expect(screen.getByText("u1")).toBeTruthy();
	});

	it("renders the users page contributed by the users plugin", () => {
		pageParam = "users";
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
		render(createElement(component(PlatformPageRoute)));
		expect(screen.getByText("admin@ktb.test")).toBeTruthy();
		expect(screen.getByText("admin")).toBeTruthy();
	});

	it("renders the groups page contributed by the groups plugin", () => {
		pageParam = "groups";
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
		render(createElement(component(PlatformPageRoute)));
		expect(screen.getByText("Clinic A")).toBeTruthy();
		expect(screen.getByText("clinic-a")).toBeTruthy();
	});

	it("renders the tenants page contributed by the tenant plugin", () => {
		pageParam = "tenants";
		loaderData = [
			{
				id: 4,
				name: "Clinic B",
				slug: "clinic-b",
				kind: "clinic",
				meta: null,
				createdAt: new Date("2026-11-01T10:00:00Z"),
				updatedAt: new Date("2026-11-01T10:00:00Z"),
				memberCount: 2,
			},
		];
		render(createElement(component(PlatformPageRoute)));
		expect(screen.getByText("Clinic B")).toBeTruthy();
		expect(screen.getByText("clinic-b")).toBeTruthy();
	});

	it("loader resolves the descriptor path and calls the data fn", async () => {
		await loader(PlatformPageRoute)!({ params: { _splat: "patients" } });
		expect(platformPageDataFn).toHaveBeenCalledWith("/platform/patients");
	});

	it("loader resolves nested splat paths against the registry", async () => {
		// No shipped plugin owns a nested path — register a throwaway
		// descriptor so the splat lookup has something to find.
		const pages = platformPages as unknown as Map<string, PanelPage>;
		pages.set("/platform/foo/bar", {
			id: "test.nested",
			path: "/platform/foo/bar",
			component: () => null,
		});
		try {
			await loader(PlatformPageRoute)!({ params: { _splat: "foo/bar" } });
			expect(platformPageDataFn).toHaveBeenCalledWith("/platform/foo/bar");
		} finally {
			pages.delete("/platform/foo/bar");
		}
	});

	it("loader 404s segments no plugin owns", async () => {
		await expect(loader(PlatformPageRoute)!({ params: { _splat: "nope" } })).rejects.toMatchObject({
			isNotFound: true,
		});
		expect(platformPageDataFn).not.toHaveBeenCalled();
	});

	it("loader 404s when the data fn reports notfound (guard denial)", async () => {
		platformPageDataFn.mockResolvedValue({ status: "notfound" });
		await expect(
			loader(PlatformPageRoute)!({ params: { _splat: "patients" } }),
		).rejects.toMatchObject({ isNotFound: true });
	});
});
