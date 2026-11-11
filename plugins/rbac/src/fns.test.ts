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
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import { Principal } from "@ktb/authz";
import { resetServerRuntime, setServerRuntime } from "@ktb/server-fns";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { rbacServicesPlugin } from "./index.ts";
import {
	assignSubjectFn,
	createRoleFn,
	deleteRoleFn,
	revokeRolePermissionFn,
	setRolePermissionFn,
	unassignSubjectFn,
	updateRoleFn,
} from "./fns.ts";

const DDL = `
CREATE TABLE roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, meta TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE role_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE, resource TEXT NOT NULL, action TEXT NOT NULL, effect TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX role_permissions_role_resource_action_idx ON role_permissions (role_id, resource, action);
CREATE TABLE subject_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE, tenant_id TEXT, granted_by TEXT, expires_at INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX subject_roles_subject_idx ON subject_roles (subject_kind, subject_id);
CREATE TABLE permission_epoch (id INTEGER PRIMARY KEY, epoch INTEGER NOT NULL DEFAULT 0);
CREATE TABLE group_members (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, member_kind TEXT NOT NULL, member_id TEXT NOT NULL, role TEXT, created_at INTEGER NOT NULL);
`;

const sessionFor = (email: string | null) =>
	email === null
		? null
		: {
				user: { id: `id-${email}`, email, name: email },
				sessionId: "s1",
				expiresAt: new Date(Date.now() + 3600_000),
			};

describe("rbac admin fns", () => {
	let runtime: ManagedRuntime.ManagedRuntime<unknown, never>;
	let currentEmail: string | null = null;

	beforeAll(async () => {
		const db = makeDb(makeD1(DDL));
		const env = Layer.mergeAll(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		const services = rbacServicesPlugin.services as Layer.Layer<unknown, unknown, unknown>;
		runtime = ManagedRuntime.make(
			services.pipe(Layer.provide(env)) as unknown as Layer.Layer<unknown, never, never>,
		);
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
		await expect(createRoleFn({ data: { name: "x" } })).rejects.toThrow("unauthenticated");
	});

	it("denies non-admin principals", async () => {
		currentEmail = "user@x.com";
		const res = await createRoleFn({ data: { name: "nurse" } });
		expect(res).toEqual({ ok: false });
	});

	it("runs the full admin lifecycle", async () => {
		currentEmail = "admin@x.com";
		const created = await createRoleFn({ data: { name: "auditor", description: "RO" } });
		expect(created.ok).toBe(true);
		const roleId = (created as { data: { id: number } }).data.id;

		expect(
			(
				await setRolePermissionFn({
					data: { roleId, resource: "patient", action: "read", effect: "allow" },
				})
			).ok,
		).toBe(true);
		expect(
			(
				await revokeRolePermissionFn({
					data: { roleId, resource: "patient", action: "read" },
				})
			).ok,
		).toBe(true);

		const assigned = await assignSubjectFn({
			data: {
				subjectKind: "user",
				subjectId: "u1",
				roleId,
				tenantId: "t1",
				expiresAt: "2030-01-01T00:00:00.000Z",
			},
		});
		expect(assigned.ok).toBe(true);
		const assignmentId = (assigned as { data: { id: number } }).data.id;

		expect((await updateRoleFn({ data: { id: roleId, description: "RO2" } })).ok).toBe(true);
		// Unknown role → ok:false (null row).
		expect((await updateRoleFn({ data: { id: 9999, name: "ghost" } })).ok).toBe(false);

		expect((await unassignSubjectFn({ data: { id: assignmentId } })).ok).toBe(true);
		expect((await deleteRoleFn({ data: { id: roleId } })).ok).toBe(true);
	});
});
