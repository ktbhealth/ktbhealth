import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { groups } from "@ktb/groups/schema";
import { tenantIdColumn } from "@ktb/tenant/schema";

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
		tenantId: tenantIdColumn().references(() => groups.id, { onDelete: "set null" }),
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
