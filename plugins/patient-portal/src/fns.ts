import { createServerFn } from "@tanstack/react-start";

import * as Effect from "effect/Effect";
import { Schema } from "effect";

import {
	getLocale,
	getPatientContext,
	getSessionUser,
	runAs,
	setPatientSelection,
} from "@ktb/server-fns";

import { PatientPortal, type CpfErrorCode, type PortalConsultation } from "./index.ts";

// Patient-portal plugin server functions — the patient side. Every call
// runs as the *session* user: the portal shows what the person signed
// in may see, never what a doctor they act for may. Clinical data is
// read-only here: the portal lists and opens consultations, nothing more.

const decodeNumber = Schema.decodeUnknownSync(Schema.Number);
const decodeString = Schema.decodeUnknownSync(Schema.String);

/** Active UI locale for the current request — route loaders attach it
 * to their data so plugin views never import the host's i18n runtime. */
export const localeFn = createServerFn({ method: "GET" }).handler(() => getLocale());

/**
 * Everything the portal home shows; null for anonymous visitors. An
 * entry point: invites are claimed and records matched by CPF first, so
 * a new link shows up as soon as the patient opens the portal.
 */
export const portalFn = createServerFn({ method: "GET" }).handler(async () => {
	const context = await getPatientContext(undefined, { syncLinks: true });
	if (!context) return null;
	const { user, profiles, active } = context;
	return runAs(
		user,
		Effect.gen(function* () {
			const portal = yield* PatientPortal;
			return {
				user: { name: user.name, email: user.email },
				hasCpf: yield* portal.hasCpf(),
				profiles,
				profile: active === null ? null : yield* portal.profile(active.patientId),
				consultations: active === null ? [] : yield* portal.consultations(active.patientId),
			};
		}).pipe(
			// The link was revoked between resolving the context and reading it.
			Effect.catchTag("Forbidden", () =>
				Effect.succeed({
					user: { name: user.name, email: user.email },
					hasCpf: true,
					profiles: [],
					profile: null,
					consultations: [],
				}),
			),
		),
	);
});

export type PortalConsultationResult =
	| { readonly status: "anonymous" }
	| { readonly status: "missing" }
	| { readonly status: "ok"; readonly consultation: PortalConsultation };

/**
 * One consultation, read-only. "missing" covers both a consultation that
 * does not exist and one the user holds no active link to — the portal
 * never tells the two apart.
 */
export const portalConsultationFn = createServerFn({ method: "GET" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }): Promise<PortalConsultationResult> => {
		const user = await getSessionUser();
		if (!user) return { status: "anonymous" };
		return runAs(
			user,
			Effect.gen(function* () {
				const portal = yield* PatientPortal;
				return { status: "ok" as const, consultation: yield* portal.consultation(id) };
			}).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ status: "missing" as const }))),
		);
	});

/** Open `patientId` in the portal from now on. Refused (`{ ok: false }`)
 * for a record the user holds no active link to. */
export const selectPatientFn = createServerFn({ method: "POST" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: patientId }) => {
		const context = await getPatientContext();
		if (!context?.profiles.some((p) => p.patientId === patientId)) return { ok: false };
		await setPatientSelection(patientId);
		return { ok: true };
	});

export type SetCpfResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly error: CpfErrorCode | "failed" };

/** Store the session user's CPF (validated server-side). The next
 * portal load matches it against patient records. */
export const setCpfFn = createServerFn({ method: "POST" })
	.validator((cpf: string) => decodeString(cpf))
	.handler(async ({ data: cpf }): Promise<SetCpfResult> => {
		const user = await getSessionUser();
		if (!user) return { ok: false, error: "failed" };
		return runAs(
			user,
			Effect.gen(function* () {
				const portal = yield* PatientPortal;
				yield* portal.setCpf(cpf);
				return { ok: true as const };
			}).pipe(
				Effect.catchTag("CpfRejected", (e) =>
					Effect.succeed({ ok: false as const, error: e.code }),
				),
				Effect.catchTag("Forbidden", () =>
					Effect.succeed({ ok: false as const, error: "failed" as const }),
				),
			),
		);
	});
