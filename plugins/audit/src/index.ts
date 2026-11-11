import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { count, desc } from "drizzle-orm";
import { ScrollTextIcon } from "lucide-react";
import * as Option from "effect/Option";

import { Forbidden, Principal } from "@ktb/authz";
import { Db, type DbClient } from "@ktb/db";
import { definePlugin, type Plugin } from "@ktb/kernel";
import { PlatformAdmin, platformAdminPlugin, platformPanelPlugin } from "@ktb/platform";

import { AuditPlatformPage } from "./platform-page.tsx";
import { adminAudit, type AdminAudit } from "./schema.ts";

export type { AdminAudit };
export { adminAudit } from "./schema.ts";

/** Console row: the stored audit entry (detail stays raw JSON text —
 * the view parses it for display). */
export type AdminAuditRow = AdminAudit;

/** What a mutation reports to the audit log. `action` is a
 * dot-namespaced verb ("users.suspend"); `detail` must contain ids and
 * non-sensitive params only — never secrets, tokens, transcripts or
 * PHI. */
export interface AuditEntryInput {
	readonly action: string;
	readonly targetType?: string | null;
	readonly targetId?: string | number | null;
	readonly detail?: Readonly<Record<string, unknown>> | null;
	/** Tenant (`groups.id`) scope of the action — string|number accepted
	 * like the other tenant-id carriers; non-numeric values normalize to
	 * NULL rather than failing the write. */
	readonly tenantId?: string | number | null;
}

export interface AuditListResult {
	/** Newest-first page of entries (capped by `limit`). */
	readonly entries: readonly AdminAuditRow[];
	/** Total rows in the log — the page renders "latest N of total". */
	readonly total: number;
	readonly limit: number;
}

/** Detail payloads are ids/flags — cap the JSON so a caller cannot
 * smuggle an unbounded blob into the log. */
const DETAIL_MAX = 4000;

/** `tenant_id` columns hold `groups.id` integers; rbac subject rows
 * carry the same id as text — normalize both shapes, drop the rest. */
const normalizeTenantId = (value: string | number | null | undefined): number | null => {
	if (value === null || value === undefined) return null;
	if (typeof value === "number") return Number.isInteger(value) ? value : null;
	const n = Number(value);
	return value.trim() !== "" && Number.isInteger(n) ? n : null;
};

const serializeDetail = (detail: AuditEntryInput["detail"]): string | null => {
	if (detail === null || detail === undefined) return null;
	const json = JSON.stringify(detail);
	return json.length > DETAIL_MAX ? json.slice(0, DETAIL_MAX) : json;
};

/**
 * Append one audit row. Actor identity comes from the bound `Principal`
 * (null in system contexts — the columns are nullable for that case).
 * Returns the inserted row, or null when the driver yields no RETURNING
 * row.
 */
export async function insertAuditEntry(
	db: DbClient,
	entry: AuditEntryInput & {
		readonly actorUserId: string | null;
		readonly actorEmail: string | null;
	},
): Promise<AdminAudit | null> {
	const rows = await db
		.insert(adminAudit)
		.values({
			actorUserId: entry.actorUserId,
			actorEmail: entry.actorEmail,
			action: entry.action,
			targetType: entry.targetType ?? null,
			targetId: entry.targetId == null ? null : String(entry.targetId),
			detail: serializeDetail(entry.detail),
			tenantId: normalizeTenantId(entry.tenantId),
		})
		.returning();
	return rows[0] ?? null;
}

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;

/**
 * Newest-first audit listing for the /platform/audit console. Callers
 * MUST have passed the `PlatformAdmin` gate first — the repo function
 * itself is unauthenticated, like the other `*Admin` helpers.
 */
export async function listAuditEntries(
	db: DbClient,
	options: { readonly limit?: number } = {},
): Promise<AuditListResult> {
	const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
	const [entries, totals] = await Promise.all([
		db
			.select()
			.from(adminAudit)
			.orderBy(desc(adminAudit.createdAt), desc(adminAudit.id))
			.limit(limit),
		db.select({ n: count() }).from(adminAudit),
	]);
	return { entries, total: totals[0]?.n ?? 0, limit };
}

/**
 * Audit domain port — the write side every admin mutation calls plus
 * the admin-gated read behind /platform/audit.
 *
 * `record` NEVER fails: an audit write must not take down the mutation
 * it describes, so insert errors and defects are logged and swallowed
 * (`Effect.catchCause`). Consumers resolve it via
 * `Effect.serviceOption(Audit)` — the audit plugin may be absent and
 * mutations must still work (same contract as `PermissionInvalidator`).
 * `adminList` re-checks the `PlatformAdmin` gate.
 */
