/**
 * Users plugin copy, one typed catalog per locale. Plugins cannot
 * import the host's Paraglide output (arch lint); the host injects the
 * active locale through the panel page ctx and the view resolves its
 * strings here. A locale catalog must implement `UserMessages` in
 * full — a missing key is a type error, not an English fallback.
 */

export const USER_LOCALES = ["en", "pt-BR"] as const;
export type UserLocale = (typeof USER_LOCALES)[number];
export const BASE_LOCALE: UserLocale = "en";

export interface UserMessages {
	readonly title: string;
	readonly none: string;
	readonly count: (n: number) => string;
	readonly emptyTitle: string;
	readonly emptyDescription: string;
	readonly colId: string;
	readonly colName: string;
	readonly colEmail: string;
	readonly colVerified: string;
	readonly colPatients: string;
	readonly colConsultations: string;
	readonly colRole: string;
	readonly colCreated: string;
	readonly yes: string;
	readonly no: string;
	readonly roleAdmin: string;
	readonly roleUser: string;
}

const en: UserMessages = {
	title: "Users",
	none: "No users registered.",
	count: (n) => `${n} user${n === 1 ? "" : "s"} across the platform.`,
	emptyTitle: "No users",
	emptyDescription: "Users appear here once they sign up.",
	colId: "Id",
	colName: "Name",
	colEmail: "Email",
	colVerified: "Verified",
	colPatients: "Patients",
	colConsultations: "Consultations",
	colRole: "Role",
	colCreated: "Created",
	yes: "yes",
	no: "no",
	roleAdmin: "admin",
	roleUser: "user",
};

const ptBR: UserMessages = {
	title: "Usuários",
	none: "Nenhum usuário cadastrado.",
	count: (n) => `${n} usuário${n === 1 ? "" : "s"} em toda a plataforma.`,
	emptyTitle: "Nenhum usuário",
	emptyDescription: "Os usuários aparecem aqui após se cadastrarem.",
	colId: "Id",
	colName: "Nome",
	colEmail: "E-mail",
	colVerified: "Verificado",
	colPatients: "Pacientes",
	colConsultations: "Consultas",
	colRole: "Papel",
	colCreated: "Criado em",
	yes: "sim",
	no: "não",
	roleAdmin: "admin",
	roleUser: "usuário",
};

const CATALOGS: Record<UserLocale, UserMessages> = { en, "pt-BR": ptBR };

export const isUserLocale = (locale: string): locale is UserLocale =>
	(USER_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const userMessages = (locale: string): UserMessages =>
	CATALOGS[isUserLocale(locale) ? locale : BASE_LOCALE];
