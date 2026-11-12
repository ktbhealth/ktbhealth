import { createServerFn } from "@tanstack/react-start";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Schema } from "effect";
import { and, eq } from "drizzle-orm";

import { Db } from "@ktb/db";
import { Email } from "@ktb/email";
import { patients } from "@ktb/patients/schema";
import { getDoctorAccess, getDoctorUser, getLocale, run, runAs } from "@ktb/server-fns";

import { patientAccessMessages } from "./i18n.ts";
import { PatientLinks, type PatientInviteErrorCode, type PatientLink } from "./index.ts";

// Patient-access plugin server functions — the doctor side of portal
// access. Every call runs as the *acting doctor* (`getDoctorUser`), so a
// secretary manages links for the doctor they act for; the service
// scopes every operation to that doctor's patients.

const decodeNumber = Schema.decodeUnknownSync(Schema.Number);
const decodeInvite = Schema.decodeUnknownSync(
	Schema.Struct({ patientId: Schema.Number, email: Schema.String, relation: Schema.String }),
);

/** Active UI locale for the current request — route loaders attach it
 * to their data so plugin views never import the host's i18n runtime. */
export const localeFn = createServerFn({ method: "GET" }).handler(() => getLocale());

/** Doctor-side standing of the request — drives the route guard. */
export const doctorAccessFn = createServerFn({ method: "GET" }).handler(() => getDoctorAccess());

/**
 * A patient of the acting doctor with its portal links; null when the
 * caller is not acting as a doctor or the patient is not theirs. The
 * record's email comes along so an invite can be prefilled with it.
 */
export const patientLinksFn = createServerFn({ method: "GET" })
	.validator((patientId: number) => decodeNumber(patientId))
	.handler(async ({ data: patientId }) => {
		const user = await getDoctorUser();
		if (!user) return null;
		return runAs(
			user,
			Effect.gen(function* () {
				const service = yield* PatientLinks;
				const links = yield* service.list(patientId);
				const db = yield* Db;
				const [patient] = yield* Effect.promise(() =>
					db
						.select({ id: patients.id, name: patients.name, email: patients.email })
						.from(patients)
						.where(and(eq(patients.id, patientId), eq(patients.ownerId, user.id))),
				);
				return { patient: patient!, links };
			}).pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null))),
		);
	});

export type InvitePatientResult =
	| {
			readonly ok: true;
			readonly link: Pick<PatientLink, "id" | "email" | "status">;
			/** Whether the access email actually went out — false when this
			 * deployment sends no email or the delivery failed. */
			readonly emailed: boolean;
	  }
	| { readonly ok: false; readonly error: PatientInviteErrorCode | "failed" };

/**
 * Tell the invitee by email, in the acting user's current locale. Best
 * effort: the link already exists, so a deployment without email or a
 * failed delivery never fails the invite — it only reports `false`.
 */
const notifyInvitee = async (
	to: string,
	doctorName: string,
	patientName: string,
): Promise<boolean> => {
	const { getRequestUrl } = await import("@tanstack/react-start/server");
	const copy = patientAccessMessages(getLocale()).inviteEmail;
	const url = new URL("/portal/login", getRequestUrl()).toString();
	const sender = await run(
		Effect.map(Effect.serviceOption(Email), (email) => Option.getOrNull(email)),
	);
	if (!sender) return false;
	try {
		await sender.send({
			to,
			subject: copy.subject(doctorName),
			text: copy.body(doctorName, patientName, url),
		});
		return true;
	} catch (error) {
		console.error("patient invite email failed", error);
		return false;
	}
};

/** Invite an email to a patient record of the acting doctor. */
export const invitePatientFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeInvite(input))
	.handler(async ({ data }): Promise<InvitePatientResult> => {
		const user = await getDoctorUser();
		if (!user) return { ok: false, error: "failed" };
		const result = await runAs(
			user,
			Effect.gen(function* () {
				const service = yield* PatientLinks;
				const row = yield* service.invite(data);
				const db = yield* Db;
				const [patient] = yield* Effect.promise(() =>
					db.select({ name: patients.name }).from(patients).where(eq(patients.id, data.patientId)),
				);
				return {
					ok: true as const,
					link: { id: row.id, email: row.email ?? "", status: row.status },
					patientName: patient!.name,
				};
			}).pipe(
				Effect.catchTag("PatientInviteRejected", (e) =>
					Effect.succeed({ ok: false as const, error: e.code }),
				),
				Effect.catchTag("Forbidden", () =>
					Effect.succeed({ ok: false as const, error: "failed" as const }),
				),
			),
		);
		if (!result.ok) return result;
		const emailed = await notifyInvitee(
			result.link.email,
			user.doctor.name ?? user.doctor.email,
			result.patientName,
		);
		return { ok: true, link: result.link, emailed };
	});

/** Apply `action` to link `id` as the acting doctor; `{ ok: false }`
 * for non-doctors and for a link that is not one of their patients'. */
const changeLink = async (action: "approve" | "revoke", id: number) => {
	const user = await getDoctorUser();
	if (!user) return { ok: false };
	return runAs(
		user,
		Effect.gen(function* () {
			const service = yield* PatientLinks;
			return { ok: yield* service[action](id) };
		}).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false }))),
	);
};

// Each server fn is its own top-level `createServerFn` chain: the Start
// compiler only turns those into RPC stubs. One built by a factory is
// left as-is, so its handler would run — and fail — in the browser.

/** Approve a pending CPF match on one of the acting doctor's patients. */
export const approvePatientLinkFn = createServerFn({ method: "POST" })
	.validator((id: number) => decodeNumber(id))
	.handler(({ data: id }) => changeLink("approve", id));

/** Remove a link from one of the acting doctor's patients. */
export const revokePatientLinkFn = createServerFn({ method: "POST" })
	.validator((id: number) => decodeNumber(id))
	.handler(({ data: id }) => changeLink("revoke", id));
