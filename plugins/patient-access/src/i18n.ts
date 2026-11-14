/**
 * Patient-access plugin copy, one typed catalog per locale. Plugins
 * cannot import the host's Paraglide output (arch lint), so the host
 * passes the active locale in and every view resolves its strings here.
 * A locale catalog must implement `PatientAccessMessages` in full — a
 * missing key is a type error, not an English fallback at runtime.
 */
import type { PatientInviteErrorCode } from "./index.ts";
import type { PatientAccessRelation, PatientAccessStatus } from "./schema.ts";

/** Locales with a catalog; the host asserts it covers every app locale. */
export const PATIENT_ACCESS_LOCALES = ["en", "pt-BR", "es"] as const;
export type PatientAccessLocale = (typeof PATIENT_ACCESS_LOCALES)[number];
export const BASE_LOCALE: PatientAccessLocale = "en";

export interface PatientAccessMessages {
	/** Page heading — `patient` is the patient's name. */
	readonly title: (patient: string) => string;
	readonly description: string;
	readonly back: string;
	readonly emailLabel: string;
	readonly relationLabel: string;
	readonly invite: string;
	readonly pending: string;
	readonly approve: string;
	readonly revoke: string;
	readonly emptyTitle: string;
	readonly emptyDescription: string;
	/** Shown next to links that came from a CPF match. */
	readonly cpfMatch: string;
	readonly relation: Record<PatientAccessRelation, string>;
	readonly status: Record<Exclude<PatientAccessStatus, "revoked">, string>;
	readonly errors: Record<PatientInviteErrorCode | "failed", string>;
	/** Invite email — `doctor` is the doctor's display name. */
	readonly inviteEmail: {
		readonly subject: (doctor: string) => string;
		readonly body: (doctor: string, patient: string, url: string) => string;
	};
}

const en: PatientAccessMessages = {
	title: (patient) => `Portal access — ${patient}`,
	description:
		"Who can open this record in the patient portal: the patient, or someone responsible for them.",
	back: "Back to the patient",
	emailLabel: "Email",
	relationLabel: "Relation",
	invite: "Invite",
	pending: "Please wait…",
	approve: "Approve",
	revoke: "Remove access",
	emptyTitle: "Nobody has portal access yet",
	emptyDescription: "Invite the patient, or a guardian, by email.",
	cpfMatch: "CPF match",
	relation: { self: "Patient", guardian: "Guardian" },
	status: { invited: "Invited", pending: "Awaiting approval", active: "Active" },
	errors: {
		invalid_email: "Enter a valid email address.",
		invalid_relation: "Choose who this person is to the patient.",
		failed: "Something went wrong. Please try again.",
	},
	inviteEmail: {
		subject: (doctor) => `${doctor} gave you access to the KTB Health patient portal`,
		body: (doctor, patient, url) =>
			[
				"Hello.",
				"",
				`${doctor} gave you access to ${patient}'s consultations in the KTB Health patient portal.`,
				"Sign in — or create an account — with this email address to see them:",
				url,
				"",
				"If you were not expecting this message, you can ignore it.",
			].join("\n"),
	},
};

const ptBR: PatientAccessMessages = {
	title: (patient) => `Acesso ao portal — ${patient}`,
	description:
		"Quem pode abrir esta ficha no portal do paciente: o próprio paciente ou um responsável por ele.",
	back: "Voltar ao paciente",
	emailLabel: "E-mail",
	relationLabel: "Relação",
	invite: "Convidar",
	pending: "Aguarde…",
	approve: "Aprovar",
	revoke: "Remover acesso",
	emptyTitle: "Ninguém tem acesso ao portal ainda",
	emptyDescription: "Convide o paciente, ou um responsável, por e-mail.",
	cpfMatch: "Match por CPF",
	relation: { self: "Paciente", guardian: "Responsável" },
	status: { invited: "Convidado", pending: "Aguardando aprovação", active: "Ativo" },
	errors: {
		invalid_email: "Informe um e-mail válido.",
		invalid_relation: "Escolha quem esta pessoa é para o paciente.",
		failed: "Algo deu errado. Tente novamente.",
	},
	inviteEmail: {
		subject: (doctor) => `${doctor} liberou seu acesso ao portal do paciente KTB Health`,
		body: (doctor, patient, url) =>
			[
				"Olá.",
				"",
				`${doctor} liberou seu acesso às consultas de ${patient} no portal do paciente KTB Health.`,
				"Entre — ou crie uma conta — com este endereço de e-mail para vê-las:",
				url,
				"",
				"Se você não esperava esta mensagem, pode ignorá-la.",
			].join("\n"),
	},
};

const es: PatientAccessMessages = {
	title: (patient) => `Acceso al portal — ${patient}`,
	description:
		"Quién puede abrir esta ficha en el portal del paciente: el propio paciente o un responsable.",
	back: "Volver al paciente",
	emailLabel: "Correo",
	relationLabel: "Relación",
	invite: "Invitar",
	pending: "Espera…",
	approve: "Aprobar",
	revoke: "Quitar acceso",
	emptyTitle: "Nadie tiene acceso al portal todavía",
	emptyDescription: "Invita al paciente, o a un responsable, por correo.",
	cpfMatch: "Coincidencia por CPF",
	relation: { self: "Paciente", guardian: "Responsable" },
	status: { invited: "Invitado", pending: "Esperando aprobación", active: "Activo" },
	errors: {
		invalid_email: "Ingresa un correo válido.",
		invalid_relation: "Elige quién es esta persona para el paciente.",
		failed: "Algo salió mal. Inténtalo de nuevo.",
	},
	inviteEmail: {
		subject: (doctor) => `${doctor} te dio acceso al portal del paciente de KTB Health`,
		body: (doctor, patient, url) =>
			[
				"Hola.",
				"",
				`${doctor} te dio acceso a las consultas de ${patient} en el portal del paciente de KTB Health.`,
				"Inicia sesión — o crea una cuenta — con esta dirección de correo para verlas:",
				url,
				"",
				"Si no esperabas este mensaje, puedes ignorarlo.",
			].join("\n"),
	},
};

const CATALOGS: Record<PatientAccessLocale, PatientAccessMessages> = { en, "pt-BR": ptBR, es };

export const isPatientAccessLocale = (locale: string): locale is PatientAccessLocale =>
	(PATIENT_ACCESS_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const patientAccessMessages = (locale: string): PatientAccessMessages =>
	CATALOGS[isPatientAccessLocale(locale) ? locale : BASE_LOCALE];
