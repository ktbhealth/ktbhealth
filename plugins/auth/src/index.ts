import { physical, route } from "@tanstack/virtual-file-routes";

import { definePlugin, type Plugin } from "@ktb/kernel";

import { SessionMenu } from "./chrome.tsx";

/**
 * Auth plugin (P-062 pilot): owns the credential surface that used to
 * live in the host — the better-auth catch-all `/api/auth/*` (moved
 * from apps/web/src/routes/api/auth.$.ts) and the `/login` page. Both
 * route modules live in THIS package and are mounted into the host's
 * virtual route tree here; the provider instance and the Captcha port
 * reach the api route through @ktb/server-fns (ServerRuntime
 * `authHandler` + `run`), so the plugin never imports the auth
 * adapter on the server side.
 *
 * `system: true` on every entry: auth is foundational — a disabled
 * auth plugin would strand every session — so PluginStates reports it
 * enabled unconditionally and rejects disable writes (P-062).
 */
export const authRoutesPlugin = definePlugin({
	id: "auth.routes",
	system: true,
	routes: [
		// Single-file page route: `route()` resolves the module path
		// relative to the host's routes directory, same as physical().
		route("login", "../../../../plugins/auth/src/routes/login.tsx"),
		// API subtree: every module in src/api-routes/ mounts under the
		// shared "/api" prefix (auth.$.ts → /api/auth/$).
		physical("/api", "../../../../plugins/auth/src/api-routes"),
	],
});

/**
 * Session chrome (merged from the retired plugins/session, P-062):
 * the app-shell session menu in `app.header.session` — sign-in link or
 * the account dropdown. System like the routes: the menu is part of
 * the auth surface and must never be disableable.
 */
export const authChromePlugin = definePlugin({
	id: "auth.chrome",
	system: true,
	chrome: [
		{
			id: "session.menu",
			region: "app.header.session",
			content: { kind: "component", component: SessionMenu },
		},
	],
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [authRoutesPlugin, authChromePlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"auth.routes": true;
		"auth.chrome": true;
	}
}
