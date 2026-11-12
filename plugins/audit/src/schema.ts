import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Relative import on purpose: `@ktb/groups` already depends on
// `@ktb/audit` (the Audit service groups mutations record through), so a
// package-specifier import of `@ktb/groups/schema` here would create a
// workspace package cycle. The schema subpath resolves to this same
// module, so the FK target is identical either way.
import { groups } from "../../groups/src/schema.ts";

/**
 * Platform admin audit log (T-037): one append-only row per
 * PlatformAdmin-gated mutation, written by the `Audit.record` port from
 * inside each admin service method. `action` is a dot-namespaced verb
 * ("users.suspend", "groups.member.add", "rbac.role.update");
 * `targetType`/`targetId` name what was mutated; `detail` is a JSON
 * payload of non-sensitive params (ids, flags — never secrets, tokens,
 * transcripts or PHI). `actorUserId`/`actorEmail` are denormalized off
 * the bound Principal at write time so the log survives account
 * deletion. `tenantId` is the tenant (`groups.id`) scope the action
 * belonged to — NULL for platform-global actions.
 *
 * Plugin-owned table definition (P-061): aggregated into the drizzle
 * schema by the generated packages/db/src/schema.gen.ts — consumers
 * keep importing it from `@ktb/db/schema` (or `@ktb/audit/schema`).
 * The `tenant_id` column is declared inline (`integer("tenant_id")`,
 * same shape as `@ktb/tenant`'s `tenantIdColumn`) because @ktb/tenant
 * depends on @ktb/db — importing it here would create a workspace cycle.
 */
export const adminAudit = sqliteTable(
	"admin_audit",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		actorUserId: text("actor_user_id"),
		actorEmail: text("actor_email"),
		action: text().notNull(),
		targetType: text("target_type"),
		targetId: text("target_id"),
		detail: text(),
		tenantId: integer("tenant_id").references(() => groups.id, { onDelete: "set null" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
	},
	(table) => [
		index("admin_audit_created_at_idx").on(table.createdAt),
		index("admin_audit_action_idx").on(table.action),
		index("admin_audit_actor_idx").on(table.actorUserId),
	],
);

export type AdminAudit = typeof adminAudit.$inferSelect;
