import { definePlugin, type Plugin } from "@ktb/kernel";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client`. Services and routes degrade to
 * markers; ids are literals so the server graph never reaches the client
 * bundle. Keep in sync — parity is asserted by apps/web/src/plugins.test.ts.
 */
export const plugins: readonly Plugin[] = [
	definePlugin({ id: "patient-portal.services" }),
	definePlugin({ id: "patient-portal.routes" }),
];
