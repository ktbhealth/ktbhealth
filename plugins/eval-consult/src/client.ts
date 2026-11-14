import { definePlugin, type Plugin } from "@ktb/kernel";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). The eval.consult manifest carries no
 * client-visible contributions, so this is a bare id mirror; importing
 * ./index.ts would pull the domain graph (effect services, eta
 * templates) into the client bundle. Keep in sync — parity is asserted
 * by apps/web/src/plugins.test.ts.
 */
export const evalConsultPlugin = definePlugin({
	id: "eval.consult",
});

export const plugins: readonly Plugin[] = [evalConsultPlugin];
