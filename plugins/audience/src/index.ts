import { definePlugin, type Plugin } from "@ktb/kernel";

import { AudienceLanding } from "./landing.tsx";

/**
 * Server-registry mirror of ./client.ts — the audience plugin is a single
 * client-side contribution (`landing.page`), so both entries declare the
 * same plugin object shape; parity is asserted by
 * apps/web/src/plugins.test.ts. Audience helpers are re-exported for the
 * host route (`validateAudienceSearch`).
 */
export const audienceLandingPlugin = definePlugin({
	id: "audience.landing",
	landing: { page: AudienceLanding },
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [audienceLandingPlugin];

export * from "./audience.ts";

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"audience.landing": true;
	}
}
