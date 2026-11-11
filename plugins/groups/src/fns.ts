import { createServerFn } from "@tanstack/react-start";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ensureSessionUser, runAs } from "@ktb/server-fns";

import { Groups, type Group, type GroupMember } from "./index.ts";

// Groups admin server functions: the /platform/groups console mutates
// through these — every call re-checks the PlatformAdmin gate inside the
// Groups service (defense in depth on top of the layout guard).
// `Forbidden` collapses to `{ ok: false }` like the other admin fns.

const CreateGroupInput = Schema.Struct({
	name: Schema.NonEmptyString,
	slug: Schema.NonEmptyString,
	kind: Schema.NonEmptyString,
	meta: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const GroupIdInput = Schema.Struct({ id: Schema.Number });
const ListMembersInput = Schema.Struct({ groupId: Schema.Number });
const AddMemberInput = Schema.Struct({
	groupId: Schema.Number,
	memberKind: Schema.NonEmptyString,
	memberId: Schema.NonEmptyString,
	role: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const RemoveMemberInput = Schema.Struct({
	groupId: Schema.Number,
	memberKind: Schema.NonEmptyString,
	memberId: Schema.NonEmptyString,
});

const decodeCreateGroup = Schema.decodeUnknownSync(CreateGroupInput);
const decodeGroupId = Schema.decodeUnknownSync(GroupIdInput);
const decodeListMembers = Schema.decodeUnknownSync(ListMembersInput);
const decodeAddMember = Schema.decodeUnknownSync(AddMemberInput);
const decodeRemoveMember = Schema.decodeUnknownSync(RemoveMemberInput);

type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false };

// Each fn resolves the Groups service inside `runAs` — the bound
// Principal reaches the PlatformAdmin gate.

export const createGroupFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeCreateGroup(input))
	.handler(async ({ data }): Promise<Result<Group | null>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const groups = yield* Groups;
					const group = yield* groups.create(data);
					return { ok: true as const, data: group };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});

export const deleteGroupFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeGroupId(input))
	.handler(async ({ data }): Promise<Result<null>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const groups = yield* Groups;
					const deleted = yield* groups.delete(data.id);
					return deleted ? ({ ok: true as const, data: null } as const) : ({ ok: false } as const);
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});

export const listGroupMembersFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeListMembers(input))
	.handler(async ({ data }): Promise<Result<GroupMember[]>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const groups = yield* Groups;
					const members = yield* groups.members(data.groupId);
					return { ok: true as const, data: members };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});

export const addGroupMemberFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeAddMember(input))
	.handler(async ({ data }): Promise<Result<GroupMember | null>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const groups = yield* Groups;
					const member = yield* groups.addMember(data);
					return { ok: true as const, data: member };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});

export const removeGroupMemberFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeRemoveMember(input))
	.handler(async ({ data }): Promise<Result<GroupMember | null>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const groups = yield* Groups;
					const member = yield* groups.removeMember(data);
					return member === null ? ({ ok: false } as const) : { ok: true as const, data: member };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});
