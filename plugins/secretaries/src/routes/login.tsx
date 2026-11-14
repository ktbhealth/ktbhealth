import { doctorContextFn } from "@ktb/doctors/fns";
import { createPluginFileRoute } from "@ktb/server-fns";

import { emailEnabledFn, localeFn } from "../fns.ts";
import { secretaryMessages } from "../i18n.ts";
import { SecretaryLoginPage, type SecretaryLoginApi } from "../views/index.ts";

const api: SecretaryLoginApi = {
	// Claims pending invites for the caller's verified email first, so a
	// freshly verified secretary sees the doctor right after signing in.
	context: () => doctorContextFn(),
};

/**
 * /secretaries/login — the staff entry point the invite email points
 * to. Sign-in leads to the doctor-profile chooser; sign-up creates a
 * plain account (never a doctor profile — unlike the doctor screen)
 * and waits on email verification for the delegation to activate.
 * Gated on `secretaries.routes` like the management page.
 */
export const Route = createPluginFileRoute("secretaries.routes")("/secretaries/login")({
	loader: async () => ({ locale: await localeFn(), emailEnabled: await emailEnabledFn() }),
	head: ({ loaderData }) => ({
		meta: [{ title: secretaryMessages(loaderData?.locale ?? "en").login.metaTitle }],
	}),
	component: function SecretaryLoginRoute() {
		const data = Route.useLoaderData();
		return (
			<SecretaryLoginPage
				locale={data?.locale ?? "en"}
				emailEnabled={data?.emailEnabled ?? false}
				api={api}
			/>
		);
	},
});
