import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		let validate: ((x: unknown) => unknown) | undefined;
		const chain = {
			validator: (v: (x: unknown) => unknown) => {
				validate = v;
				return chain;
			},
			handler: (h: (arg?: { data?: unknown }) => unknown) => async (arg?: { data?: unknown }) =>
				h(arg === undefined ? {} : { ...arg, data: validate ? validate(arg.data) : arg.data }),
		};
		return chain;
	},
}));

import { Auth } from "@ktb/auth";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { groupsServicesPlugin } from "@ktb/groups";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import { Principal } from "@ktb/authz";
import { resetServerRuntime, setServerRuntime } from "@ktb/server-fns";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { tenantServicesPlugin } from "./index.ts";
import {
	addTenantMemberFn,
	listTenantMembersFn,
	listTenantsFn,
	removeTenantMemberFn,
	setTenantMemberRoleFn,
} from "./fns.ts";

const DDL = `
CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, meta TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO groups (name, slug, kind, meta, created_at, updated_at) VALUES
  ('Clinic A', 'clinic-a', 'clinic', NULL, 1000, 1000);
CREATE TABLE group_members (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, member_kind TEXT NOT NULL, member_id TEXT NOT NULL, role TEXT, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX group_members_group_member_idx ON group_members (group_id, member_kind, member_id);
INSERT INTO group_members (group_id, member_kind, member_id, role, created_at) VALUES
  (1, 'user', 'u1', 'admin', 1000),
  (1, 'patient', 'p1', 'member', 1000);
`;

const sessionFor = (email: string | null) =>
	email === null
		? null
		: {
				user: { id: `id-${email}`, email, name: email },
				sessionId: "s1",
				expiresAt: new Date(Date.now() + 3600_000),
			};

describe("tenants admin fns", () => {
	let runtime: ManagedRuntime.ManagedRuntime<unknown, never>;
	let currentEmail: string | null = null;

	beforeAll(async () => {
		const db = makeDb(makeD1(DDL));
		const env = Layer.mergeAll(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		const services = (tenantServicesPlugin.services as Layer.Layer<unknown, unknown, unknown>).pipe(
			Layer.provideMerge(groupsServicesPlugin.services as Layer.Layer<unknown, unknown, unknown>),
			Layer.provide(env),
		) as unknown as Layer.Layer<unknown, never, never>;
		runtime = ManagedRuntime.make(services);
		const auth = Auth.of({
			getSession: async () => sessionFor(currentEmail) as never,
		});
		setServerRuntime({
			run: (effect) => runtime.runPromise(effect.pipe(Effect.provideService(Auth, auth))),
			runAs: (user, effect) =>
				runtime.runPromise(
					effect.pipe(
						Effect.provideService(Principal, {
							userId: user.id,
							email: user.email,
						}),
					),
				),
			audioTranscribeModel: "test-model",
			getLocale: () => "en",
		});
	});

	afterAll(() => {
		resetServerRuntime();
		return runtime.dispose();
	});

	it("rejects anonymous callers", async () => {
		currentEmail = null;
		await expect(listTenantsFn()).rejects.toThrow("unauthenticated");
		await expect(listTenantMembersFn({ data: { tenantId: 1 } })).rejects.toThrow("unauthenticated");
	});

	it("denies non-admin principals on every admin fn", async () => {
		currentEmail = "user@x.com";
		const results = await Promise.all([
			listTenantsFn(),
			listTenantMembersFn({ data: { tenantId: 1 } }),
			addTenantMemberFn({ data: { tenantId: 1, memberId: "u2" } }),
			removeTenantMemberFn({ data: { tenantId: 1, memberId: "u1" } }),
			setTenantMemberRoleFn({ data: { tenantId: 1, memberId: "u1", role: "member" } }),
		]);
		for (const res of results) expect(res).toEqual({ ok: false });
	});

	it("runs the full admin lifecycle", async () => {
		currentEmail = "admin@x.com";

		const tenants = await listTenantsFn();
		expect(tenants.ok).toBe(true);
		expect(tenants.ok && tenants.data.map((t) => t.slug)).toEqual(["clinic-a"]);
		expect(tenants.ok && tenants.data[0]?.memberCount).toBe(2);

		// Only user-kind memberships are tenant members — the seeded
		// patient row is filtered out by the service.
		const members = await listTenantMembersFn({ data: { tenantId: 1 } });
		expect(members.ok && members.data.map((m) => m.memberId)).toEqual(["u1"]);

		const added = await addTenantMemberFn({
			data: { tenantId: 1, memberId: "u9", role: "admin" },
		});
		expect(added.ok).toBe(true);
		// Role omitted → stored as null.
		expect((await addTenantMemberFn({ data: { tenantId: 1, memberId: "u10" } })).ok).toBe(true);

		expect(
			(
				await setTenantMemberRoleFn({
					data: { tenantId: 1, memberId: "u9", role: "owner" },
				})
			).ok,
		).toBe(true);
		// Unknown membership → ok:false.
		expect(
			(
				await setTenantMemberRoleFn({
					data: { tenantId: 1, memberId: "ghost", role: "admin" },
				})
			).ok,
		).toBe(false);

		expect((await removeTenantMemberFn({ data: { tenantId: 1, memberId: "u9" } })).ok).toBe(true);
		expect((await removeTenantMemberFn({ data: { tenantId: 1, memberId: "ghost" } })).ok).toBe(
			false,
		);
	});
});
