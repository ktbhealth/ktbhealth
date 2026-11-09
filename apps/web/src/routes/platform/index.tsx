import { createFileRoute } from "@tanstack/react-router";

import { DashboardPage } from "@ktb/dashboard/views";
import {
	adminListConsultationsFn,
	adminListPatientsFn,
	countMyUnreadNotificationsFn,
	listMyNotificationsFn,
} from "#/lib/fns.ts";
import { plugins } from "#/plugins.ts";

// Console-activity card data is only fetched when the notifications
// backend plugin is registered — DashboardPage hides the section
// entirely when `notifications` is undefined (feature absent ≠ empty).
const hasNotifications = plugins.some((p) => p.id === "notifications.services");

export const Route = createFileRoute("/platform/")({
	loader: async () => {
		const [patients, consultations, notifications, unreadCount] = await Promise.all([
			adminListPatientsFn(),
			adminListConsultationsFn(),
			hasNotifications ? listMyNotificationsFn() : Promise.resolve(undefined),
			hasNotifications ? countMyUnreadNotificationsFn() : Promise.resolve(undefined),
		]);
		return { patients, consultations, notifications, unreadCount };
	},
	component: function PlatformIndexRoute() {
		const { patients, consultations, notifications, unreadCount } = Route.useLoaderData();
		return (
			<DashboardPage
				patients={patients}
				consultations={consultations}
				plugins={plugins}
				notifications={notifications}
				unreadCount={unreadCount}
			/>
		);
	},
});
