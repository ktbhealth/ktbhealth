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
	readonly searchPlaceholder: string;
	readonly searchLabel: string;
	readonly noMatch: string;
	readonly filteredCount: (shown: number, total: number) => string;
	readonly colActions: string;
	readonly colMember: string;
	readonly colRole: string;
	readonly newGroup: string;
	readonly createTitle: string;
	readonly createSubmit: string;
	readonly cancel: string;
	readonly fieldName: string;
	readonly namePlaceholder: string;
	readonly fieldSlug: string;
	readonly slugPlaceholder: string;
	readonly fieldKind: string;
	readonly kindPlaceholder: string;
	readonly fieldMeta: string;
	readonly metaPlaceholder: string;
	readonly saveError: string;
	readonly membersTitle: string;
	readonly membersLoading: string;
	readonly membersEmpty: string;
	readonly memberKindLabel: string;
	readonly memberIdPlaceholder: string;
	readonly rolePlaceholder: string;
	readonly addMember: string;
	readonly removeMember: string;
	readonly removeMemberTitle: string;
	readonly removeMemberDescription: (memberId: string) => string;
	readonly deleteGroup: string;
	readonly deleteGroupTitle: string;
	readonly deleteGroupDescription: (name: string) => string;
	readonly confirmDelete: string;
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
	searchPlaceholder: "Search by name or slug…",
	searchLabel: "Search groups",
	noMatch: "No groups match the search.",
	filteredCount: (shown, total) => `Showing ${shown} of ${total}`,
	colActions: "Actions",
	colMember: "Member",
	colRole: "Role",
	newGroup: "New group",
	createTitle: "Create group",
	createSubmit: "Create",
	cancel: "Cancel",
	fieldName: "Name",
	namePlaceholder: "Group name",
	fieldSlug: "Slug",
	slugPlaceholder: "group-slug",
	fieldKind: "Kind",
	kindPlaceholder: "clinic, org, cohort…",
	fieldMeta: "Meta",
	metaPlaceholder: "Optional JSON payload",
	saveError: "Save failed",
	membersTitle: "Group members",
	membersLoading: "Loading members…",
	membersEmpty: "No members yet.",
	memberKindLabel: "Member kind",
	memberIdPlaceholder: "Member id",
	rolePlaceholder: "Role (optional)",
	addMember: "Add member",
	removeMember: "Remove",
	removeMemberTitle: "Remove member",
	removeMemberDescription: (memberId) => `Remove ${memberId} from this group?`,
	deleteGroup: "Delete",
	deleteGroupTitle: "Delete group",
	deleteGroupDescription: (name) =>
		`Delete “${name}”? This removes the group and all of its memberships.`,
	confirmDelete: "Delete",
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
	searchPlaceholder: "Buscar por nome ou slug…",
	searchLabel: "Buscar grupos",
	noMatch: "Nenhum grupo corresponde à busca.",
	filteredCount: (shown, total) => `Exibindo ${shown} de ${total}`,
	colActions: "Ações",
	colMember: "Membro",
	colRole: "Função",
	newGroup: "Novo grupo",
	createTitle: "Criar grupo",
	createSubmit: "Criar",
	cancel: "Cancelar",
	fieldName: "Nome",
	namePlaceholder: "Nome do grupo",
	fieldSlug: "Slug",
	slugPlaceholder: "slug-do-grupo",
	fieldKind: "Tipo",
	kindPlaceholder: "clínica, organização, coorte…",
	fieldMeta: "Metadados",
	metaPlaceholder: "JSON opcional",
	saveError: "Falha ao salvar",
	membersTitle: "Membros do grupo",
	membersLoading: "Carregando membros…",
	membersEmpty: "Nenhum membro ainda.",
	memberKindLabel: "Tipo de membro",
	memberIdPlaceholder: "Id do membro",
	rolePlaceholder: "Função (opcional)",
	addMember: "Adicionar membro",
	removeMember: "Remover",
	removeMemberTitle: "Remover membro",
	removeMemberDescription: (memberId) => `Remover ${memberId} deste grupo?`,
	deleteGroup: "Excluir",
	deleteGroupTitle: "Excluir grupo",
	deleteGroupDescription: (name) =>
		`Excluir “${name}”? Isso remove o grupo e todas as suas associações.`,
	confirmDelete: "Excluir",
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
	searchPlaceholder: "Buscar por nombre o slug…",
	searchLabel: "Buscar grupos",
	noMatch: "Ningún grupo coincide con la búsqueda.",
	filteredCount: (shown, total) => `Mostrando ${shown} de ${total}`,
	colActions: "Acciones",
	colMember: "Miembro",
	colRole: "Rol",
	newGroup: "Nuevo grupo",
	createTitle: "Crear grupo",
	createSubmit: "Crear",
	cancel: "Cancelar",
	fieldName: "Nombre",
	namePlaceholder: "Nombre del grupo",
	fieldSlug: "Slug",
	slugPlaceholder: "slug-del-grupo",
	fieldKind: "Tipo",
	kindPlaceholder: "clínica, organización, cohorte…",
	fieldMeta: "Metadatos",
	metaPlaceholder: "JSON opcional",
	saveError: "Error al guardar",
	membersTitle: "Miembros del grupo",
	membersLoading: "Cargando miembros…",
	membersEmpty: "Aún no hay miembros.",
	memberKindLabel: "Tipo de miembro",
	memberIdPlaceholder: "Id del miembro",
	rolePlaceholder: "Rol (opcional)",
	addMember: "Añadir miembro",
	removeMember: "Eliminar",
	removeMemberTitle: "Eliminar miembro",
	removeMemberDescription: (memberId) => `¿Eliminar ${memberId} de este grupo?`,
	deleteGroup: "Eliminar",
	deleteGroupTitle: "Eliminar grupo",
	deleteGroupDescription: (name) =>
		`¿Eliminar “${name}”? Esto elimina el grupo y todas sus membresías.`,
	confirmDelete: "Eliminar",
};

const CATALOGS: Record<GroupLocale, GroupMessages> = { en, "pt-BR": ptBR, es };

export const isGroupLocale = (locale: string): locale is GroupLocale =>
	(GROUP_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const groupMessages = (locale: string): GroupMessages =>
	CATALOGS[isGroupLocale(locale) ? locale : BASE_LOCALE];
