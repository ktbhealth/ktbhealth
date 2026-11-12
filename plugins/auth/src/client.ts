import { definePlugin, type Plugin } from "@ktb/kernel";

import { SessionMenu } from "./chrome.tsx";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). The routes contribution degrades to
 * a marker (it is only consumed by route typegen); the chrome entry is
 * the session menu the browser actually renders. Dep/system fields
 * mirror the server manifest — parity is asserted by
 * apps/web/src/plugins.test.ts.
 */
export const authRoutesPlugin = definePlugin({
	id: "auth.routes",
	system: true,
});

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

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [authRoutesPlugin, authChromePlugin];
