import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Rules } from "permix";
import { createPermix } from "permix/effect";

/** Entities + actions. Leaf actions use ActionSpec objects for dataType. */
type Def = {
	consultation: readonly [
		"create",
		{ name: "read"; type: { userId: string }; required: true },
		{ name: "update"; type: { userId: string }; required: true },
		{ name: "delete"; type: { userId: string }; required: true },
	];
	patient: readonly [
		"create",
		{ name: "read"; type: { ownerId: string }; required: true },
		{ name: "update"; type: { ownerId: string }; required: true },
		{ name: "delete"; type: { ownerId: string }; required: true },
	];
};

const { Tag: Authz, layer: authzLayer, check: can } = createPermix<Def>();

export { Authz, can };

/**
 * Request-scoped principal — who the current effect runs as.
 *
 * Bound per request by the composition root (`runAs` in @ktb/app-host).
 * The default `null` marks a system context (webhooks, bot channels,
 * background jobs): services that need a user MUST treat null as
 * unauthenticated and fail `Forbidden`; system-only methods (bot-token
 * paths verified out-of-band) deliberately do not consult it.
 *
 * `email` is the session email when the caller has one — env-allowlist
 * gates (e.g. @ktb/platform `PlatformAdmin.requireAdmin`) check it
 * against the bound principal rather than a caller-supplied argument.
 *
 * `actorId` is the signed-in user when it differs from `userId` — a
 * secretary acting on a doctor's behalf: authorization and data scope
 * follow `userId` (the doctor), audit trails record `actorId`. Absent
 * means the principal acts for themselves.
 */
export const Principal = Context.Reference<{
	readonly userId: string;
	readonly email?: string;
	readonly actorId?: string;
} | null>("@ktb/authz/Principal", { defaultValue: () => null });

/** Ownership rules for a principal. */
export const rulesFor = (userId: string): Rules<Def> => ({
	consultation: {
		create: true,
		read: (c) => c.userId === userId,
		update: (c) => c.userId === userId,
		delete: (c) => c.userId === userId,
	},
	patient: {
		create: true,
		read: (p) => p.ownerId === userId,
		update: (p) => p.ownerId === userId,
		delete: (p) => p.ownerId === userId,
	},
});

export const AuthzLive = (userId: string) => authzLayer(rulesFor(userId));

export class Forbidden extends Data.TaggedError("Forbidden")<{
	readonly path: string;
}> {}

const pathOf = (args: Parameters<typeof can>): string =>
	typeof args[0] === "string" ? args[0] : "~";

/** Like `can`, but fails `Forbidden` instead of returning false. */
export const requireCan = (...args: Parameters<typeof can>) =>
	Effect.flatMap(can(...args), (ok) =>
		ok ? Effect.void : Effect.fail(new Forbidden({ path: pathOf(args) })),
	);

/**
 * `can` bound to the current `Principal`: builds `AuthzLive` from the
 * principal's userId, so callers never pass rules around. Returns `false`
 * when no principal is bound (system context) and fails closed (`false`)
 * on permix configuration errors — deny, never crash, never allow.
 */
export const canAs = (...args: Parameters<typeof can>) =>
	Effect.flatMap(Principal, (principal) =>
		principal === null
			? Effect.succeed(false)
			: can(...args).pipe(
					Effect.provide(AuthzLive(principal.userId)),
					Effect.catch(() => Effect.succeed(false)),
				),
	);

/** Like `requireCan`, but bound to the current `Principal`. */
export const requireCanAs = (...args: Parameters<typeof can>) =>
	Effect.flatMap(canAs(...args), (ok) =>
		ok ? Effect.void : Effect.fail(new Forbidden({ path: pathOf(args) })),
	);

/**
 * Assert the bound principal exists and acts as `userId` — guards
 * parameters that name an owner directly (create/list calls where permix
 * has no entity to check). `path` is reported in the `Forbidden` error.
 */
export const requirePrincipalUser = (userId: string, path = "principal") =>
	Effect.flatMap(Principal, (principal) =>
		principal !== null && principal.userId === userId
			? Effect.void
			: Effect.fail(new Forbidden({ path })),
	);
