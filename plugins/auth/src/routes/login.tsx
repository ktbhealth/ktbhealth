import { createPluginFileRoute } from "@ktb/server-fns";

import { localeFn } from "../fns.ts";
import { authMessages } from "../i18n.ts";
import { LoginPage } from "../views/LoginPage.tsx";

/**
 * /login — public sign-in/create-account page (moved from
 * apps/web/src/routes/login.tsx, P-062). The loader attaches the
 * active locale so the view resolves its own catalog (plugins cannot
 * import the host's Paraglide runtime); `head` uses the same data for
 * the localized document title. Gated on `auth.routes` enable state —
 * a system plugin, so the gate always passes.
 */
export const Route = createPluginFileRoute("auth.routes")("/login")({
	loader: () => localeFn(),
	head: ({ loaderData }) => ({
		meta: [{ title: authMessages(loaderData ?? "en").metaTitle }],
	}),
	component: function LoginRoute() {
		const locale = Route.useLoaderData();
		return <LoginPage locale={locale} />;
	},
});
