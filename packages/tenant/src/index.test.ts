import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import {
	isEmptySelector,
	makeTenantResolver,
	requireTenant,
	runAsTenant,
	runAsTenantId,
	Tenant,
	TenantDirectory,
	TenantNotFound,
	TenantRequired,
	TenantResolver,
	TenantResolverLive,
	tenantScopeId,
	tenantSelectorFromHeaders,
	withTenantAccess,
	type TenantDirectoryShape,
	type TenantMembership,
	type TenantSelector,
} from "./index.ts";
import { accessibleTenantIds } from "./scoped-repo.ts";

const clinicA = { id: 1, kind: "clinic", slug: "clinic-a" } as const;
const clinicB = { id: 2, kind: "clinic", slug: "clinic-b" } as const;
const tenantA = { ...clinicA, role: "member" as const };
const tenantB = { ...clinicB, role: "admin" as const };

const membershipA: TenantMembership = { tenant: clinicA, role: "member" };
const membershipB: TenantMembership = { tenant: clinicB, role: "admin" };

const directory = (over: Partial<TenantDirectoryShape> = {}): TenantDirectoryShape => ({
	membershipsFor: () => Effect.succeed([membershipA, membershipB]),
	findBySelector: (_userId, selector) =>
		Effect.succeed(
			selector.slug === "clinic-a" ? tenantA : selector.slug === "clinic-b" ? tenantB : null,
		),
	...over,
});

describe("Tenant", () => {
	it("defaults to null outside a request context", async () => {
		await expect(Effect.runPromise(Effect.service(Tenant))).resolves.toBeNull();
	});

	it("resolves the bound tenant", async () => {
		await expect(
			Effect.runPromise(Effect.provideService(Effect.service(Tenant), Tenant, tenantA)),
		).resolves.toEqual(tenantA);
	});
});

describe("runAsTenant / requireTenant", () => {
	it("re-binds Tenant for the duration of the effect", async () => {
		const program = Effect.gen(function* () {
			const outer = yield* Tenant;
			const inner = yield* runAsTenant(tenantB, Effect.service(Tenant));
			return { outer, inner };
		});
		const result = await Effect.runPromise(Effect.provideService(program, Tenant, tenantA));
		expect(result.outer).toEqual(tenantA);
		expect(result.inner).toEqual(tenantB);
	});

	it("requireTenant returns the bound tenant", async () => {
		await expect(
			Effect.runPromise(Effect.provideService(requireTenant(), Tenant, tenantA)),
		).resolves.toEqual(tenantA);
	});

	it("requireTenant fails TenantRequired in personal scope", async () => {
		await expect(Effect.runPromise(requireTenant("notes.list"))).rejects.toMatchObject({
			reason: "tenant scope required (notes.list)",
		});
	});
});

describe("runAsTenantId", () => {
	it("binds the accessible set to the bare id without binding Tenant", async () => {
		const program = Effect.gen(function* () {
			return yield* runAsTenantId(7, Effect.all({ ids: accessibleTenantIds, tenant: Tenant }));
		});
		const result = await Effect.runPromise(Effect.provideService(program, Tenant, tenantA));
		expect(result.ids).toEqual([7]);
		// Ambient Tenant is shadowed by the access set only — Tenant
		// itself stays whatever the outer scope bound (here tenantA);
		// system callers run with no outer Tenant at all.
		expect(result.tenant).toEqual(tenantA);
	});

	it("leaves personal scope untouched for null/undefined ids", async () => {
		const program = Effect.gen(function* () {
			const ids = yield* runAsTenantId(null, accessibleTenantIds);
			const ids2 = yield* runAsTenantId(undefined, accessibleTenantIds);
			return { ids, ids2 };
		});
		const result = await Effect.runPromise(program);
		expect(result.ids).toEqual([]);
		expect(result.ids2).toEqual([]);
	});

	it("normalizes numeric string ids", async () => {
		const ids = await Effect.runPromise(runAsTenantId("42", accessibleTenantIds));
		expect(ids).toEqual([42]);
	});

	it("keeps non-numeric string ids as strings", async () => {
		const ids = await Effect.runPromise(runAsTenantId("clinic-9", accessibleTenantIds));
		expect(ids).toEqual(["clinic-9"]);
	});
});

describe("tenantScopeId", () => {
	it("maps bound tenants to their numeric tenant_id", () => {
		expect(tenantScopeId(null)).toBeNull();
		expect(tenantScopeId(tenantA)).toBe(1);
		expect(tenantScopeId({ ...tenantA, id: "42" })).toBe(42);
		expect(tenantScopeId({ ...tenantA, id: "clinic-x" })).toBeNull();
	});
});

describe("withTenantAccess", () => {
	it("binds an explicit accessible set and restores the default after", async () => {
		const program = Effect.gen(function* () {
			const inside = yield* withTenantAccess([7, 9], accessibleTenantIds);
			const outside = yield* accessibleTenantIds;
			return { inside, outside };
		});
		const result = await Effect.runPromise(Effect.provideService(program, Tenant, tenantA));
		expect(result.inside).toEqual([7, 9]);
		expect(result.outside).toEqual([tenantA.id]);
	});
});

