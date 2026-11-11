/**
 * RBAC admin console copy, one typed catalog per locale. Plugins cannot
 * import the host's Paraglide output (arch lint); the host injects the
 * active locale through the panel page ctx and the view resolves its
 * strings here. A locale catalog must implement `RbacMessages` in
 * full — a missing key is a type error, not an English fallback.
 */

export const RBAC_LOCALES = ["en", "pt-BR", "es"] as const;
export type RbacLocale = (typeof RBAC_LOCALES)[number];
export const BASE_LOCALE: RbacLocale = "en";

export interface RbacMessages {
	readonly title: string;
	readonly subtitle: string;
	readonly rolesTitle: string;
	readonly rolesEmpty: string;
	readonly newRole: string;
	readonly roleName: string;
	readonly roleDescription: string;
	readonly createRole: string;
	readonly deleteRole: string;
	readonly permissionsTitle: string;
	readonly matrixEmpty: string;
	readonly colPermission: string;
	readonly colEffect: string;
	readonly effectNone: string;
	readonly effectAllow: string;
	readonly effectDeny: string;
	readonly assignmentsTitle: string;
	readonly assignmentsEmpty: string;
	readonly colSubject: string;
	readonly colSubjectId: string;
	readonly colRole: string;
	readonly colTenant: string;
	readonly colExpires: string;
	readonly colGrantedBy: string;
	readonly globalTenant: string;
	readonly neverExpires: string;
	readonly assignSubject: string;
	readonly subjectKind: string;
	readonly subjectId: string;
	readonly tenantId: string;
	readonly expiresAt: string;
	readonly unassign: string;
	readonly saveError: string;
	readonly selectRole: string;
}

const en: RbacMessages = {
	title: "Roles & permissions",
	subtitle: "Dynamic roles assignable to users and groups.",
	rolesTitle: "Roles",
	rolesEmpty: "No roles yet.",
	newRole: "New role",
	roleName: "Name",
	roleDescription: "Description",
	createRole: "Create",
	deleteRole: "Delete",
	permissionsTitle: "Permission matrix",
	matrixEmpty: "Select a role to edit its grants.",
	colPermission: "Permission",
	colEffect: "Effect",
	effectNone: "—",
	effectAllow: "allow",
	effectDeny: "deny",
	assignmentsTitle: "Assignments",
	assignmentsEmpty: "No subjects assigned.",
	colSubject: "Kind",
	colSubjectId: "Subject",
	colRole: "Role",
	colTenant: "Tenant",
	colExpires: "Expires",
	colGrantedBy: "Granted by",
	globalTenant: "global",
	neverExpires: "never",
	assignSubject: "Assign",
	subjectKind: "Kind",
	subjectId: "Subject id",
	tenantId: "Tenant id (optional)",
	expiresAt: "Expires at (optional)",
	unassign: "Remove",
	saveError: "Save failed",
	selectRole: "Select a role…",
};

const ptBR: RbacMessages = {
	title: "Funções e permissões",
	subtitle: "Funções dinâmicas atribuíveis a usuários e grupos.",
	rolesTitle: "Funções",
	rolesEmpty: "Nenhuma função ainda.",
	newRole: "Nova função",
	roleName: "Nome",
	roleDescription: "Descrição",
	createRole: "Criar",
	deleteRole: "Excluir",
	permissionsTitle: "Matriz de permissões",
	matrixEmpty: "Selecione uma função para editar suas concessões.",
	colPermission: "Permissão",
	colEffect: "Efeito",
	effectNone: "—",
	effectAllow: "permitir",
	effectDeny: "negar",
	assignmentsTitle: "Atribuições",
	assignmentsEmpty: "Nenhum sujeito atribuído.",
	colSubject: "Tipo",
	colSubjectId: "Sujeito",
	colRole: "Função",
	colTenant: "Tenant",
	colExpires: "Expira",
	colGrantedBy: "Concedido por",
	globalTenant: "global",
	neverExpires: "nunca",
	assignSubject: "Atribuir",
	subjectKind: "Tipo",
	subjectId: "Id do sujeito",
	tenantId: "Id do tenant (opcional)",
	expiresAt: "Expira em (opcional)",
	unassign: "Remover",
	saveError: "Falha ao salvar",
	selectRole: "Selecione uma função…",
};

const es: RbacMessages = {
	title: "Roles y permisos",
	subtitle: "Roles dinámicos asignables a usuarios y grupos.",
	rolesTitle: "Roles",
	rolesEmpty: "Aún no hay roles.",
	newRole: "Nuevo role",
	roleName: "Nombre",
	roleDescription: "Descripción",
	createRole: "Crear",
	deleteRole: "Eliminar",
	permissionsTitle: "Matriz de permisos",
	matrixEmpty: "Selecciona un role para editar sus concesiones.",
	colPermission: "Permiso",
	colEffect: "Efecto",
	effectNone: "—",
	effectAllow: "permitir",
	effectDeny: "denegar",
	assignmentsTitle: "Asignaciones",
	assignmentsEmpty: "Ningún sujeto asignado.",
	colSubject: "Tipo",
	colSubjectId: "Sujeto",
	colRole: "Role",
	colTenant: "Tenant",
	colExpires: "Expira",
	colGrantedBy: "Concedido por",
	globalTenant: "global",
	neverExpires: "nunca",
	assignSubject: "Asignar",
	subjectKind: "Tipo",
	subjectId: "Id del sujeto",
	tenantId: "Id del tenant (opcional)",
	expiresAt: "Expira el (opcional)",
	unassign: "Quitar",
	saveError: "Error al guardar",
	selectRole: "Selecciona un role…",
};

const CATALOGS: Record<RbacLocale, RbacMessages> = { en, "pt-BR": ptBR, es };

export const isRbacLocale = (locale: string): locale is RbacLocale =>
	(RBAC_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const rbacMessages = (locale: string): RbacMessages =>
	CATALOGS[isRbacLocale(locale) ? locale : BASE_LOCALE];
