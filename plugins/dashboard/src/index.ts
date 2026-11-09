import * as Effect from "effect/Effect";
import { Option } from "effect";

import { Principal } from "@ktb/authz";
import {
	Consultations,
	consultationsServicesPlugin,
	type AdminConsultationRow,
} from "@ktb/consultations";
import { definePlugin, type Plugin } from "@ktb/kernel";
import { Notifications, notificationsServicesPlugin, rowToConsole } from "@ktb/notifications";
import { Patients, patientsServicesPlugin, type AdminPatientRow } from "@ktb/patients";
import { platformPanelPlugin } from "@ktb/platform";
import { LayoutDashboardIcon } from "lucide-react";

import { DashboardPlatformPage } from "./platform-page.tsx";

/**
 * Loader for the /platform index page (P-050): aggregates the same
 * data the retired route loader fetched via server fns — cross-owner
 * patient/consultation listings plus the session user's notification
 * activity. The admin gate lives in the /platform layout's beforeLoad
 * and inside each service's adminList; Forbidden collapses to the same
 * empty tables the old fns returned. Notifications are optional: the
 * console-activity card hides entirely when the backend plugin is not
 * registered (feature absent ≠ empty).
 */
const dashboardLoader = () =>
	Effect.gen(function* () {
		const patients = yield* Patients;
		const consultations = yield* Consultations;
		const [patientRows, consultationRows] = yield* Effect.all([
			patients
				.adminList()
				.pipe(Effect.catchTag("Forbidden", () => Effect.succeed([] as AdminPatientRow[]))),
			consultations
				.adminList()
				.pipe(Effect.catchTag("Forbidden", () => Effect.succeed([] as AdminConsultationRow[]))),
		]);

		const notifications = yield* Effect.serviceOption(Notifications);
		const principal = yield* Principal;
		if (Option.isNone(notifications) || principal === null) {
			return {
				patients: patientRows,
				consultations: consultationRows,
				notifications: undefined,
				unreadCount: undefined,
			};
		}
		const [rows, unreadCount] = yield* Effect.all([
			notifications.value
				.list(principal.userId, 50)
				.pipe(Effect.map((list) => list.map(rowToConsole))),
			notifications.value.unreadCount(principal.userId),
		]);
		return {
			patients: patientRows,
			consultations: consultationRows,
			notifications: rows,
			unreadCount,
		};
	});

// Panel (system console) contribution: the console landing page
// (/platform) is dispatched by the host's generic panel.pages route;
// this plugin declares the sidebar entry that owns it plus the page
// descriptor. The service dep edges order the listing sources (and
// keep them discovered); notifications stays optional because the
// backend may be absent.
export const dashboardPanelPlugin = definePlugin({
	id: "dashboard.panel",
	requiredDeps: [platformPanelPlugin.id, patientsServicesPlugin.id, consultationsServicesPlugin.id],
	optionalDeps: [notificationsServicesPlugin.id],
	panel: {
		sidebar: [
			{
				to: "/platform",
				label: "Dashboard",
				icon: LayoutDashboardIcon,
				exact: true,
			},
		],
		pages: [
			{
				id: "dashboard.home",
				path: "/platform",
				component: DashboardPlatformPage,
				loader: dashboardLoader,
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [dashboardPanelPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"dashboard.panel": true;
	}
}
