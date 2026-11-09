import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { LayoutDashboardIcon } from "lucide-react";

import { Forbidden, Principal } from "@ktb/authz";

import { platformPanelPlugin } from "@ktb/platform";
import { Consultations, consultationsServicesPlugin } from "@ktb/consultations";
import { Notifications, notificationsServicesPlugin } from "@ktb/notifications";
import { Patients, patientsServicesPlugin } from "@ktb/patients";
import type { Plugin } from "@ktb/kernel";

import { dashboardPanelPlugin, plugins } from "./index.ts";

describe("dashboardPanelPlugin", () => {
	it("declares the ungrouped /platform sidebar entry", () => {
		expect(dashboardPanelPlugin.id).toBe("dashboard.panel");
		expect(dashboardPanelPlugin.requiredDeps).toEqual([
			platformPanelPlugin.id,
			patientsServicesPlugin.id,
			consultationsServicesPlugin.id,
		]);
		expect(dashboardPanelPlugin.optionalDeps).toEqual([notificationsServicesPlugin.id]);
		expect(dashboardPanelPlugin.panel?.sidebar).toEqual([
			{
				to: "/platform",
				label: "Dashboard",
				icon: LayoutDashboardIcon,
				exact: true,
			},
		]);
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual(["dashboard.panel"]);
		const p: Plugin = dashboardPanelPlugin;
		expect("panel" in p && p.panel.sidebar?.[0]?.group).toBeUndefined();
	});
});

type Loader = () => Effect.Effect<unknown, never, Patients | Consultations>;

const loader = (): Loader => {
	const page = dashboardPanelPlugin.panel?.pages?.[0];
	if (!page || !("loader" in page) || !page.loader) throw new Error("dashboard page has no loader");
	return page.loader as unknown as Loader;
};

const patientRows = [{ id: 1, name: "Ana" }];
const consultationRows = [{ id: 2 }];

const listings = (opts: { forbidden?: boolean } = {}) =>
	Layer.mergeAll(
		Layer.succeed(Patients, {
			adminList: () =>
				opts.forbidden ? Effect.fail(new Forbidden({ path: "x" })) : Effect.succeed(patientRows),
		} as never),
		Layer.succeed(Consultations, {
			adminList: () =>
				opts.forbidden
					? Effect.fail(new Forbidden({ path: "x" }))
					: Effect.succeed(consultationRows),
		} as never),
	);

const notificationsLive = Layer.succeed(Notifications, {
	list: (_userId: string, limit?: number) =>
		Effect.succeed([
			{ id: 5, userId: "u1", kind: "k", title: `T${limit}`, body: null, readAt: null },
		]),
	unreadCount: () => Effect.succeed(3),
} as never);

const runLoader = (opts: {
	forbidden?: boolean;
	notifications?: boolean;
	principal: { userId: string } | null;
}) =>
	Effect.runPromise(
		loader()().pipe(
			Effect.provide(
				opts.notifications ? Layer.merge(listings(opts), notificationsLive) : listings(opts),
			),
			Effect.provideService(Principal, opts.principal),
		) as Effect.Effect<unknown>,
	);

describe("dashboard loader", () => {
	it("collapses Forbidden to empty tables and hides the activity card without notifications", async () => {
		await expect(runLoader({ forbidden: true, principal: null })).resolves.toEqual({
			patients: [],
			consultations: [],
			notifications: undefined,
			unreadCount: undefined,
		});
	});

	it("omits notifications when the backend is registered but nobody is signed in", async () => {
		await expect(runLoader({ notifications: true, principal: null })).resolves.toMatchObject({
			patients: patientRows,
			consultations: consultationRows,
			notifications: undefined,
			unreadCount: undefined,
		});
	});

	it("omits notifications when the backend plugin is absent even with a principal", async () => {
		await expect(runLoader({ principal: { userId: "u1" } })).resolves.toMatchObject({
			notifications: undefined,
			unreadCount: undefined,
		});
	});

	it("adds the session user's recent notifications and unread count", async () => {
		await expect(runLoader({ notifications: true, principal: { userId: "u1" } })).resolves.toEqual({
			patients: patientRows,
			consultations: consultationRows,
			notifications: [{ id: "5", title: "T50", description: undefined, read: false, meta: "k" }],
			unreadCount: 3,
		});
	});
});
