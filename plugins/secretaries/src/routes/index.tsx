import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import { SecretariesPage, type SecretariesApi } from "../views/index.ts";
import {
	inviteSecretaryFn,
	listSecretariesFn,
	localeFn,
	revokeSecretaryFn,
	sessionUserFn,
} from "../fns.ts";

const api: SecretariesApi = {
	invite: (email) => inviteSecretaryFn({ data: { email } }),
	revoke: (id) => revokeSecretaryFn({ data: id }),
};

// A doctor's secretaries: who may act on their behalf. Only the doctor
// themself manages this list — anonymous visitors go to /login, accounts
// without a doctor profile of their own to the profile chooser.
export const Route = createFileRoute("/secretaries/")({
	beforeLoad: async () => {
		if (!(await sessionUserFn())) throw redirect({ to: "/login" });
	},
	loader: async () => {
		const [secretaries, locale] = await Promise.all([listSecretariesFn(), localeFn()]);
		if (secretaries === null) throw redirect({ to: "/doctors/select" });
		return { secretaries, locale };
	},
	component: function SecretariesRoute() {
		const { secretaries, locale } = Route.useLoaderData();
		const router = useRouter();
		return (
			<SecretariesPage
				secretaries={secretaries}
				locale={locale}
				api={api}
				onChanged={() => void router.invalidate()}
			/>
		);
	},
});