describe("tenantSelectorFromHeaders", () => {
	it("returns null when no tenant headers are present", () => {
		expect(tenantSelectorFromHeaders(new Headers())).toBeNull();
	});

	it("extracts id/slug/kind/raw headers", () => {
		const headers = new Headers({
			"x-tenant-id": "42",
			"x-tenant-slug": "clinic-a",
			"x-tenant-kind": "clinic",
			"x-tenant": "raw-value",
		});
		expect(tenantSelectorFromHeaders(headers)).toEqual({
			id: 42,
			slug: "clinic-a",
			kind: "clinic",
			raw: "raw-value",
		});
	});

	it("keeps non-numeric ids as strings", () => {
		const headers = new Headers({ "x-tenant-id": "clinic-42" });
		expect(tenantSelectorFromHeaders(headers)).toEqual({ id: "clinic-42" });
	});

	it("parses negative numeric ids", () => {
		const headers = new Headers({ "x-tenant-id": "-7" });
		expect(tenantSelectorFromHeaders(headers)).toEqual({ id: -7 });
	});

	it("extracts a partial selector when only some headers are present", () => {
		const headers = new Headers({ "x-tenant-slug": "clinic-a" });
		expect(tenantSelectorFromHeaders(headers)).toEqual({ slug: "clinic-a" });
	});
});

describe("isEmptySelector", () => {
	it("treats null/undefined/empty objects as empty", () => {
		expect(isEmptySelector(null)).toBe(true);
		expect(isEmptySelector(undefined)).toBe(true);
		expect(isEmptySelector({})).toBe(true);
	});

	it("detects any signal", () => {
		expect(isEmptySelector({ slug: "x" })).toBe(false);
		expect(isEmptySelector({ raw: "" })).toBe(false);
	});
});

describe("TenantResolver default", () => {
	it("resolves null when the app provides no resolver", async () => {
		const tenant = await Effect.runPromise(
			Effect.gen(function* () {
				const resolver = yield* TenantResolver;
				return yield* resolver.resolve({ slug: "clinic-a" }, "u1");
			}),
		);
		expect(tenant).toBeNull();
	});
});

describe("makeTenantResolver", () => {
	it("personal fallback resolves null with no selector", async () => {
		const resolver = makeTenantResolver({ directory: directory() });
		await expect(Effect.runPromise(resolver.resolve(null, "u1"))).resolves.toBeNull();
		await expect(Effect.runPromise(resolver.resolve(undefined, "u1"))).resolves.toBeNull();
		await expect(Effect.runPromise(resolver.resolve({}, "u1"))).resolves.toBeNull();
	});

	it("deny fallback fails TenantRequired with no selector", async () => {
		const resolver = makeTenantResolver({ directory: directory(), fallback: "deny" });
		await expect(Effect.runPromise(resolver.resolve(null, "u1"))).rejects.toBeInstanceOf(
			TenantRequired,
		);
	});

	it("selectDefault picks from memberships before the fallback", async () => {
		const resolver = makeTenantResolver({
			directory: directory({ membershipsFor: () => Effect.succeed([membershipA]) }),
			fallback: "deny",
			selectDefault: (ms) => (ms.length === 1 ? ms[0] : null),
		});
		await expect(Effect.runPromise(resolver.resolve(null, "u1"))).resolves.toEqual(tenantA);
	});

	it("selectDefault may return a Tenant directly", async () => {
		const resolver = makeTenantResolver({
			directory: directory(),
			selectDefault: () => tenantB,
		});
		await expect(Effect.runPromise(resolver.resolve(null, "u1"))).resolves.toEqual(tenantB);
	});

	it("selectDefault returning null falls through to the fallback", async () => {
		const resolver = makeTenantResolver({
			directory: directory(),
			selectDefault: () => null,
		});
		await expect(Effect.runPromise(resolver.resolve(null, "u1"))).resolves.toBeNull();
	});

	it("selectDefault is skipped for system contexts (no user)", async () => {
		let called = false;
		const resolver = makeTenantResolver({
			directory: directory(),
			selectDefault: () => {
				called = true;
				return membershipA;
			},
		});
		await expect(Effect.runPromise(resolver.resolve(null, null))).resolves.toBeNull();
		expect(called).toBe(false);
	});

	it("resolves a selector through the directory", async () => {
		const resolver = makeTenantResolver({ directory: directory() });
		await expect(Effect.runPromise(resolver.resolve({ slug: "clinic-b" }, "u1"))).resolves.toEqual(
			tenantB,
		);
	});

	it("fails TenantNotFound when the selector matches nothing", async () => {
		const resolver = makeTenantResolver({ directory: directory() });
		const selector: TenantSelector = { slug: "nowhere" };
		await expect(Effect.runPromise(resolver.resolve(selector, "u1"))).rejects.toMatchObject({
			selector,
		});
	});

	it("fails TenantNotFound for a selector without a user", async () => {
		const resolver = makeTenantResolver({ directory: directory() });
		await expect(
			Effect.runPromise(resolver.resolve({ slug: "clinic-a" }, null)),
		).rejects.toBeInstanceOf(TenantNotFound);
	});

	it("propagates directory failures", async () => {
		const resolver = makeTenantResolver({
			directory: directory({
				findBySelector: () => Effect.fail("directory down"),
			}),
		});
		await expect(Effect.runPromise(resolver.resolve({ slug: "clinic-a" }, "u1"))).rejects.toBe(
			"directory down",
		);
	});
});

describe("TenantResolverLive", () => {
	it("builds the resolver from the TenantDirectory service", async () => {
		const live = TenantResolverLive({ fallback: "deny" }).pipe(
			Layer.provide(Layer.succeed(TenantDirectory, directory())),
		);
		const program = Effect.gen(function* () {
			const resolver = yield* TenantResolver;
			return yield* resolver.resolve({ slug: "clinic-a" }, "u1");
		});
		await expect(Effect.runPromise(program.pipe(Effect.provide(live)))).resolves.toEqual(tenantA);
	});
});
