/**
 * Auth plugin copy, one typed catalog per locale. Plugins cannot
 * import the host's Paraglide output (arch lint), so the login route
 * loader attaches the active locale (localeFn → getLocale) and the
 * view resolves its strings here. A locale catalog must implement
 * `AuthMessages` in full — a missing key is a type error, not an
 * English fallback at runtime.
 */

export const AUTH_LOCALES = ["en", "pt-BR", "es"] as const;
export type AuthLocale = (typeof AUTH_LOCALES)[number];
export const BASE_LOCALE: AuthLocale = "en";

export interface AuthMessages {
	readonly metaTitle: string;
	readonly headingIn: string;
	readonly headingUp: string;
	readonly descIn: string;
	readonly descUp: string;
	readonly tabIn: string;
	readonly tabUp: string;
	readonly email: string;
	readonly password: string;
	readonly confirmPassword: string;
	readonly submitIn: string;
	readonly submitUp: string;
	readonly pending: string;
	readonly errorFallback: string;
	readonly errorPasswordMismatch: string;
	readonly verifyLink: string;
	readonly secretaryLink: string;
}

const en: AuthMessages = {
	metaTitle: "Sign in | KTB Health",
	headingIn: "Sign in",
	headingUp: "Create account",
	descIn: "Sign in to your account to continue.",
	descUp: "Create an account to get started.",
	tabIn: "Sign in",
	tabUp: "Create account",
	email: "Email",
	password: "Password",
	confirmPassword: "Confirm password",
	submitIn: "Sign in",
	submitUp: "Create account",
	pending: "Please wait…",
	errorFallback: "Could not sign in. Please try again.",
	errorPasswordMismatch: "Passwords do not match.",
	verifyLink: "Didn't get the verification email?",
	secretaryLink: "I am a secretary",
};

const ptBR: AuthMessages = {
	metaTitle: "Entrar | KTB Health",
	headingIn: "Entrar",
	headingUp: "Criar conta",
	descIn: "Entre na sua conta para continuar.",
	descUp: "Crie uma conta para começar.",
	tabIn: "Entrar",
	tabUp: "Criar conta",
	email: "E-mail",
	password: "Senha",
	confirmPassword: "Confirmar senha",
	submitIn: "Entrar",
	submitUp: "Criar conta",
	pending: "Aguarde…",
	errorFallback: "Não foi possível entrar. Tente novamente.",
	errorPasswordMismatch: "As senhas não coincidem.",
	verifyLink: "Não recebeu o e-mail de verificação?",
	secretaryLink: "Sou secretária",
};

const es: AuthMessages = {
	metaTitle: "Iniciar sesión | KTB Health",
	headingIn: "Iniciar sesión",
	headingUp: "Crear cuenta",
	descIn: "Inicie sesión en su cuenta para continuar.",
	descUp: "Cree una cuenta para comenzar.",
	tabIn: "Iniciar sesión",
	tabUp: "Crear cuenta",
	email: "Correo electrónico",
	password: "Contraseña",
	confirmPassword: "Confirmar contraseña",
	submitIn: "Iniciar sesión",
	submitUp: "Crear cuenta",
	pending: "Espere…",
	errorFallback: "No se pudo iniciar sesión. Inténtelo de nuevo.",
	errorPasswordMismatch: "Las contraseñas no coinciden.",
	verifyLink: "¿No recibiste el correo de verificación?",
	secretaryLink: "Soy secretaria",
};

const CATALOGS: Record<AuthLocale, AuthMessages> = { en, "pt-BR": ptBR, es };

export const isAuthLocale = (locale: string): locale is AuthLocale =>
	(AUTH_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const authMessages = (locale: string): AuthMessages =>
	CATALOGS[isAuthLocale(locale) ? locale : BASE_LOCALE];
