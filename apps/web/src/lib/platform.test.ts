import { beforeAll, describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";

import { groupMembers, groups } from "@ktb/db/schema";
import { Tenant } from "@ktb/tenant";

import { ai, auth, BindingLive, db, flushTelemetry, runAs } from "./platform.ts";

// Tenant fixtures (P-053): u1 belongs to exactly one tenant (clinic-a) so
// the resolver's selectDefault auto-picks it; u-multi belongs to two and
// must fall back to personal scope; u-none belongs to none.
let clinicAId = 0;
beforeAll(async () => {
	const [clinicA] = await db
		.insert(groups)
		.values({ name: "Clinic A", slug: "clinic-a", kind: "clinic", meta: null })
		.returning();
	clinicAId = clinicA!.id;
	const [orgB] = await db
		.insert(groups)
		.values({ name: "Org B", slug: "org-b", kind: "org", meta: null })
		.returning();
	const [clinicC] = await db
		.insert(groups)
		.values({ name: "Clinic C", slug: "clinic-c", kind: "clinic", meta: null })
		.returning();
	await db.insert(groupMembers).values([
		{ groupId: clinicA!.id, memberKind: "user", memberId: "u1", role: "admin" },
		{ groupId: orgB!.id, memberKind: "user", memberId: "u-multi", role: "member" },
		{ groupId: clinicC!.id, memberKind: "user", memberId: "u-multi", role: "member" },
	]);
});

const readTenant = () => Effect.flatMap(Tenant, (tenant) => Effect.succeed(tenant));

describe("platform", () => {
	it("exposes db, auth and ai bindings", async () => {
		expect(db).toBeDefined();
		expect(auth).toBeDefined();
		expect(typeof auth.api.getSession).toBe("function");
		expect(ai?.run).toBeDefined();
		expect(BindingLive).toBeDefined();
	});

	it("flushTelemetry resolves without rejecting", async () => {
		await expect(flushTelemetry()).resolves.toBeUndefined();
	});

	it("runAs resolves an explicit tenant selector through the directory", async () => {
		const tenant = await runAs({ id: "u1" }, readTenant(), { slug: "clinic-a" });
		expect(tenant).toMatchObject({
			id: clinicAId,
			kind: "clinic",
			slug: "clinic-a",
			role: "admin",
		});
		// Explicit null skips header extraction and takes the default path.
		await expect(runAs({ id: "u1" }, Effect.succeed("ok"), null)).resolves.toBe("ok");
	});

	it("runAs rejects selectors naming tenants the user cannot access", async () => {
		// u1 does not belong to org-b — resolution must not leak it.
		const error = await runAs({ id: "u1" }, Effect.succeed("ok"), {
			slug: "org-b",
		}).then(
			() => null,
			(e: unknown) => e,
		);
		expect(error).not.toBeNull();
		expect(String(error)).toContain("TenantNotFound");
	});

	it("runAs auto-selects the user's sole membership when no selector is given", async () => {
		const tenant = await runAs({ id: "u1" }, readTenant());
		expect(tenant).toMatchObject({ slug: "clinic-a", role: "admin" });
	});

	it("runAs falls back to personal scope for multi-tenant and non-member users", async () => {
		// Two memberships → selectDefault abstains → fallback "personal".
		await expect(runAs({ id: "u-multi" }, readTenant())).resolves.toBeNull();
		// No memberships at all → personal scope.
		await expect(runAs({ id: "u-none" }, readTenant())).resolves.toBeNull();
		// Outside a request context selector extraction degrades to null.
		await expect(runAs({ id: "u1" }, Effect.succeed("ok"))).resolves.toBe("ok");
	});
});
