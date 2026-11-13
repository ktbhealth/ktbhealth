import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { Option } from "effect";
import { physical } from "@tanstack/virtual-file-routes";

import { decodeAnamnesisOption } from "@ktb/anamnesis/schema";
import { SECTION_LABELS, type Anamnesis, type AnamnesisSectionKey } from "@ktb/anamnesis/types";
import { Forbidden, Principal } from "@ktb/authz";
import { Db, type DbClient } from "@ktb/db";
import { consultations, doctors, patientAccess, patients, user } from "@ktb/db/schema";
import { normalizeEmail } from "@ktb/patient-access";
import { definePlugin, type Plugin } from "@ktb/kernel";
import { isValidCpf } from "@ktb/patients/record";

/**
 * The patient record a portal profile opens: whose it is and who keeps
 * it. The portal is read-only and shows consultations only — the
 * record's registration data stays on the doctor side.
 */
export interface PortalProfile {
	readonly patientId: number;
	readonly relation: string;
	readonly name: string;
	/** Display name of the doctor who keeps the record, when known. */
	readonly doctorName: string | null;
}

/** The record `patientId` as `userId` may see it — null unless they hold
 * an *active* link to it. */
export async function getPortalProfile(
	db: DbClient,
	userId: string,
	patientId: number,
): Promise<PortalProfile | null> {
	const [row] = await db
		.select({
			patientId: patients.id,
			relation: patientAccess.relation,
			name: patients.name,
			doctorName: doctors.displayName,
		})
		.from(patientAccess)
		.innerJoin(patients, eq(patientAccess.patientId, patients.id))
		.leftJoin(doctors, eq(doctors.userId, patients.ownerId))
		.where(
			and(
				eq(patientAccess.patientId, patientId),
				eq(patientAccess.userId, userId),
				eq(patientAccess.status, "active"),
			),
		);
	return row ?? null;
}

/** A consultation as the portal lists it. */
export interface PortalConsultationSummary {
	readonly id: number;
	readonly createdAt: Date;
	/** Chief complaint as the doctor recorded it, when there is one. */
	readonly chiefComplaint: string | null;
}

/** One section of the record the doctor saved. Drafting metadata —
 * confidence, the transcript sentences behind it — is not part of it. */
export interface PortalSection {
	readonly key: AnamnesisSectionKey;
	readonly content: string;
}

/** A consultation as the portal shows it: the saved record, read-only.
 * Transcript and audio never leave the doctor side. */
export interface PortalConsultation {
	readonly id: number;
	readonly createdAt: Date;
	readonly patientId: number;
	readonly patientName: string;
	/** Display name of the doctor who recorded it, when known. */
	readonly doctorName: string | null;
	readonly sections: readonly PortalSection[];
}

/** Prefix of the placeholder a drafter leaves in a section the doctor
 * still has to write (see the heuristic extractor and the LLM prompt). */
const UNFILLED = "A preencher pelo médico";

const SECTION_KEYS = Object.keys(SECTION_LABELS) as AnamnesisSectionKey[];

/** Stored anamnesis JSON → typed document, null on any drift. */
const parseAnamnesis = (json: string | null): Anamnesis | null => {
	try {
		/* v8 ignore next -- both queries only select rows with a non-null anamnesis */
		return Option.getOrNull(decodeAnamnesisOption(JSON.parse(json ?? "null")));
	} catch {
		return null;
	}
};

/** What the doctor actually wrote in a section, or null when it is
 * empty or still the drafter's placeholder. */
const written = (content: string): string | null => {
	const text = content.trim();
	return text === "" || text.startsWith(UNFILLED) ? null : text;
};

/** The sections of a record the doctor filled in, in document order. */
export const portalSections = (anamnesis: Anamnesis): PortalSection[] =>
	SECTION_KEYS.flatMap((key) => {
		const content = written(anamnesis[key].content);
		return content === null ? [] : [{ key, content }];
	});

/** Rows of `consultations` a holder of an *active* link may see: the
 * ones with a saved record. A consultation still being transcribed, or
 * saved without an anamnesis, is not shown. */
