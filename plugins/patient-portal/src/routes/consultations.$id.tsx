import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { PortalConsultationPage } from "../views/index.ts";
import { localeFn, portalConsultationFn } from "../fns.ts";

// One consultation in the patient portal, read-only. Anonymous visitors
// go to the patient sign-in page; a consultation the signed-in person
// holds no active link to is a plain 404, like one that does not exist.
export const Route = createFileRoute("/portal/consultations/$id")({
	loader: async ({ params }) => {
		const [result, locale] = await Promise.all([
			portalConsultationFn({ data: Number(params.id) }),
			localeFn(),
		]);
		if (result.status === "anonymous") throw redirect({ to: "/portal/login" });
		if (result.status === "missing") throw notFound();
		return { consultation: result.consultation, locale };
	},
	component: function PortalConsultationRoute() {
		const { consultation, locale } = Route.useLoaderData();
		return <PortalConsultationPage consultation={consultation} locale={locale} />;
	},
});
