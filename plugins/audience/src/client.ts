import { definePlugin, type Plugin } from "@ktb/kernel";

import { AudienceLanding } from "./landing.tsx";

/**
 * Client-safe plugin entry — discovered by the browser bundle through
 * `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). Single contribution: the whole
 * audience landing page at "/" (`landing.page`). No server-side
 * contributions, so ./index.ts simply re-exports this module. Keep in
 * sync — parity is asserted by apps/web/src/plugins.test.ts.
 */
export const audienceLandingPlugin = definePlugin({
	id: "audience.landing",
	landing: { page: AudienceLanding },
});

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [audienceLandingPlugin];