const visibleTo = (userId: string) =>
	and(
		eq(patientAccess.userId, userId),
		eq(patientAccess.status, "active"),
		isNotNull(consultations.anamnesis),
	);

/**
 * The consultations of `patientId` as `userId` may see them, newest
 * first — empty unless they hold an *active* link to the record.
 */
export async function listPortalConsultations(
	db: DbClient,
	userId: string,
	patientId: number,
): Promise<PortalConsultationSummary[]> {
	const rows = await db
		.select({
			id: consultations.id,
			createdAt: consultations.createdAt,
			anamnesis: consultations.anamnesis,
		})
		.from(consultations)
		.innerJoin(patientAccess, eq(patientAccess.patientId, consultations.patientId))
		.where(and(eq(consultations.patientId, patientId), visibleTo(userId)))
		.orderBy(desc(consultations.createdAt), desc(consultations.id));
	return rows.flatMap(({ anamnesis, ...row }) => {
		const parsed = parseAnamnesis(anamnesis);
		if (parsed === null) return [];
		return [{ ...row, chiefComplaint: written(parsed.queixa_principal.content) }];
	});
}

/**
 * Consultation `id` as `userId` may see it — null unless it has a saved
 * record and they hold an *active* link to its patient.
 */
export async function getPortalConsultation(
	db: DbClient,
	userId: string,
	id: number,
): Promise<PortalConsultation | null> {
	const [row] = await db
		.select({
			id: consultations.id,
			createdAt: consultations.createdAt,
			anamnesis: consultations.anamnesis,
			patientId: patients.id,
			patientName: patients.name,
			doctorName: doctors.displayName,
		})
		.from(consultations)
		.innerJoin(patients, eq(consultations.patientId, patients.id))
		.innerJoin(patientAccess, eq(patientAccess.patientId, patients.id))
		.leftJoin(doctors, eq(doctors.userId, consultations.userId))
		.where(and(eq(consultations.id, id), visibleTo(userId)));
	if (row === undefined) return null;
	const { anamnesis, ...consultation } = row;
	const parsed = parseAnamnesis(anamnesis);
	if (parsed === null) return null;
	return { ...consultation, sections: portalSections(parsed) };
}

/**
 * Invites addressed to the user's account email still sitting unclaimed
 * because the address is not verified — how many records wait on the
 * verification step. Zero for a verified address: every matching invite
 * is claimed by `syncLinks` on the next entry point, so a lingering one
 * can only belong to an unverified account. The email comparison uses
 * the same normalization the invite write path applies.
 */
export async function countAwaitingInvites(db: DbClient, userId: string): Promise<number> {
	const [account] = await db
		.select({ email: user.email, emailVerified: user.emailVerified })
		.from(user)
		.where(eq(user.id, userId));
	if (account === undefined || account.emailVerified) return 0;
	const rows = await db
		.select({ id: patientAccess.id })
		.from(patientAccess)
		.where(
			and(
				eq(patientAccess.email, normalizeEmail(account.email)),
				eq(patientAccess.status, "invited"),
			),
		);
	return rows.length;
}

/** Digits of a CPF. */
export const cpfDigits = (cpf: string): string => cpf.replace(/\D/g, "");

/** Why a CPF was refused — codes on the wire, copy in the view. */
export type CpfErrorCode = "invalid_cpf" | "cpf_taken";

export class CpfRejected extends Data.TaggedError("CpfRejected")<{
	readonly code: CpfErrorCode;
}> {}

/**
 * Patient portal port — the *patient* side: read-only on clinical data,
 * and everything is scoped to the signed-in user themself. Fails
 * `Forbidden` without a principal and under delegation (a secretary
 * acting for a doctor has no business in someone's portal).
 */
