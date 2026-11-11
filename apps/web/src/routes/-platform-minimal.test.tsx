// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, useContext, type ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NotificationsActionsContext, type NotificationsActions } from "@ktb/notifications/context";

// A host that registers none of the optional header plugins: the layout
// must skip the jobs/notifications feeds and render no header actions.
const adminListAudioJobsFn = vi.fn(async () => [] as unknown[]);
const listMyNotificationsFn = vi.fn(async () => [] as unknown[]);

vi.mock("#/plugins.ts", () => ({ plugins: [] }));
vi.mock("#/lib/fns.ts", () => ({
	platformAdminFn: vi.fn(async () => true),
	adminListAudioJobsFn: () => adminListAudioJobsFn(),
	listMyNotificationsFn: () => listMyNotificationsFn(),
	markMyNotificationsReadFn: vi.fn(),
	markAllMyNotificationsReadFn: vi.fn(),
	getSessionUserFn: vi.fn(async () => ({ id: "u1", email: "a@x.com", name: "A" })),
	pluginStatesFn: vi.fn(async () => ({ enabled: [] as string[] })),
}));
vi.mock("@ktb/auth-better/client", () => ({ authClient: { signOut: vi.fn() } }));

let outletChild: (() => ReactElement | null) | null = null;

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	const React = await import("react");
	return {
		...actual,
		createFileRoute: () => (opts: Record<string, unknown>) => ({
			options: opts,
			useLoaderData: () => ({ audioJobs: [], notifications: [] }),
		}),
		useLocation: (opts?: { select?: (l: { pathname: string }) => unknown }) => {
			const loc = { pathname: "/platform" };
			return opts?.select ? opts.select(loc) : loc;
		},
		getRouteApi: () => ({
			useLoaderData: () => ({ user: null, pluginStates: { enabled: [] } }),
		}),
		Link: (props: Record<string, unknown>) => {
			const { to, children, ...rest } = props;
			return React.createElement("a", { href: to as string, ...rest }, children as never);
		},
		Outlet: () => (outletChild ? React.createElement(outletChild) : null),
	};
});

import { Route } from "./platform.tsx";

beforeAll(() => {
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

afterEach(() => {
	cleanup();
	outletChild = null;
	vi.clearAllMocks();
});

const options = (
	Route as unknown as {
		options: { loader: () => Promise<unknown>; component: () => ReactElement };
	}
).options;

describe("/platform without the optional header plugins", () => {
	it("loader skips the jobs and notifications queries", async () => {
		await expect(options.loader()).resolves.toEqual({ audioJobs: [], notifications: [] });
		expect(adminListAudioJobsFn).not.toHaveBeenCalled();
		expect(listMyNotificationsFn).not.toHaveBeenCalled();
	});

	it("renders the shell with no notification actions and the admin fallback label", () => {
		let actions: NotificationsActions | null | undefined;
		outletChild = function Probe() {
			actions = useContext(NotificationsActionsContext);
			return null;
		};
		render(createElement(options.component));
		expect(actions).toBeNull();
		expect(screen.getByText("admin")).toBeTruthy();
	});
});
