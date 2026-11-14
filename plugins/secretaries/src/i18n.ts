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
	/** /secretaries/login — the staff sign-in screen. Unlike the doctor
	 * screen, sign-up here never creates a doctor profile. */
	readonly login: {
		readonly metaTitle: string;
		readonly headingIn: string;
		readonly headingUp: string;
		readonly descIn: string;
		readonly descUp: string;
		readonly tabIn: string;
		readonly tabUp: string;
		readonly email: string;
		readonly name: string;
		readonly password: string;
		readonly confirmPassword: string;
		readonly submitIn: string;
		readonly submitUp: string;
		readonly pending: string;
		readonly errorFallback: string;
		readonly errorPasswordMismatch: string;
		readonly verifyLink: string;
		readonly doctorLink: string;
		/** Shown after sign-in when the account holds no delegation —
		 * the invite is still pending or was sent to another email. */
		readonly noDelegation: string;
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
	login: {
		metaTitle: "Secretary sign-in | KTB Health",
		headingIn: "Secretary sign-in",
		headingUp: "Create secretary account",
		descIn: "Sign in with the email the doctor invited.",
		descUp: "Create an account with the email the doctor invited.",
		tabIn: "Sign in",
		tabUp: "Create account",
		email: "Email",
		name: "Name",
		password: "Password",
		confirmPassword: "Confirm password",
		submitIn: "Sign in",
		submitUp: "Create account",
		pending: "Please wait…",
		errorFallback: "Could not sign in. Please try again.",
		errorPasswordMismatch: "Passwords do not match.",
		verifyLink: "Didn't get the verification email?",
		doctorLink: "I am a doctor",
		noDelegation:
			"No delegation found for this account — ask the doctor to invite this email address.",
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
	login: {
		metaTitle: "Secretária | KTB Health",
		headingIn: "Entrar — secretária",
		headingUp: "Criar conta de secretária",
		descIn: "Entre com o e-mail que o médico convidou.",
		descUp: "Crie uma conta com o e-mail que o médico convidou.",
		tabIn: "Entrar",
		tabUp: "Criar conta",
		email: "E-mail",
		name: "Nome",
		password: "Senha",
		confirmPassword: "Confirmar senha",
		submitIn: "Entrar",
		submitUp: "Criar conta",
		pending: "Aguarde…",
		errorFallback: "Não foi possível entrar. Tente novamente.",
		errorPasswordMismatch: "As senhas não coincidem.",
		verifyLink: "Não recebeu o e-mail de verificação?",
		doctorLink: "Sou médico",
		noDelegation:
			"Nenhuma delegação encontrada para esta conta — peça ao médico para convidar este e-mail.",
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
	login: {
		metaTitle: "Secretaria | KTB Health",
		headingIn: "Iniciar sesión — secretaria",
		headingUp: "Crear cuenta de secretaria",
		descIn: "Inicia sesión con el correo que el médico invitó.",
		descUp: "Crea una cuenta con el correo que el médico invitó.",
		tabIn: "Iniciar sesión",
		tabUp: "Crear cuenta",
		email: "Correo electrónico",
		name: "Nombre",
		password: "Contraseña",
		confirmPassword: "Confirmar contraseña",
		submitIn: "Iniciar sesión",
		submitUp: "Crear cuenta",
		pending: "Espere…",
		errorFallback: "No se pudo iniciar sesión. Inténtelo de nuevo.",
		errorPasswordMismatch: "Las contraseñas no coinciden.",
		verifyLink: "¿No recibiste el correo de verificación?",
		doctorLink: "Soy médico",
		noDelegation:
			"No se encontró ninguna delegación para esta cuenta — pide al médico que invite este correo.",
	},
};

const CATALOGS: Record<SecretaryLocale, SecretaryMessages> = { en, "pt-BR": ptBR, es };

export const isSecretaryLocale = (locale: string): locale is SecretaryLocale =>
	(SECRETARY_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const secretaryMessages = (locale: string): SecretaryMessages =>
	CATALOGS[isSecretaryLocale(locale) ? locale : BASE_LOCALE];