export class PatientPortal extends Context.Service<
	PatientPortal,
	{
		/** A record the caller holds an active link to; Forbidden otherwise. */
		readonly profile: (patientId: number) => Effect.Effect<PortalProfile, Forbidden>;
		/** The consultations of a record the caller holds an active link
		 * to, newest first — empty without one. */
		readonly consultations: (
			patientId: number,
		) => Effect.Effect<PortalConsultationSummary[], Forbidden>;
		/** One consultation of a record the caller holds an active link
		 * to; Forbidden otherwise, and for one with no saved record. */
		readonly consultation: (id: number) => Effect.Effect<PortalConsultation, Forbidden>;
		/** Whether the caller's account already carries a CPF. */
		readonly hasCpf: () => Effect.Effect<boolean, Forbidden>;
		/** Invites addressed to the caller's email still waiting on email
		 * verification — the count behind the "confirm your email" notice. */
		readonly awaitingInvites: () => Effect.Effect<number, Forbidden>;
		/** Store the caller's CPF — it drives the match against records. */
		readonly setCpf: (cpf: string) => Effect.Effect<void, Forbidden | CpfRejected>;
	}
>()("@ktb/patient-portal/PatientPortal") {}

export const PatientPortalLive = Layer.effect(
	PatientPortal,
	Effect.gen(function* () {
		const db = yield* Db;
		const self = (path: string) =>
			Effect.flatMap(Principal, (principal) =>
				principal === null || principal.actorId !== undefined
					? Effect.fail(new Forbidden({ path }))
					: Effect.succeed(principal.userId),
			);
		return PatientPortal.of({
			profile: Effect.fn("PatientPortal.profile")(function* (patientId: number) {
				const userId = yield* self("portal.read");
				const profile = yield* Effect.promise(() => getPortalProfile(db, userId, patientId));
				if (profile === null) return yield* Effect.fail(new Forbidden({ path: "portal.read" }));
				return profile;
			}),
			consultations: Effect.fn("PatientPortal.consultations")(function* (patientId: number) {
				const userId = yield* self("portal.read");
				return yield* Effect.promise(() => listPortalConsultations(db, userId, patientId));
			}),
			consultation: Effect.fn("PatientPortal.consultation")(function* (id: number) {
				const userId = yield* self("portal.read");
				const consultation = yield* Effect.promise(() => getPortalConsultation(db, userId, id));
				if (consultation === null)
					return yield* Effect.fail(new Forbidden({ path: "portal.read" }));
				return consultation;
			}),
			hasCpf: Effect.fn("PatientPortal.hasCpf")(function* () {
				const userId = yield* self("portal.read");
				const [account] = yield* Effect.promise(() =>
					db.select({ cpf: user.cpf }).from(user).where(eq(user.id, userId)),
				);
				return Boolean(account?.cpf);
			}),
			awaitingInvites: Effect.fn("PatientPortal.awaitingInvites")(function* () {
				const userId = yield* self("portal.read");
				return yield* Effect.promise(() => countAwaitingInvites(db, userId));
			}),
			setCpf: Effect.fn("PatientPortal.setCpf")(function* (raw: string) {
				const userId = yield* self("portal.update");
				if (!isValidCpf(raw)) return yield* Effect.fail(new CpfRejected({ code: "invalid_cpf" }));
				const cpf = cpfDigits(raw);
				const [taken] = yield* Effect.promise(() =>
					db
						.select({ id: user.id })
						.from(user)
						.where(and(eq(user.cpf, cpf), ne(user.id, userId))),
				);
				if (taken !== undefined) return yield* Effect.fail(new CpfRejected({ code: "cpf_taken" }));
				yield* Effect.promise(() => db.update(user).set({ cpf }).where(eq(user.id, userId)));
			}),
		});
	}),
);

export const patientPortalServicesPlugin = definePlugin({
	id: "patient-portal.services",
	services: PatientPortalLive,
});

// Route subtree composed into the host's virtualRouteConfig: the route
// modules live in THIS package (src/routes/**), discovered by a
// physical() directory scan relative to the host's routes directory.
export const patientPortalRoutesPlugin = definePlugin({
	id: "patient-portal.routes",
	routes: [physical("/portal", "../../../../plugins/patient-portal/src/routes")],
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [patientPortalServicesPlugin, patientPortalRoutesPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"patient-portal.services": true;
		"patient-portal.routes": true;
	}
}
