/**
 * Tenants plugin copy, one typed catalog per locale. Plugins cannot
 * import the host's Paraglide output (arch lint); the host injects the
 * active locale through the panel page ctx and the view resolves its
 * strings here. A locale catalog must implement `TenantMessages` in
 * full — a missing key is a type error, not an English fallback.
 */

export const TENANT_LOCALES = ["en", "pt-BR", "es"] as const;
export type TenantLocale = (typeof TENANT_LOCALES)[number];
export const BASE_LOCALE: TenantLocale = "en";

export interface TenantMessages {
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
	readonly searchPlaceholder: string;
	readonly searchLabel: string;
	readonly noMatch: string;
	readonly filteredCount: (shown: number, total: number) => string;
	readonly colActions: string;
	readonly colMember: string;
	readonly colRole: string;
	readonly membersTitle: string;
	readonly membersLoading: string;
	readonly membersEmpty: string;
	readonly memberIdPlaceholder: string;
	readonly addMember: string;
	readonly removeMember: string;
	readonly removeMemberTitle: string;
	readonly removeMemberDescription: (memberId: string) => string;
	readonly roleOwner: string;
	readonly roleAdmin: string;
	readonly roleMember: string;
	readonly saveError: string;
	readonly cancel: string;
}

const en: TenantMessages = {
	title: "Tenants",
	none: "No tenants registered.",
	count: (n) => `${n} tenant${n === 1 ? "" : "s"} across the platform.`,
	emptyTitle: "No tenants",
	emptyDescription: "Tenants appear here once a group is flagged as one.",
	colId: "Id",
	colName: "Name",
	colSlug: "Slug",
	colKind: "Kind",
	colMembers: "Members",
	colCreated: "Created",
	searchPlaceholder: "Search by name or slug…",
	searchLabel: "Search tenants",
	noMatch: "No tenants match the search.",
	filteredCount: (shown, total) => `Showing ${shown} of ${total}`,
	colActions: "Actions",
	colMember: "Member",
	colRole: "Role",
	membersTitle: "Tenant members",
	membersLoading: "Loading members…",
	membersEmpty: "No members yet.",
	memberIdPlaceholder: "User id",
	addMember: "Add member",
	removeMember: "Remove",
	removeMemberTitle: "Remove member",
	removeMemberDescription: (memberId) => `Remove ${memberId} from this tenant?`,
	roleOwner: "owner",
	roleAdmin: "admin",
	roleMember: "member",
	saveError: "Save failed",
	cancel: "Cancel",
};

const ptBR: TenantMessages = {
	title: "Tenants",
	none: "Nenhum tenant cadastrado.",
	count: (n) => `${n} tenant${n === 1 ? "" : "s"} em toda a plataforma.`,
	emptyTitle: "Nenhum tenant",
	emptyDescription: "Os tenants aparecem aqui quando um grupo é marcado como tal.",
	colId: "Id",
	colName: "Nome",
	colSlug: "Slug",
	colKind: "Tipo",
	colMembers: "Membros",
	colCreated: "Criado em",
	searchPlaceholder: "Buscar por nome ou slug…",
	searchLabel: "Buscar tenants",
	noMatch: "Nenhum tenant corresponde à busca.",
	filteredCount: (shown, total) => `Exibindo ${shown} de ${total}`,
	colActions: "Ações",
	colMember: "Membro",
	colRole: "Função",
	membersTitle: "Membros do tenant",
	membersLoading: "Carregando membros…",
	membersEmpty: "Nenhum membro ainda.",
	memberIdPlaceholder: "Id do usuário",
	addMember: "Adicionar membro",
	removeMember: "Remover",
	removeMemberTitle: "Remover membro",
	removeMemberDescription: (memberId) => `Remover ${memberId} deste tenant?`,
	roleOwner: "owner",
	roleAdmin: "admin",
	roleMember: "member",
	saveError: "Falha ao salvar",
	cancel: "Cancelar",
};

const es: TenantMessages = {
	title: "Tenants",
	none: "Ningún tenant registrado.",
	count: (n) => `${n} tenant${n === 1 ? "" : "s"} en toda la plataforma.`,
	emptyTitle: "Ningún tenant",
	emptyDescription: "Los tenants aparecen aquí cuando un grupo se marca como tal.",
	colId: "Id",
	colName: "Nombre",
	colSlug: "Slug",
	colKind: "Tipo",
	colMembers: "Miembros",
	colCreated: "Creado",
	searchPlaceholder: "Buscar por nombre o slug…",
	searchLabel: "Buscar tenants",
	noMatch: "Ningún tenant coincide con la búsqueda.",
	filteredCount: (shown, total) => `Mostrando ${shown} de ${total}`,
	colActions: "Acciones",
	colMember: "Miembro",
	colRole: "Rol",
	membersTitle: "Miembros del tenant",
	membersLoading: "Cargando miembros…",
	membersEmpty: "Aún no hay miembros.",
	memberIdPlaceholder: "Id de usuario",
	addMember: "Añadir miembro",
	removeMember: "Eliminar",
	removeMemberTitle: "Eliminar miembro",
	removeMemberDescription: (memberId) => `¿Eliminar ${memberId} de este tenant?`,
	roleOwner: "owner",
	roleAdmin: "admin",
	roleMember: "member",
	saveError: "Error al guardar",
	cancel: "Cancelar",
};

const CATALOGS: Record<TenantLocale, TenantMessages> = { en, "pt-BR": ptBR, es };

export const isTenantLocale = (locale: string): locale is TenantLocale =>
	(TENANT_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const tenantMessages = (locale: string): TenantMessages =>
	CATALOGS[isTenantLocale(locale) ? locale : BASE_LOCALE];
