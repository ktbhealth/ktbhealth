import { createServerFn } from "@tanstack/react-start";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Schema } from "effect";

import { Email } from "@ktb/email";
import { getDoctorContext, getLocale, getSessionUser, run, runAs } from "@ktb/server-fns";

import { secretaryMessages } from "./i18n.ts";
import { Secretaries, type InviteErrorCode } from "./index.ts";
import type { DoctorAccess } from "./schema.ts";

// Secretaries plugin server functions: the route modules under
// src/routes/** are owned by this package and reach the app runtime
// through @ktb/server-fns — no host imports. Every call runs as the
// *session* user: a doctor manages their own secretaries, never the
// ones of a doctor they are acting for.

const decodeNumber = Schema.decodeUnknownSync(Schema.Number);
const decodeInvite = Schema.decodeUnknownSync(Schema.Struct({ email: Schema.String }));

/** What the management page shows per delegation. */
export interface SecretaryItem {
	readonly id: number;
	readonly email: string;
	readonly status: string;
}

const toItem = (row: DoctorAccess): SecretaryItem => ({
	id: row.id,
	email: row.email,
	status: row.status,
});

/** Active UI locale for the current request — route loaders attach it
 * to their data so plugin views never import the host's i18n runtime. */
export const localeFn = createServerFn({ method: "GET" }).handler(() => getLocale());

export const sessionUserFn = createServerFn({ method: "GET" }).handler(() => getSessionUser());

/** The session doctor's secretaries; null when the caller is anonymous
 * or has no doctor profile of their own. */
export const listSecretariesFn = createServerFn({ method: "GET" }).handler(async () => {
	const user = await getSessionUser();
	if (!user) return null;
	return runAs(
		user,
		Effect.gen(function* () {
			const secretaries = yield* Secretaries;
			const rows = yield* secretaries.list();
			return rows.map(toItem);
		}).pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null))),
	);
});

export type InviteSecretaryResult =
	| { readonly ok: true; readonly secretary: SecretaryItem }
	| { readonly ok: false; readonly error: InviteErrorCode | "failed" };

/**
 * Tell the invitee by email, in the inviting doctor's current locale.
 * Best effort: the delegation already exists, so a deployment without
 * email or a failed delivery never fails the invite.
 */
const notifyInvitee = async (to: string, doctorName: string): Promise<void> => {
	const { getRequestUrl } = await import("@tanstack/react-start/server");
	const copy = secretaryMessages(getLocale()).inviteEmail;
	const url = new URL("/login", getRequestUrl()).toString();
	const sender = await run(
		Effect.map(Effect.serviceOption(Email), (email) => Option.getOrNull(email)),
	);
	if (!sender) return;
	try {
		await sender.send({ to, subject: copy.subject(doctorName), text: copy.body(doctorName, url) });
	} catch (error) {
		console.error("secretary invite email failed", error);
	}
};

/** Invite an email to act for the session doctor. */
export const inviteSecretaryFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeInvite(input))
	.handler(async ({ data }): Promise<InviteSecretaryResult> => {
		const context = await getDoctorContext();
		if (!context) return { ok: false, error: "failed" };
		const result = await runAs(
			context.user,
			Effect.gen(function* () {
				const secretaries = yield* Secretaries;
				const row = yield* secretaries.invite(data.email);
				return { ok: true as const, secretary: toItem(row) };
			}).pipe(
				Effect.catchTag("InviteRejected", (e) =>
					Effect.succeed({ ok: false as const, error: e.code }),
				),
				Effect.catchTag("Forbidden", () =>
					Effect.succeed({ ok: false as const, error: "failed" as const }),
				),
			),
		);
		if (result.ok) {
			const own = context.profiles.find((p) => p.role === "owner");
			await notifyInvitee(result.secretary.email, own?.displayName ?? context.user.email);
		}
		return result;
	});

/** Remove a secretary's access. `{ ok: false }` when the delegation is
 * not the session doctor's. */
export const revokeSecretaryFn = createServerFn({ method: "POST" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }) => {
		const user = await getSessionUser();
		if (!user) return { ok: false };
		return runAs(
			user,
			Effect.gen(function* () {
				const secretaries = yield* Secretaries;
				return { ok: yield* secretaries.revoke(id) };
			}).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false }))),
		);
	});
