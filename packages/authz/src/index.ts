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

/** Like `can`, but fails `Forbidden` instead of returning false. */
export const requireCan = (...args: Parameters<typeof can>) =>
	Effect.flatMap(can(...args), (ok) =>
		ok
			? Effect.void
			: Effect.fail(new Forbidden({ path: typeof args[0] === "string" ? args[0] : "~" })),
	);
