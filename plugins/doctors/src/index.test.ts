import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { Principal } from "@ktb/authz";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";

import {
	Doctors,
	DoctorsLive,
	doctorsRoutesPlugin,
	doctorsServicesPlugin,
	doctorsTablesPlugin,
	ensureDoctorProfile,
	getDoctorByUser,
	plugins,
} from "./index.ts";
import { doctors } from "./schema.ts";

const DDL = `
CREATE TABLE doctors (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, crm TEXT, specialty TEXT, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0);
`;

describe("doctors repo", () => {
	const db = makeDb(makeD1(DDL));

	it("has no profile for an unknown user", async () => {
		expect(await getDoctorByUser(db, "u1")).toBeNull();
	});

	it("creates the profile once and keeps it on later calls", async () => {
		const created = await ensureDoctorProfile(db, "u1", "Dra. Ana");
		expect(created).toMatchObject({ userId: "u1", displayName: "Dra. Ana" });
		const again = await ensureDoctorProfile(db, "u1", "Another Name");
		expect(again.id).toBe(created.id);
		expect(again.displayName).toBe("Dra. Ana");
		expect(await db.select().from(doctors)).toHaveLength(1);
	});
});

describe("DoctorsLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Doctors, never>;
	const db = makeDb(makeD1(DDL));

	beforeAll(() => {
		runtime = ManagedRuntime.make(DoctorsLive.pipe(Layer.provide(Layer.succeed(Db, db))));
	});

	afterAll(() => runtime.dispose());

	const ensureAs = (principal: { userId: string; actorId?: string } | null) =>
		runtime.runPromise(
			Effect.flatMap(Doctors, (svc) => svc.ensureProfile("Dra. Ana")).pipe(
				Effect.provideService(Principal, principal),
				Effect.catchTag("Forbidden", (e) => Effect.succeed(`forbidden:${e.path}`)),
			),
		);

	it("creates the caller's own profile", async () => {
		expect(await ensureAs({ userId: "u1" })).toMatchObject({
			userId: "u1",
			displayName: "Dra. Ana",
		});
	});

	it("refuses without a principal and under delegation", async () => {
		expect(await ensureAs(null)).toBe("forbidden:doctor.create");
		expect(await ensureAs({ userId: "u2", actorId: "sec" })).toBe("forbidden:doctor.create");
		expect(await getDoctorByUser(db, "u2")).toBeNull();
	});
});

describe("doctors plugins", () => {
	it("contributes the doctors table and service", () => {
		expect(plugins).toEqual([doctorsTablesPlugin, doctorsServicesPlugin, doctorsRoutesPlugin]);
		expect(doctorsRoutesPlugin.id).toBe("doctors.routes");
		expect(doctorsRoutesPlugin.routes).toHaveLength(1);
		expect(doctorsTablesPlugin.id).toBe("doctors.tables");
		expect(doctorsTablesPlugin.tables.doctors).toBe(doctors);
		expect(doctorsServicesPlugin.id).toBe("doctors.services");
		expect(doctorsServicesPlugin.services).toBe(DoctorsLive);
	});
});
