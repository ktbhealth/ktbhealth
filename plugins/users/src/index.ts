import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { count, desc, eq } from "drizzle-orm";
import { UserCogIcon } from "lucide-react";

import { user as users } from "@ktb/auth/schema";
import { consultations } from "@ktb/consultations/schema";
import { Db, type DbClient } from "@ktb/db";
import { definePlugin, type Plugin } from "@ktb/kernel";
import { patients } from "@ktb/patients/schema";
import { PlatformAdmin, platformAdminPlugin, platformPanelPlugin } from "@ktb/platform";
import type { Forbidden } from "@ktb/authz";
import { Query } from "@effect-server-utils/cqrs";
import { UsersQueries } from "./api.ts";

/** Repo-level user row: auth user fields plus aggregate counts. */
export type UserRow = typeof users.$inferSelect & {
	readonly patientCount: number;
	readonly consultationCount: number;
};

/** Console row: repo row plus the platform-admin flag resolved by the gate. */
export interface AdminUserRow extends UserRow {
	readonly isAdmin: boolean;
}

/**
 * Cross-owner user listing for the /platform console. Callers MUST have
 * passed the `PlatformAdmin` gate first — this repo function itself is
 * unauthenticated, like the other `*Users` helpers.
 */
export async function listAllUsers(db: DbClient): Promise<UserRow[]> {
	const [rows, patientCounts, consultationCounts] = await Promise.all([
		db.select().from(users).orderBy(desc(users.createdAt)),
		db.select({ ownerId: patients.ownerId, n: count() }).from(patients).groupBy(patients.ownerId),
		db
			.select({ userId: consultations.userId, n: count() })
			.from(consultations)
			.groupBy(consultations.userId),
	]);
	const patientsByOwner = new Map(patientCounts.map((r) => [r.ownerId, r.n]));
	const consultationsByUser = new Map(consultationCounts.map((r) => [r.userId, r.n]));
	return rows.map((u) => ({
		...u,
		patientCount: patientsByOwner.get(u.id) ?? 0,
		consultationCount: consultationsByUser.get(u.id) ?? 0,
	}));
}

/**
 * Users domain port — Effect service, swappable in tests. Today it only
 * exposes the admin-console listing; the `user` table itself is owned by
 * @ktb/auth (better-auth), so this plugin contributes no tables.
 */
export class Users extends Context.Service<
	Users,
	{
		/** Cross-owner listing for the /platform console — platform admins only. */
		readonly adminList: () => Effect.Effect<AdminUserRow[], Forbidden>;
	}
>()("@ktb/users/Users") {}

export const UsersLive = Layer.effect(
	Users,
	Effect.gen(function* () {
		const db = yield* Db;
		const platformAdmin = yield* PlatformAdmin;
		return Users.of({
			adminList: Effect.fn("Users.adminList")(function* () {
				// Platform gate first — fails Forbidden for non-admins and
				// for system contexts (null principal) alike.
				yield* platformAdmin.requireAdmin();
				const rows = yield* Effect.promise(() => listAllUsers(db));
				return yield* Effect.forEach(rows, (row) =>
					Effect.map(platformAdmin.isAdmin(row.email), (isAdmin) => ({ ...row, isAdmin })),
				);
			}),
		});
	}),
);

/** Cross-plugin query surface — raw user lookup for other plugins. */
export const UsersQueriesLive = Query.handlersOf(UsersQueries, {
	"users.get": ({ id }) =>
		Effect.gen(function* () {
			const db = yield* Db;
			const rows = yield* Effect.promise(() =>
				db
					.select({ id: users.id, email: users.email, name: users.name })
					.from(users)
					.where(eq(users.id, id))
					.limit(1),
			);
			return rows[0] ?? null;
		}),
});

export const usersServicesPlugin = definePlugin({
	id: "users.services",
	// adminList consumes the PlatformAdmin gate — the dep edge keeps the
	// platform module ordered (and discovered) before this plugin's layer.
	requiredDeps: [platformAdminPlugin.id],
	services: Layer.mergeAll(UsersLive, UsersQueriesLive),
});

// Panel (system console) contribution: /platform/users is mounted by
// the platform plugin's physical route subtree; this plugin only
// declares the sidebar entry. The dep edge orders it after the shell.
export const usersPanelPlugin = definePlugin({
	id: "users.panel",
	requiredDeps: [platformPanelPlugin.id],
	panel: {
		sidebar: [{ to: "/platform/users", label: "Users", icon: UserCogIcon, group: "Access" }],
	},
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [usersServicesPlugin, usersPanelPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"users.services": true;
		"users.panel": true;
	}
}
