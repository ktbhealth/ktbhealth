/**
 * Secretaries plugin copy, one typed catalog per locale. Plugins cannot
 * import the host's Paraglide output (arch lint), so the host passes the
 * active locale in and every view resolves its strings here. A locale
 * catalog must implement `SecretaryMessages` in full — a missing key is
 * a type error, not an English fallback at runtime.
 */
import type { InviteErrorCode } from "./index.ts";
import type { DoctorAccessStatus } from "./schema.ts";

/** Locales with a catalog; the host asserts it covers every app locale. */
export const SECRETARY_LOCALES = ["en", "pt-BR", "es"] as const;
export type SecretaryLocale = (typeof SECRETARY_LOCALES)[number];
export const BASE_LOCALE: SecretaryLocale = "en";

export interface SecretaryMessages {
	readonly title: string;
	readonly description: string;
	readonly emailLabel: string;
	readonly invite: string;
	readonly pending: string;
	readonly revoke: string;
	readonly emptyTitle: string;
	readonly emptyDescription: string;
	readonly status: Record<Exclude<DoctorAccessStatus, "revoked">, string>;
	readonly errors: Record<InviteErrorCode | "failed", string>;
	/** Invite email — `doctor` is the inviting doctor's display name. */
	readonly inviteEmail: {
		readonly subject: (doctor: string) => string;
		readonly body: (doctor: string, url: string) => string;
	};
}

const en: SecretaryMessages = {
	title: "Secretaries",
	description:
		"People who can work on your behalf. A secretary has full access to your patients and consultations.",
	emailLabel: "Email",
	invite: "Invite",
	pending: "Please wait…",
	revoke: "Remove access",
	emptyTitle: "No secretaries yet",
	emptyDescription: "Invite someone by email to let them act on your behalf.",
	status: { invited: "Invited", active: "Active" },
	errors: {
		invalid_email: "Enter a valid email address.",
		self: "You cannot invite your own email.",
		failed: "Something went wrong. Please try again.",
	},
	inviteEmail: {
		subject: (doctor) => `${doctor} invited you to KTB Health`,
		body: (doctor, url) =>
			[
				"Hello.",
				"",
				`${doctor} invited you to work on their behalf at KTB Health, as their secretary.`,
				"Sign in — or create an account — with this email address to get access:",
				url,
				"",
				"If you were not expecting this invitation, you can ignore this message.",
			].join("\n"),
	},
};

const ptBR: SecretaryMessages = {
	title: "Secretárias",
	description:
		"Pessoas que podem trabalhar em seu nome. Uma secretária tem acesso total aos seus pacientes e consultas.",
	emailLabel: "E-mail",
	invite: "Convidar",
	pending: "Aguarde…",
	revoke: "Remover acesso",
	emptyTitle: "Nenhuma secretária ainda",
	emptyDescription: "Convide alguém por e-mail para atuar em seu nome.",
	status: { invited: "Convidada", active: "Ativa" },
	errors: {
		invalid_email: "Informe um e-mail válido.",
		self: "Você não pode convidar o seu próprio e-mail.",
		failed: "Algo deu errado. Tente novamente.",
	},
	inviteEmail: {
		subject: (doctor) => `${doctor} convidou você para o KTB Health`,
		body: (doctor, url) =>
			[
				"Olá.",
				"",
				`${doctor} convidou você para trabalhar em nome dele(a) no KTB Health, como secretária.`,
				"Entre — ou crie uma conta — com este endereço de e-mail para ter acesso:",
				url,
				"",
				"Se você não esperava este convite, pode ignorar esta mensagem.",
			].join("\n"),
	},
};

const es: SecretaryMessages = {
	title: "Secretarias",
	description:
		"Personas que pueden trabajar en tu nombre. Una secretaria tiene acceso total a tus pacientes y consultas.",
	emailLabel: "Correo",
	invite: "Invitar",
	pending: "Espera…",
	revoke: "Quitar acceso",
	emptyTitle: "Aún no hay secretarias",
	emptyDescription: "Invita a alguien por correo para que actúe en tu nombre.",
	status: { invited: "Invitada", active: "Activa" },
	errors: {
		invalid_email: "Ingresa un correo válido.",
		self: "No puedes invitar tu propio correo.",
		failed: "Algo salió mal. Inténtalo de nuevo.",
	},
	inviteEmail: {
		subject: (doctor) => `${doctor} te invitó a KTB Health`,
		body: (doctor, url) =>
			[
				"Hola.",
				"",
				`${doctor} te invitó a trabajar en su nombre en KTB Health, como secretaria.`,
				"Inicia sesión — o crea una cuenta — con esta dirección de correo para obtener acceso:",
				url,
				"",
				"Si no esperabas esta invitación, puedes ignorar este mensaje.",
			].join("\n"),
	},
};

const CATALOGS: Record<SecretaryLocale, SecretaryMessages> = { en, "pt-BR": ptBR, es };

export const isSecretaryLocale = (locale: string): locale is SecretaryLocale =>
	(SECRETARY_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const secretaryMessages = (locale: string): SecretaryMessages =>
	CATALOGS[isSecretaryLocale(locale) ? locale : BASE_LOCALE];
