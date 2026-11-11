import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Db, makeDb, type DbClient } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { Forbidden, Principal } from "@ktb/authz";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";

import { adminAudit } from "./schema.ts";
import {
	AUDIT_TEST_DDL,
	Audit,
	AuditLive,
	audit,
	auditPanelPlugin,
	auditServicesPlugin,
	auditTablesPlugin,
	insertAuditEntry,
	listAuditEntries,
	plugins,
	type AuditListResult,
} from "./index.ts";

// admin_audit.tenant_id references groups.id — the FK is declared for
// documentation; better-sqlite3 does not enforce it, but the parent
// table exists in every real database, so the test DDL mirrors that.
const GROUPS_DDL = `
CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, meta TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO groups (name, slug, kind, meta, created_at, updated_at) VALUES ('Clinic A', 'clinic-a', 'clinic', NULL, 1000, 1000);
`;

const DDL = GROUPS_DDL + AUDIT_TEST_DDL;

describe("audit repo", () => {
	let db: ReturnType<typeof makeDb>;

	beforeAll(() => {
		db = makeDb(makeD1(DDL));
	});

	it("insertAuditEntry writes a row with actor, normalized tenant and stringified target", async () => {
		const row = await insertAuditEntry(db, {
			actorUserId: "u1",
			actorEmail: "admin@x.com",
			action: "users.suspend",
			targetType: "user",
			targetId: 42,
			detail: { suspended: true },
			tenantId: "1",
		});
		expect(row).not.toBeNull();
		expect(row!.actorUserId).toBe("u1");
		expect(row!.actorEmail).toBe("admin@x.com");
		expect(row!.action).toBe("users.suspend");
		expect(row!.targetType).toBe("user");
		expect(row!.targetId).toBe("42");
		expect(row!.detail).toBe('{"suspended":true}');
		expect(row!.tenantId).toBe(1);
	});

	it("normalizes every tenantId shape and drops non-numeric values", async () => {
		const base = { actorUserId: null, actorEmail: null, action: "a.b" };
		const cases: Array<[string | number | null | undefined, number | null]> = [
			[7, 7],
			["8", 8],
			["", null],
			["  ", null],
			["abc", null],
			[1.5, null],
			[null, null],
			[undefined, null],
		];
		for (const [input, expected] of cases) {
			const row = await insertAuditEntry(db, { ...base, tenantId: input });
			expect(row!.tenantId).toBe(expected);
		}
	});

	it("stores null detail when absent and truncates oversized payloads", async () => {
		const noDetail = await insertAuditEntry(db, {
			actorUserId: null,
			actorEmail: null,
			action: "a.b",
		});
		expect(noDetail!.detail).toBeNull();
		expect(noDetail!.targetType).toBeNull();
		expect(noDetail!.targetId).toBeNull();
		const big = await insertAuditEntry(db, {
			actorUserId: null,
			actorEmail: null,
			action: "a.b",
			detail: { blob: "x".repeat(5000) },
		});
		expect(big!.detail!.length).toBe(4000);
	});

	it("returns null when the driver yields no RETURNING row", async () => {
		const emptyInsert = {
			insert: () => ({ values: () => ({ returning: async () => [] }) }),
		} as unknown as DbClient;
		expect(
			await insertAuditEntry(emptyInsert, {
				actorUserId: null,
				actorEmail: null,
				action: "a.b",
			}),
		).toBeNull();
	});

	it("listAuditEntries returns newest-first rows with the total count", async () => {
		const fresh = makeDb(makeD1(DDL));
		await insertAuditEntry(fresh, {
			actorUserId: "u1",
			actorEmail: "a@x.com",
			action: "first.action",
		});
		await insertAuditEntry(fresh, {
			actorUserId: "u2",
			actorEmail: "b@x.com",
			action: "second.action",
		});
		const result = await listAuditEntries(fresh);
		expect(result.entries.map((e) => e.action)).toEqual(["second.action", "first.action"]);
		expect(result.total).toBe(2);
		expect(result.limit).toBe(200);
	});

	it("clamps the page limit and reports zero totals on empty drivers", async () => {
		const fresh = makeDb(makeD1(DDL));
		for (let i = 0; i < 3; i++) {
			await insertAuditEntry(fresh, {
				actorUserId: null,
				actorEmail: null,
				action: `a.${i}`,
			});
		}
		expect((await listAuditEntries(fresh, { limit: 2 })).entries).toHaveLength(2);
		expect((await listAuditEntries(fresh, { limit: 0 })).entries).toHaveLength(1);
		expect((await listAuditEntries(fresh, { limit: 9999 })).limit).toBe(500);
	});

	it("reports a zero total when the count query yields no row", async () => {
		// Thenable query stub: `select().from()` is awaited directly for
		// the count and chained through orderBy/limit for the page.
		const query = {
			orderBy: () => ({ limit: async () => [] }),
			then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
		};
		const fakeDb = { select: () => ({ from: () => query }) } as unknown as DbClient;
		const result = await listAuditEntries(fakeDb);
		expect(result).toEqual({ entries: [], total: 0, limit: 200 });
	});
});

