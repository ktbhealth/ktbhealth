/**
 * Groups plugin copy, one typed catalog per locale. Plugins cannot
 * import the host's Paraglide output (arch lint); the host injects the
 * active locale through the panel page ctx and the view resolves its
 * strings here. A locale catalog must implement `GroupMessages` in
 * full — a missing key is a type error, not an English fallback.
 */

export const GROUP_LOCALES = ["en", "pt-BR", "es"] as const;
export type GroupLocale = (typeof GROUP_LOCALES)[number];
export const BASE_LOCALE: GroupLocale = "en";

export interface GroupMessages {
	readonly title: string;
	readonly none: string;
	readonly count: (n: number) => string;
	readonly emptyTitle: string;
	readonly emptyDescription: string;
	readonly colId: string;
	readonly colName: string;
	readonly colSlug: string;
	readonly colKind: string;
	readonly colMembers: string;
	readonly colCreated: string;
}

const en: GroupMessages = {
	title: "Groups",
	none: "No groups registered.",
	count: (n) => `${n} group${n === 1 ? "" : "s"} across the platform.`,
	emptyTitle: "No groups",
	emptyDescription: "Groups appear here once they are created.",
	colId: "Id",
	colName: "Name",
	colSlug: "Slug",
	colKind: "Kind",
	colMembers: "Members",
	colCreated: "Created",
};

const ptBR: GroupMessages = {
	title: "Grupos",
	none: "Nenhum grupo cadastrado.",
	count: (n) => `${n} grupo${n === 1 ? "" : "s"} em toda a plataforma.`,
	emptyTitle: "Nenhum grupo",
	emptyDescription: "Os grupos aparecem aqui após serem criados.",
	colId: "Id",
	colName: "Nome",
	colSlug: "Slug",
	colKind: "Tipo",
	colMembers: "Membros",
	colCreated: "Criado em",
};

const es: GroupMessages = {
	title: "Grupos",
	none: "Ningún grupo registrado.",
	count: (n) => `${n} grupo${n === 1 ? "" : "s"} en toda la plataforma.`,
	emptyTitle: "Ningún grupo",
	emptyDescription: "Los grupos aparecen aquí una vez que se crean.",
	colId: "Id",
	colName: "Nombre",
	colSlug: "Slug",
	colKind: "Tipo",
	colMembers: "Miembros",
	colCreated: "Creado",
};

const CATALOGS: Record<GroupLocale, GroupMessages> = { en, "pt-BR": ptBR, es };

export const isGroupLocale = (locale: string): locale is GroupLocale =>
	(GROUP_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const groupMessages = (locale: string): GroupMessages =>
	CATALOGS[isGroupLocale(locale) ? locale : BASE_LOCALE];
