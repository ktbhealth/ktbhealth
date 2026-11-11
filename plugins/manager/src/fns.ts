import { createServerFn } from "@tanstack/react-start";

import { ensureSessionUser, getSessionUser, runAs } from "@ktb/server-fns";
import { PlatformAdmin } from "@ktb/platform";
import { PluginStates } from "@ktb/platform/plugin-states";
import * as Effect from "effect/Effect";
import { Schema } from "effect";

// Plugin manager server functions (P-058): every handler is
// PlatformAdmin-gated — the /platform layout already 404s non-admins,
// and the service calls re-check inside `runAs` (defense in depth, same
// pattern as platformAdminFn). State reads/writes go through the
// PluginStates service, which validates ids against the discovered
// registry and enforces the requiredDeps invariant on every write.

/** Run `eff` as the session user after the PlatformAdmin gate. */
const asAdmin = <A, E>(
	user: { readonly id: string; readonly email?: string },
	eff: Effect.Effect<A, E, unknown>,
): Promise<A> =>
	runAs(
		user,
		Effect.gen(function* () {
			const platformAdmin = yield* PlatformAdmin;
			yield* platformAdmin.requireAdmin();
			return yield* eff;
		}),
	);

/**
 * Every registry-known plugin with its resolved state (enabled +
 * merged config) — the /platform/plugins page's server-side half. The
 * structural half (meta, deps, contribution kinds) comes from the
 * client registry via `ctx.plugins`. `null` for non-admins.
 */
// Wire shapes: `config` is plugin-defined JSON — `any` keeps the
// TanStack serializable check satisfied (same escape as the platform
// page loader results).
export interface PluginStateWire {
	readonly pluginId: string;
	readonly enabled: boolean;
	readonly config: any;
}

export const listPluginStatesFn = createServerFn({ method: "GET" }).handler(
	async (): Promise<readonly PluginStateWire[] | null> => {
		const user = await getSessionUser();
		if (!user) return null;
		return asAdmin(
			user,
			Effect.gen(function* () {
				const states = yield* PluginStates;
				return yield* states.entries();
			}),
		).catch((error: unknown) => {
			if (typeof error === "object" && error !== null && "_tag" in error) {
				if ((error as { _tag?: string })._tag === "Forbidden") return null;
			}
			throw error;
		});
	},
);

const SetEnabledInput = Schema.Struct({
	ids: Schema.Array(Schema.String),
	enabled: Schema.Boolean,
});
const decodeSetEnabled = Schema.decodeUnknownSync(SetEnabledInput);

/**
 * Enable/disable plugins. `ids` is the cascade set the client confirmed
 * (the plugin plus its dependent closure when disabling); the service
 * re-validates ids and the post-write dep invariant server-side, so a
 * partial cascade is rejected rather than silently orphaning dependents.
 */
export const setPluginEnabledFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeSetEnabled(input))
	.handler(async ({ data }): Promise<boolean> => {
		const user = await ensureSessionUser();
		return asAdmin(
			user,
			Effect.gen(function* () {
				const states = yield* PluginStates;
				yield* states.setEnabled(data.ids, data.enabled);
				return true;
			}),
		).catch((error: unknown) => {
			if (typeof error === "object" && error !== null && "_tag" in error) {
				if ((error as { _tag?: string })._tag === "Forbidden") return false;
			}
			throw error;
		});
	});

const PluginIdInput = Schema.String;
const decodePluginId = Schema.decodeUnknownSync(PluginIdInput);

/** Merged config for one plugin (defaults + stored JSON); null when
 * the plugin is unknown or the caller is not an admin. */
export const getPluginConfigFn = createServerFn({ method: "GET" })
	.validator((input: unknown) => decodePluginId(input))
	.handler(async ({ data: pluginId }): Promise<any> => {
		const user = await getSessionUser();
		if (!user) return null;
		return asAdmin(
			user,
			Effect.gen(function* () {
				const states = yield* PluginStates;
				return yield* states.config(pluginId);
			}),
		).catch((error: unknown) => {
			if (typeof error === "object" && error !== null && "_tag" in error) {
				const tag = (error as { _tag?: string })._tag;
				if (tag === "Forbidden" || tag === "UnknownPlugin") return null;
			}
			throw error;
		});
	});

const SetConfigInput = Schema.Struct({
	pluginId: Schema.String,
	config: Schema.optionalKey(Schema.Unknown),
});
const decodeSetConfig = Schema.decodeUnknownSync(SetConfigInput);

/** Schema-validated config write; `false` for non-admins, throws
 * `InvalidPluginConfig`/`UnknownPlugin` details for bad input. */
export const setPluginConfigFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeSetConfig(input))
	.handler(async ({ data }): Promise<boolean> => {
		const user = await ensureSessionUser();
		return asAdmin(
			user,
			Effect.gen(function* () {
				const states = yield* PluginStates;
				yield* states.setConfig(data.pluginId, data.config);
				return true;
			}),
		).catch((error: unknown) => {
			if (typeof error === "object" && error !== null && "_tag" in error) {
				if ((error as { _tag?: string })._tag === "Forbidden") return false;
			}
			throw error;
		});
	});
