import { createPluginFileRoute } from "@ktb/server-fns";

import { emailEnabledFn, localeFn } from "../fns.ts";
import { authMessages } from "../i18n.ts";
import { LoginPage } from "../views/LoginPage.tsx";

/**
 * /login — public sign-in/create-account page (moved from
 * apps/web/src/routes/login.tsx, P-062). The loader attaches the
 * active locale so the view resolves its own catalog (plugins cannot
 * import the host's Paraglide runtime) plus whether this deployment
 * can send email, which the sign-up flow needs to pick the next step;
 * `head` uses the same data for the localized document title. Gated
 * on `auth.routes` enable state — a system plugin, so the gate
 * always passes.
 */
export const Route = createPluginFileRoute("auth.routes")("/login")({
	loader: async () => ({ locale: await localeFn(), emailEnabled: await emailEnabledFn() }),
	head: ({ loaderData }) => ({
		meta: [{ title: authMessages(loaderData?.locale ?? "en").metaTitle }],
	}),
	component: function LoginRoute() {
		const data = Route.useLoaderData();
		return <LoginPage locale={data?.locale ?? "en"} emailEnabled={data?.emailEnabled ?? false} />;
	},
});
