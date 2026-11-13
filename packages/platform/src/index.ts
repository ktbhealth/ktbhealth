import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { physical, route } from "@tanstack/virtual-file-routes";

import { Forbidden, Principal } from "@ktb/authz";
import { definePlugin, type Plugin } from "@ktb/kernel";

const normalizeEmail = (email: string | null | undefined): string =>
	(email ?? "").trim().toLowerCase();

/**
 * Parse `PLATFORM_ADMIN_EMAILS` (comma-separated) into a normalized
 * lookup set. Empty/unset input yields an empty set — the gate then
 * denies everyone (fail closed).
 */
export const parsePlatformAdminEmails = (raw: string | null | undefined): ReadonlySet<string> => {
	const emails = new Set<string>();
	for (const part of (raw ?? "").split(",")) {
		const email = normalizeEmail(part);
		if (email) emails.add(email);
	}
	return emails;
};

export interface PlatformAdminShape {
	/** Allowlist check against a session email (UI gate). */
	readonly isAdmin: (email: string | null | undefined) => Effect.Effect<boolean>;
	/**
	 * Defense-in-depth check bound to the request `Principal`: fails
	 * `Forbidden` unless the principal's email is allowlisted. Domain
	 * services call this directly so admin paths stay closed even when
	 * reached without the route guard.
	 */
	readonly requireAdmin: () => Effect.Effect<void, Forbidden>;
}

/**
 * Platform admin gate (P-026 env-allowlist approach). Provided by the
 * composition root (`createApp` in @ktb/app-host) from
 * `PLATFORM_ADMIN_EMAILS` — it is host-composed config, not a plugin
 * layer, so `platform.admin` below is a marker plugin that exists for
 * `requiredDeps` ordering and the `PluginRegistry` id.
 */
export class PlatformAdmin extends Context.Service<PlatformAdmin, PlatformAdminShape>()(
	"@ktb/platform/PlatformAdmin",
) {}

/** Build the gate from a parsed allowlist. */
export const makePlatformAdminGate = (emails: ReadonlySet<string>): PlatformAdminShape => ({
	isAdmin: (email) => Effect.succeed(emails.has(normalizeEmail(email))),
	requireAdmin: () =>
		Effect.flatMap(Principal, (principal) =>
			principal !== null &&
			principal.email !== undefined &&
			emails.has(normalizeEmail(principal.email))
				? Effect.void
				: Effect.fail(new Forbidden({ path: "platform.admin" })),
		),
});

/** Marker plugin for the env-composed admin gate — see PlatformAdmin. */
export const platformAdminPlugin = definePlugin({
	id: "platform.admin",
	system: true,
});

// Route subtree composed into the host's virtualRouteConfig. `platform.tsx`
// is the console layout; `physical("", "platform")` mounts every module
// under the host's routes/platform/ directory as a child of the layout —
// feature plugins (e.g. patients) contribute console pages by dropping
// route modules there plus a `console.sidebar` chrome entry, without being able to
// import apps (arch lint).
export const platformRoutesPlugin = definePlugin({
	id: "platform.routes",
	system: true,
	routes: [route("platform", "platform.tsx", [physical("", "platform")])],
});

export const platformPanelPlugin = definePlugin({
	id: "platform.panel",
	system: true,
	requiredDeps: [platformRoutesPlugin.id],
	// No sidebar entry of its own — the dashboard plugin owns the
	// /platform landing item; this plugin is the dep anchor other
	// panel plugins order after.
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	platformAdminPlugin,
	platformRoutesPlugin,
	platformPanelPlugin,
];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"platform.admin": true;
		"platform.routes": true;
		"platform.panel": true;
	}
}
