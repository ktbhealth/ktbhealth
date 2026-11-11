import { createServerFn } from "@tanstack/react-start";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ensureSessionUser, runAs } from "@ktb/server-fns";

import { Tenants, type TenantMember, type TenantRow } from "./index.ts";

// Tenants admin server functions: the /platform/tenants console mutates
// memberships through these — every call re-checks the PlatformAdmin
// gate inside the delegated Groups service (defense in depth on top of
// the layout guard). `Forbidden` collapses to `{ ok: false }` like the
// other admin fns.

const ListMembersInput = Schema.Struct({ tenantId: Schema.Number });
const AddMemberInput = Schema.Struct({
	tenantId: Schema.Number,
	memberId: Schema.NonEmptyString,
	role: Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString)),
});
const RemoveMemberInput = Schema.Struct({
	tenantId: Schema.Number,
	memberId: Schema.NonEmptyString,
});
const SetRoleInput = Schema.Struct({
	tenantId: Schema.Number,
	memberId: Schema.NonEmptyString,
	role: Schema.NullOr(Schema.Literals(["owner", "admin", "member"])),
});

const decodeListMembers = Schema.decodeUnknownSync(ListMembersInput);
const decodeAddMember = Schema.decodeUnknownSync(AddMemberInput);
const decodeRemoveMember = Schema.decodeUnknownSync(RemoveMemberInput);
const decodeSetRole = Schema.decodeUnknownSync(SetRoleInput);

type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false };

// Each fn resolves the Tenants service inside `runAs` — the bound
// Principal reaches the PlatformAdmin gate through the Groups service.

export const listTenantsFn = createServerFn({ method: "GET" }).handler(
	async (): Promise<Result<readonly TenantRow[]>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const tenants = yield* Tenants;
					const rows = yield* tenants.list();
					return { ok: true as const, data: rows };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	},
);

export const listTenantMembersFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeListMembers(input))
	.handler(async ({ data }): Promise<Result<readonly TenantMember[]>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const tenants = yield* Tenants;
					const members = yield* tenants.members(data.tenantId);
					return { ok: true as const, data: members };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});

export const addTenantMemberFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeAddMember(input))
	.handler(async ({ data }): Promise<Result<TenantMember | null>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const tenants = yield* Tenants;
					const member = yield* tenants.addMember(data);
					return { ok: true as const, data: member };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});

export const removeTenantMemberFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeRemoveMember(input))
	.handler(async ({ data }): Promise<Result<TenantMember | null>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const tenants = yield* Tenants;
					const member = yield* tenants.removeMember(data);
					return member === null ? ({ ok: false } as const) : { ok: true as const, data: member };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});

export const setTenantMemberRoleFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeSetRole(input))
	.handler(async ({ data }): Promise<Result<TenantMember | null>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const tenants = yield* Tenants;
					const member = yield* tenants.setRole(data);
					return member === null ? ({ ok: false } as const) : { ok: true as const, data: member };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});
