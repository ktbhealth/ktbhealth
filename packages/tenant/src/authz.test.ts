import * as Effect from "effect/Effect";
import { createPermix } from "permix/effect";
import { describe, expect, it } from "vitest";

import { Tenant } from "./index.ts";
import {
	TENANT_ROLE_RANK,
	TenantForbidden,
	requireTenantRole,
	tenantAuthz,
	tenantRoleAtLeast,
	type RoleActionMatrix,
} from "./authz.ts";
import type { TenantRole } from "./index.ts";

type Def = {
	patient: readonly [
		"create",
		{ name: "read"; type: { ownerId: string }; required: true },
		{ name: "update"; type: { ownerId: string }; required: true },
		{ name: "delete"; type: { ownerId: string }; required: true },
	];
};

const matrix: RoleActionMatrix = {
	patient: {
		create: "member",
		read: "admin",
		delete: "owner",
		// Data-dependent grant: members may update only their own rows.
		update: (role, data) => role !== null && (data as { ownerId?: string }).ownerId === "me",
	},
};

const tenant = (role: TenantRole): Tenant => ({
	id: 1,
	kind: "clinic",
	slug: "clinic",
	role,
});

describe("tenantRoleAtLeast / TENANT_ROLE_RANK", () => {
	it("ranks owner > admin > member", () => {
		expect(TENANT_ROLE_RANK.owner).toBeGreaterThan(TENANT_ROLE_RANK.admin);
		expect(TENANT_ROLE_RANK.admin).toBeGreaterThan(TENANT_ROLE_RANK.member);
	});

	it("compares ranks and rejects null", () => {
		expect(tenantRoleAtLeast("owner", "admin")).toBe(true);
		expect(tenantRoleAtLeast("admin", "admin")).toBe(true);
		expect(tenantRoleAtLeast("member", "admin")).toBe(false);
		expect(tenantRoleAtLeast(null, "member")).toBe(false);
	});
});

describe("tenantAuthz", () => {
	it("grants actions at or above the minimum role", () => {
		const owner = tenantAuthz<Def>(matrix)("owner");
		const admin = tenantAuthz<Def>(matrix)("admin");
		const member = tenantAuthz<Def>(matrix)("member");
		const nobody = tenantAuthz<Def>(matrix)(null);

		// create: "member" → every role
		expect(owner.patient.create).toBe(true);
		expect(admin.patient.create).toBe(true);
		expect(member.patient.create).toBe(true);
		expect(nobody.patient.create).toBe(false);

		// read: "admin" → admin + owner only
		expect(owner.patient.read).toBe(true);
		expect(admin.patient.read).toBe(true);
		expect(member.patient.read).toBe(false);
		expect(nobody.patient.read).toBe(false);

		// delete: "owner" → owner only
		expect(owner.patient.delete).toBe(true);
		expect(admin.patient.delete).toBe(false);
		expect(member.patient.delete).toBe(false);
	});

	it("keeps function grants data-dependent", () => {
		const member = tenantAuthz<Def>(matrix)("member");
		const update = member.patient.update as (data: unknown) => boolean;
		expect(typeof update).toBe("function");
		expect(update({ ownerId: "me" })).toBe(true);
		expect(update({ ownerId: "other" })).toBe(false);
	});

	it("produces rules permix can evaluate", async () => {
		const { layer, check } = createPermix<Def>({ id: "tenant-test" });
		const rules = tenantAuthz<Def>(matrix)("member");
		const program = Effect.gen(function* () {
			const createOk = yield* check("patient.create");
			const readOk = yield* check("patient.read", { ownerId: "u1" });
			return { createOk, readOk };
		});
		const result = await Effect.runPromise(program.pipe(Effect.provide(layer(rules))));
		expect(result).toEqual({ createOk: true, readOk: false });
	});
});

describe("requireTenantRole", () => {
	const asTenant = <A, E>(t: Tenant | null, effect: Effect.Effect<A, E>) =>
		Effect.provideService(effect, Tenant, t);

	it("passes at or above the minimum role", async () => {
		await expect(
			Effect.runPromise(asTenant(tenant("admin"), requireTenantRole("member", "x"))),
		).resolves.toBeUndefined();
	});

	it("fails TenantForbidden below the minimum or without a tenant", async () => {
		await expect(
			Effect.runPromise(asTenant(tenant("member"), requireTenantRole("admin", "x"))),
		).rejects.toMatchObject({ path: "x", role: "member", required: "admin" });
		await expect(Effect.runPromise(requireTenantRole("member"))).rejects.toBeInstanceOf(
			TenantForbidden,
		);
	});
});