export class Audit extends Context.Service<
	Audit,
	{
		readonly record: (entry: AuditEntryInput) => Effect.Effect<void>;
		readonly adminList: (options?: {
			readonly limit?: number;
		}) => Effect.Effect<AuditListResult, Forbidden>;
	}
>()("@ktb/audit/Audit") {}

export const AuditLive = Layer.effect(
	Audit,
	Effect.gen(function* () {
		const db = yield* Db;
		const platformAdmin = yield* PlatformAdmin;
		return Audit.of({
			record: Effect.fn("Audit.record")(function* (entry: AuditEntryInput) {
				const principal = yield* Principal;
				yield* Effect.promise(() =>
					insertAuditEntry(db, {
						...entry,
						actorUserId: principal?.userId ?? null,
						actorEmail: principal?.email ?? null,
					}),
				).pipe(
					Effect.catchCause((cause) =>
						Effect.logWarning("admin audit write failed", {
							action: entry.action,
							cause: String(cause),
						}),
					),
				);
			}),
			adminList: Effect.fn("Audit.adminList")(function* (options?: { limit?: number }) {
				yield* platformAdmin.requireAdmin();
				return yield* Effect.promise(() => listAuditEntries(db, options));
			}),
		});
	}),
);

/**
 * One-line write helper for instrumented admin mutations:
 * `yield* audit({ action: "users.suspend", ... })`. Resolves the Audit
 * service via `serviceOption` per call — a no-op when the audit plugin
 * is absent, and `Audit.record` itself swallows write failures, so an
 * audit problem can never fail the mutation it describes.
 */
export const audit = (entry: AuditEntryInput): Effect.Effect<void> =>
	Effect.flatMap(Effect.serviceOption(Audit), (option) =>
		Option.isSome(option) ? option.value.record(entry) : Effect.void,
	);

// Re-exported for tests: a DDL snippet that creates admin_audit in the
// in-memory better-sqlite3 test databases of instrumented plugins.
export const AUDIT_TEST_DDL = `
CREATE TABLE admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id TEXT, actor_email TEXT, action TEXT NOT NULL, target_type TEXT, target_id TEXT, detail TEXT, tenant_id INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX admin_audit_created_at_idx ON admin_audit (created_at);
CREATE INDEX admin_audit_action_idx ON admin_audit (action);
CREATE INDEX admin_audit_actor_idx ON admin_audit (actor_user_id);
`;

export const auditTablesPlugin = definePlugin({
	id: "audit.tables",
	tables: { adminAudit },
});

export const auditServicesPlugin = definePlugin({
	id: "audit.services",
	// adminList consumes the PlatformAdmin gate — the dep edge keeps the
	// platform module ordered (and discovered) before this plugin's layer.
	requiredDeps: [platformAdminPlugin.id],
	services: AuditLive,
});

// Panel (system console) contribution: /platform/audit is mounted by
// the platform plugin's physical route subtree; this plugin declares
// the sidebar entry and page descriptor. The dep edge orders it after
// the shell and the audit services its loader consumes.
export const auditPanelPlugin = definePlugin({
	id: "audit.panel",
	requiredDeps: [platformPanelPlugin.id, auditServicesPlugin.id],
	panel: {
		sidebar: [{ to: "/platform/audit", label: "Audit log", icon: ScrollTextIcon, group: "System" }],
		pages: [
			{
				id: "audit.admin",
				path: "/platform/audit",
				component: AuditPlatformPage,
				// Hard 404 for non-admins — same contract as the /platform
				// layout guard; the service re-checks anyway.
				guard: () =>
					Effect.gen(function* () {
						const platformAdmin = yield* PlatformAdmin;
						return yield* platformAdmin.requireAdmin().pipe(
							Effect.as(true),
							Effect.catchTag("Forbidden", () => Effect.succeed(false)),
						);
					}),
				loader: () =>
					Effect.gen(function* () {
						const audit = yield* Audit;
						const empty: AuditListResult = { entries: [], total: 0, limit: 200 };
						return yield* audit
							.adminList()
							.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(empty)));
					}),
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	auditTablesPlugin,
	auditServicesPlugin,
	auditPanelPlugin,
];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"audit.tables": true;
		"audit.services": true;
		"audit.panel": true;
	}
}
