import { definePlugin, type Plugin } from "@ktb/kernel";

import { SessionMenu } from "./chrome.tsx";

/**
 * Session chrome plugin (P-060): the app-shell session menu in
 * `app.header.session` — sign-in link or the account dropdown. Mirrors
 * ./client.ts (the client-discovery manifest); parity is asserted by
 * apps/web/src/plugins.test.ts.
 */
export const sessionChromePlugin = definePlugin({
	id: "session.chrome",
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
export const plugins: readonly Plugin[] = [sessionChromePlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"session.chrome": true;
	}
}
