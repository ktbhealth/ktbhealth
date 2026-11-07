import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { AuthzLive, can, Forbidden, requireCan, rulesFor } from "./index.ts";

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
