import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { Binding, type SqlDatabase } from "@ktb/db";

import { applyTenantRls, tenantRlsStatements } from "./rls.ts";

describe("tenantRlsStatements", () => {
	it("generates enable + policy statements with defaults", () => {
		const statements = tenantRlsStatements("patients");
		expect(statements).toHaveLength(2);
		expect(statements[0]).toBe('ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY');
		expect(statements[1]).toContain('CREATE POLICY "patients_tenant_isolation" ON "patients"');
		expect(statements[1]).toContain('"tenant_id" = ANY');
		expect(statements[1]).toContain("current_setting('app.tenant_ids', true)::bigint[]");
		expect(statements[1]).toContain('"tenant_id" IS NULL');
	});

	it("honors table options and rls options", () => {
		const [alter, policy] = tenantRlsStatements(
			{ name: "docs", tenantIdColumn: "org_id", policyName: "docs_tenant" },
			{ setting: "app.org_ids", idType: "text" },
		);
		expect(alter).toBe('ALTER TABLE "docs" ENABLE ROW LEVEL SECURITY');
		expect(policy).toContain('CREATE POLICY "docs_tenant" ON "docs"');
		expect(policy).toContain('"org_id" = ANY');
		expect(policy).toContain("current_setting('app.org_ids', true)::text[]");
	});

	it("quotes identifiers safely", () => {
		const [, policy] = tenantRlsStatements('we"ird');
		expect(policy).toContain('"we""ird"');
	});
});

describe("applyTenantRls", () => {
	const fakeBinding = (executed: string[]): SqlDatabase =>
		({
			prepare: () => {
				throw new Error("not used");
			},
			dump: async () => new ArrayBuffer(0),
			batch: async () => [],
			exec: async (query: string) => {
				executed.push(query);
				return { count: 0, duration: 0 };
			},
		}) as unknown as SqlDatabase;

	it("is a no-op on sqlite/d1/other dialects", async () => {
		for (const dialect of ["sqlite", "d1", "other"] as const) {
			const executed: string[] = [];
			const result = await Effect.runPromise(
				applyTenantRls({
					dialect,
					tables: ["patients"],
				}).pipe(Effect.provide(Layer.succeed(Binding, fakeBinding(executed)))),
			);
			expect(result).toEqual({ applied: [], skipped: dialect });
			expect(executed).toEqual([]);
		}
	});

	it("applies statements on postgres", async () => {
		const executed: string[] = [];
		const result = await Effect.runPromise(
			applyTenantRls({
				dialect: "postgres",
				tables: ["patients", { name: "docs", tenantIdColumn: "clinic_id" }],
			}).pipe(Effect.provide(Layer.succeed(Binding, fakeBinding(executed)))),
		);
		expect(result).toEqual({ applied: ["patients", "docs"], skipped: null });
		expect(executed).toHaveLength(4);
		expect(executed[0]).toContain("patients");
		expect(executed[2]).toContain("docs");
		expect(executed[3]).toContain('"clinic_id"');
	});
});
