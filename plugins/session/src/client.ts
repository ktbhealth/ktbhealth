import { definePlugin, type Plugin } from "@ktb/kernel";

import { SessionMenu } from "./chrome.tsx";

/**
 * Client-safe plugin entry — discovered by the browser bundle through
 * `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). Single contribution: the app-shell
 * session menu in `app.header.session` (P-060) — sign-in link or the
 * account dropdown. No server-side contributions, so ./index.ts simply
 * re-exports this module. Keep in sync — parity is asserted by
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

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [sessionChromePlugin];
