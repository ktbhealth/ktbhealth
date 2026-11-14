/**
 * Doctors plugin copy, one typed catalog per locale. Plugins cannot
 * import the host's Paraglide output (arch lint), so the host passes the
 * active locale in and every view resolves its strings here. A locale
 * catalog must implement `DoctorMessages` in full — a missing key is a
 * type error, not an English fallback at runtime.
 */

/** Locales with a catalog; the host asserts it covers every app locale. */
export const DOCTOR_LOCALES = ["en", "pt-BR", "es"] as const;
export type DoctorLocale = (typeof DOCTOR_LOCALES)[number];
export const BASE_LOCALE: DoctorLocale = "en";

export interface DoctorMessages {
	readonly selectTitle: string;
	readonly selectDescription: string;
	readonly roleOwner: string;
	readonly roleSecretary: string;
	readonly current: string;
	readonly choose: string;
	readonly error: string;
}

const en: DoctorMessages = {
	selectTitle: "Choose a doctor profile",
	selectDescription: "Pick whose patients and consultations you want to work with.",
	roleOwner: "My profile",
	roleSecretary: "Secretary",
	current: "Current",
	choose: "Use this profile",
	error: "Something went wrong. Please try again.",
};

const ptBR: DoctorMessages = {
	selectTitle: "Escolha um perfil de médico",
	selectDescription: "Selecione com quais pacientes e consultas você quer trabalhar.",
	roleOwner: "Meu perfil",
	roleSecretary: "Secretária",
	current: "Atual",
	choose: "Usar este perfil",
	error: "Algo deu errado. Tente novamente.",
};

const es: DoctorMessages = {
	selectTitle: "Elige un perfil de médico",
	selectDescription: "Selecciona con qué pacientes y consultas quieres trabajar.",
	roleOwner: "Mi perfil",
	roleSecretary: "Secretaria",
	current: "Actual",
	choose: "Usar este perfil",
	error: "Algo salió mal. Inténtalo de nuevo.",
};

const CATALOGS: Record<DoctorLocale, DoctorMessages> = { en, "pt-BR": ptBR, es };

export const isDoctorLocale = (locale: string): locale is DoctorLocale =>
	(DOCTOR_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const doctorMessages = (locale: string): DoctorMessages =>
	CATALOGS[isDoctorLocale(locale) ? locale : BASE_LOCALE];
