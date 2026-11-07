import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import {
	AuthzLive,
	can,
	canAs,
	Forbidden,
	Principal,
	requireCan,
	requireCanAs,
	requirePrincipalUser,
	rulesFor,
} from "./index.ts";

describe("rulesFor", () => {
	it("grants owner access on consultation", async () => {
		const readOk = await Effect.runPromise(
			can("consultation.read", { userId: "u1" }).pipe(Effect.provide(AuthzLive("u1"))),
		);
		const updateOk = await Effect.runPromise(
			can("consultation.update", { userId: "u1" }).pipe(Effect.provide(AuthzLive("u1"))),
		);
		const deleteOk = await Effect.runPromise(
			can("consultation.delete", { userId: "u1" }).pipe(Effect.provide(AuthzLive("u1"))),
		);
		expect(readOk).toBe(true);
		expect(updateOk).toBe(true);
		expect(deleteOk).toBe(true);
	});

	it("denies non-owner on consultation", async () => {
		const readOk = await Effect.runPromise(
			can("consultation.read", { userId: "u2" }).pipe(Effect.provide(AuthzLive("u1"))),
		);
		const deleteOk = await Effect.runPromise(
			can("consultation.delete", { userId: "u2" }).pipe(Effect.provide(AuthzLive("u1"))),
		);
		expect(readOk).toBe(false);
		expect(deleteOk).toBe(false);
	});

	it("grants owner access on patient", async () => {
		const readOk = await Effect.runPromise(
			can("patient.read", { ownerId: "u1" }).pipe(Effect.provide(AuthzLive("u1"))),
		);
		const updateOk = await Effect.runPromise(
			can("patient.update", { ownerId: "u1" }).pipe(Effect.provide(AuthzLive("u1"))),
		);
		const deleteOk = await Effect.runPromise(
			can("patient.delete", { ownerId: "u1" }).pipe(Effect.provide(AuthzLive("u1"))),
		);
		expect(readOk).toBe(true);
		expect(updateOk).toBe(true);
		expect(deleteOk).toBe(true);
	});

	it("denies non-owner on patient", async () => {
		const updateOk = await Effect.runPromise(
			can("patient.update", { ownerId: "u2" }).pipe(Effect.provide(AuthzLive("u1"))),
		);
		expect(updateOk).toBe(false);
	});

	it("create is unconditional", async () => {
		const cOk = await Effect.runPromise(
			can("consultation.create").pipe(Effect.provide(AuthzLive("u1"))),
		);
		const pOk = await Effect.runPromise(
			can("patient.create").pipe(Effect.provide(AuthzLive("u1"))),
		);
		expect(cOk).toBe(true);
		expect(pOk).toBe(true);
	});
});

describe("requireCan", () => {
	it("passes for owner", async () => {
		await expect(
			Effect.runPromise(
				requireCan("patient.read", { ownerId: "u1" }).pipe(Effect.provide(AuthzLive("u1"))),
			),
		).resolves.toBeUndefined();
	});

	it("fails Forbidden for non-owner", async () => {
		await expect(
			Effect.runPromise(
				requireCan("patient.delete", { ownerId: "u2" }).pipe(Effect.provide(AuthzLive("u1"))),
			),
		).rejects.toThrowError(Forbidden);
	});

	it("formats path in Forbidden error", async () => {
		try {
			await Effect.runPromise(
				requireCan("consultation.delete", { userId: "u2" }).pipe(Effect.provide(AuthzLive("u1"))),
			);
			expect.unreachable();
		} catch (e) {
			expect((e as Forbidden).path).toBe("consultation.delete");
		}

		try {
			await Effect.runPromise(requireCan(() => false).pipe(Effect.provide(AuthzLive("u1"))));
			expect.unreachable();
		} catch (e) {
			expect((e as Forbidden).path).toBe("~");
		}
	});
});

describe("rulesFor shape", () => {
	it("returns per-entity rules", () => {
		const rules = rulesFor("u1");
		expect(rules.consultation.create).toBe(true);
		expect(typeof rules.patient.read).toBe("function");
	});
});

describe("Principal", () => {
	it("defaults to null outside a request context", async () => {
		await expect(Effect.runPromise(Effect.service(Principal))).resolves.toBeNull();
	});

	it("resolves the bound userId", async () => {
		await expect(
			Effect.runPromise(
				Effect.provideService(Effect.service(Principal), Principal, { userId: "u9" }),
			),
		).resolves.toEqual({ userId: "u9" });
	});
});

describe("canAs / requireCanAs", () => {
	const asUser = <A, E>(userId: string, effect: Effect.Effect<A, E>) =>
		Effect.runPromise(Effect.provideService(effect, Principal, { userId }));

	it("canAs returns false with no principal", async () => {
		await expect(Effect.runPromise(canAs("patient.read", { ownerId: "u1" }))).resolves.toBe(false);
	});

	it("canAs checks rules for the bound principal", async () => {
		await expect(asUser("u1", canAs("patient.read", { ownerId: "u1" }))).resolves.toBe(true);
		await expect(asUser("u1", canAs("patient.read", { ownerId: "u2" }))).resolves.toBe(false);
	});

	it("canAs fails closed on permix errors", async () => {
		// Unknown path → PermixRuleNotDefinedError → caught → false.
		await expect(asUser("u1", canAs("bogus.path" as never))).resolves.toBe(false);
	});

	it("requireCanAs passes for owner and fails Forbidden otherwise", async () => {
		await expect(asUser("u1", requireCanAs("patient.read", { ownerId: "u1" }))).resolves.toBe(
			undefined,
		);
		await expect(
			asUser("u1", requireCanAs("patient.read", { ownerId: "u2" })),
		).rejects.toThrowError(Forbidden);
		await expect(Effect.runPromise(requireCanAs("patient.create"))).rejects.toThrowError(Forbidden);
	});
});

describe("requirePrincipalUser", () => {
	it("passes when principal matches", async () => {
		await expect(
			Effect.runPromise(
				Effect.provideService(requirePrincipalUser("u1", "patient.create"), Principal, {
					userId: "u1",
				}),
			),
		).resolves.toBeUndefined();
	});

	it("fails Forbidden on mismatch, null principal, or default path", async () => {
		const mismatch = Effect.provideService(
			requirePrincipalUser("u2", "patient.create"),
			Principal,
			{ userId: "u1" },
		);
		await expect(Effect.runPromise(mismatch)).rejects.toMatchObject({
			path: "patient.create",
		});
		await expect(Effect.runPromise(requirePrincipalUser("u1"))).rejects.toMatchObject({
			path: "principal",
		});
		await expect(
			Effect.runPromise(
				Effect.provideService(requirePrincipalUser("u2"), Principal, { userId: "u1" }),
			),
		).rejects.toMatchObject({ path: "principal" });
	});
});