describe("AuditLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Audit, never>;

	beforeAll(() => {
		const db = makeDb(makeD1(DDL));
		const deps = Layer.merge(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		runtime = ManagedRuntime.make(AuditLive.pipe(Layer.provide(deps)));
	});

	afterAll(() => runtime.dispose());

	const asUser = <A, E>(
		userId: string | null,
		effect: Effect.Effect<A, E, Audit>,
		email?: string,
	) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId, email }),
		);

	const call = <A, E>(f: (p: Audit["Service"]) => Effect.Effect<A, E>) => Effect.flatMap(Audit, f);

	it("record writes a row stamped with the bound principal", async () => {
		await asUser(
			"admin-1",
			call((p) =>
				p.record({
					action: "groups.delete",
					targetType: "group",
					targetId: 9,
					tenantId: 9,
				}),
			),
			"admin@x.com",
		);
		const result = await asUser(
			"admin-1",
			call((p) => p.adminList()),
			"admin@x.com",
		);
		const row = result.entries.find((e) => e.action === "groups.delete")!;
		expect(row.actorUserId).toBe("admin-1");
		expect(row.actorEmail).toBe("admin@x.com");
		expect(row.targetId).toBe("9");
		expect(row.tenantId).toBe(9);
	});

	it("record stamps null actors in system contexts (null principal)", async () => {
		await asUser(
			null,
			call((p) => p.record({ action: "system.action" })),
		);
		const result = await asUser(
			"admin-1",
			call((p) => p.adminList()),
			"admin@x.com",
		);
		const row = result.entries.find((e) => e.action === "system.action")!;
		expect(row.actorUserId).toBeNull();
		expect(row.actorEmail).toBeNull();
	});

	it("adminList is Forbidden for non-admins and null principals", async () => {
		await expect(
			asUser(
				"u2",
				call((p) => p.adminList()),
				"doc@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "platform.admin" });
		await expect(
			asUser(
				null,
				call((p) => p.adminList()),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
	});
});

describe("AuditLive failure isolation", () => {
	it("record resolves even when the insert throws", async () => {
		const brokenDb = {
			insert: () => {
				throw new Error("db down");
			},
		} as unknown as DbClient;
		const deps = Layer.merge(
			Layer.succeed(Db, brokenDb),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		const runtime = ManagedRuntime.make(AuditLive.pipe(Layer.provide(deps)));
		try {
			await runtime.runPromise(
				Effect.flatMap(Audit, (p) => p.record({ action: "a.b" })).pipe(
					Effect.provideService(Principal, { userId: "u1", email: "admin@x.com" }),
				),
			);
		} finally {
			await runtime.dispose();
		}
	});
});

describe("audit helper", () => {
	it("is a no-op when the Audit service is absent", async () => {
		await expect(Effect.runPromise(audit({ action: "a.b" }))).resolves.toBeUndefined();
	});

	it("delegates to the service when present", async () => {
		const seen: unknown[] = [];
		const stub = {
			record: (entry: never) => Effect.sync(() => seen.push(entry)),
			adminList: () => Effect.succeed({ entries: [], total: 0, limit: 200 }),
		} as unknown as Audit["Service"];
		await Effect.runPromise(
			audit({ action: "users.suspend", targetId: "u9" }).pipe(Effect.provideService(Audit, stub)),
		);
		expect(seen).toEqual([{ action: "users.suspend", targetId: "u9" }]);
	});
});

describe("plugins", () => {
	it("declares tables, services and panel as single-concern plugins", () => {
		expect(auditTablesPlugin.id).toBe("audit.tables");
		expect(auditTablesPlugin.tables).toBeDefined();
		expect(auditServicesPlugin.id).toBe("audit.services");
		expect(auditServicesPlugin.requiredDeps).toEqual(["platform.admin"]);
		expect(auditServicesPlugin.services).toBeDefined();
		expect(auditPanelPlugin.id).toBe("audit.panel");
		expect(auditPanelPlugin.requiredDeps).toEqual(["platform.panel", "audit.services"]);
		expect(auditPanelPlugin.panel?.sidebar).toEqual([
			{ to: "/platform/audit", label: "Audit log", icon: expect.anything(), group: "System" },
		]);
	});

	describe("panel page guard", () => {
		const guard = auditPanelPlugin.panel!.pages![0]!.guard as () => Effect.Effect<
			boolean,
			never,
			PlatformAdmin
		>;
		const gate = (admin: boolean) =>
			makePlatformAdminGate(parsePlatformAdminEmails(admin ? "admin@x.com" : ""));

		it("returns true for allowlisted admins", async () => {
			const result = await Effect.runPromise(
				guard().pipe(
					Effect.provideService(PlatformAdmin, gate(true)),
					Effect.provideService(Principal, { userId: "u1", email: "admin@x.com" }),
				),
			);
			expect(result).toBe(true);
		});

		it("returns false for non-admins", async () => {
			const result = await Effect.runPromise(
				guard().pipe(
					Effect.provideService(PlatformAdmin, gate(false)),
					Effect.provideService(Principal, { userId: "u1", email: "doc@x.com" }),
				),
			);
			expect(result).toBe(false);
		});
	});

	describe("panel page loader", () => {
		const loader = auditPanelPlugin.panel!.pages![0]!.loader as () => Effect.Effect<
			AuditListResult,
			never,
			Audit
		>;
		const stubAudit = (adminList: Audit["Service"]["adminList"]) =>
			({ adminList, record: () => Effect.void }) as unknown as Audit["Service"];

		it("returns the listing for admins", async () => {
			const result: AuditListResult = { entries: [], total: 0, limit: 200 };
			expect(
				await Effect.runPromise(
					loader().pipe(
						Effect.provideService(
							Audit,
							stubAudit(() => Effect.succeed(result)),
						),
					),
				),
			).toEqual(result);
		});

		it("collapses Forbidden to an empty page", async () => {
			expect(
				await Effect.runPromise(
					loader().pipe(
						Effect.provideService(
							Audit,
							stubAudit(() => Effect.fail(new Forbidden({ path: "platform.admin" }))),
						),
					),
				),
			).toEqual({ entries: [], total: 0, limit: 200 });
		});
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual(["audit.tables", "audit.services", "audit.panel"]);
	});
});

describe("adminAudit schema", () => {
	it("is registered in the composed drizzle schema", async () => {
		const { adminAudit: composed } = await import("@ktb/db/schema");
		expect(composed).toBe(adminAudit);
	});
});
