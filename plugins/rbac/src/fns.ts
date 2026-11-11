import { createServerFn } from "@tanstack/react-start";

import { Command } from "@effect-server-utils/cqrs";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ensureSessionUser, runAs } from "@ktb/server-fns";

import { RbacCommands, RoleRow, SubjectRoleRow } from "./api.ts";

// RBAC admin server functions (P-054): the /platform/rbac console mutates
// through these — every command re-checks the PlatformAdmin gate inside
// the handler (defense in depth on top of the layout guard). `Forbidden`
// collapses to `{ ok: false }` like the other admin fns.

const RoleInput = Schema.Struct({
	name: Schema.NonEmptyString,
	description: Schema.optionalKey(Schema.NullOr(Schema.String)),
	meta: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const RoleIdInput = Schema.Struct({ id: Schema.Number });
const RoleUpdateInput = Schema.Struct({
	id: Schema.Number,
	name: Schema.optionalKey(Schema.NonEmptyString),
	description: Schema.optionalKey(Schema.NullOr(Schema.String)),
	meta: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const PermissionInput = Schema.Struct({
	roleId: Schema.Number,
	resource: Schema.NonEmptyString,
	action: Schema.NonEmptyString,
	effect: Schema.Literals(["allow", "deny"]),
});
const RevokeInput = Schema.Struct({
	roleId: Schema.Number,
	resource: Schema.NonEmptyString,
	action: Schema.NonEmptyString,
});
const AssignInput = Schema.Struct({
	subjectKind: Schema.Literals(["user", "group"]),
	subjectId: Schema.NonEmptyString,
	roleId: Schema.Number,
	tenantId: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
	expiresAt: Schema.optionalKey(
		Schema.NullOr(Schema.Union([Schema.Date, Schema.String, Schema.Number])),
	),
});

const decodeRole = Schema.decodeUnknownSync(RoleInput);
const decodeRoleId = Schema.decodeUnknownSync(RoleIdInput);
const decodeRoleUpdate = Schema.decodeUnknownSync(RoleUpdateInput);
const decodePermission = Schema.decodeUnknownSync(PermissionInput);
const decodeRevoke = Schema.decodeUnknownSync(RevokeInput);
const decodeAssign = Schema.decodeUnknownSync(AssignInput);

type Role = Schema.Schema.Type<typeof RoleRow>;
type SubjectRole = Schema.Schema.Type<typeof SubjectRoleRow>;
type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false };

// Each fn dispatches its command through the app-wide typed dispatcher
// inside `runAs` — the bound Principal reaches the handler's
// `grantedBy` and the PlatformAdmin gate.

export const createRoleFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeRole(input))
	.handler(async ({ data }): Promise<Result<Role>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const commands = yield* Command.dispatcher(RbacCommands);
					const role = yield* commands["rbac.createRole"](data);
					return { ok: true as const, data: role };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});

export const updateRoleFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeRoleUpdate(input))
	.handler(async ({ data }): Promise<Result<Role | null>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const commands = yield* Command.dispatcher(RbacCommands);
					const role = yield* commands["rbac.updateRole"](data);
					return role === null ? ({ ok: false } as const) : { ok: true as const, data: role };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});

export const deleteRoleFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeRoleId(input))
	.handler(async ({ data }): Promise<Result<null>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const commands = yield* Command.dispatcher(RbacCommands);
					yield* commands["rbac.deleteRole"](data);
					return { ok: true as const, data: null };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});

export const setRolePermissionFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodePermission(input))
	.handler(async ({ data }): Promise<Result<null>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const commands = yield* Command.dispatcher(RbacCommands);
					yield* commands["rbac.setRolePermission"](data);
					return { ok: true as const, data: null };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});

export const revokeRolePermissionFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeRevoke(input))
	.handler(async ({ data }): Promise<Result<null>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const commands = yield* Command.dispatcher(RbacCommands);
					yield* commands["rbac.revokeRolePermission"](data);
					return { ok: true as const, data: null };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});

export const assignSubjectFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeAssign(input))
	.handler(async ({ data }): Promise<Result<SubjectRole>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const commands = yield* Command.dispatcher(RbacCommands);
					const assignment = yield* commands["rbac.assignSubject"](data);
					return { ok: true as const, data: assignment };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});

export const unassignSubjectFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeRoleId(input))
	.handler(async ({ data }): Promise<Result<null>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const commands = yield* Command.dispatcher(RbacCommands);
					yield* commands["rbac.unassignSubject"](data);
					return { ok: true as const, data: null };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});
