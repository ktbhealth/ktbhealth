/**
 * Audit plugin copy, one typed catalog per locale. Plugins cannot
 * import the host's Paraglide output (arch lint); the host injects the
 * active locale through the panel page ctx and the view resolves its
 * strings here. A locale catalog must implement `AuditMessages` in
 * full — a missing key is a type error, not an English fallback.
 */

export const AUDIT_LOCALES = ["en", "pt-BR", "es"] as const;
export type AuditLocale = (typeof AUDIT_LOCALES)[number];
export const BASE_LOCALE: AuditLocale = "en";

export interface AuditMessages {
	readonly title: string;
	readonly description: (shown: number, total: number) => string;
	readonly searchPlaceholder: string;
	readonly searchLabel: string;
	readonly allActions: string;
	readonly noMatch: string;
	readonly filteredCount: (shown: number, total: number) => string;
	readonly colTime: string;
	readonly colActor: string;
	readonly colAction: string;
	readonly colTarget: string;
	readonly colTenant: string;
	readonly colDetail: string;
	readonly emptyTitle: string;
	readonly emptyDescription: string;
	readonly detailTitle: string;
	readonly systemActor: string;
	readonly noTarget: string;
	readonly noTenant: string;
}

const en: AuditMessages = {
	title: "Audit log",
	description: (shown, total) =>
		shown >= total
			? `${total} admin ${total === 1 ? "action" : "actions"} recorded.`
			: `Latest ${shown} of ${total} admin ${total === 1 ? "action" : "actions"}.`,
	searchPlaceholder: "Search actor, action or target…",
	searchLabel: "Search audit entries",
	allActions: "All actions",
	noMatch: "No entries match the filters.",
	filteredCount: (shown, total) => `Showing ${shown} of ${total}`,
	colTime: "Time",
	colActor: "Actor",
	colAction: "Action",
	colTarget: "Target",
	colTenant: "Tenant",
	colDetail: "Detail",
	emptyTitle: "No audit entries",
	emptyDescription: "Platform admin actions will appear here.",
	detailTitle: "Audit entry",
	systemActor: "system",
	noTarget: "—",
	noTenant: "—",
};

const ptBR: AuditMessages = {
	title: "Log de auditoria",
	description: (shown, total) =>
		shown >= total
			? `${total} ${total === 1 ? "ação" : "ações"} de admin registradas.`
			: `Últimas ${shown} de ${total} ${total === 1 ? "ação" : "ações"} de admin.`,
	searchPlaceholder: "Buscar ator, ação ou alvo…",
	searchLabel: "Buscar entradas de auditoria",
	allActions: "Todas as ações",
	noMatch: "Nenhuma entrada corresponde aos filtros.",
	filteredCount: (shown, total) => `Exibindo ${shown} de ${total}`,
	colTime: "Hora",
	colActor: "Ator",
	colAction: "Ação",
	colTarget: "Alvo",
	colTenant: "Tenant",
	colDetail: "Detalhe",
	emptyTitle: "Nenhuma entrada de auditoria",
	emptyDescription: "As ações de admin da plataforma aparecerão aqui.",
	detailTitle: "Entrada de auditoria",
	systemActor: "sistema",
	noTarget: "—",
	noTenant: "—",
};

const es: AuditMessages = {
	title: "Registro de auditoría",
	description: (shown, total) =>
		shown >= total
			? `${total} ${total === 1 ? "acción" : "acciones"} de admin registradas.`
			: `Últimas ${shown} de ${total} ${total === 1 ? "acción" : "acciones"} de admin.`,
	searchPlaceholder: "Buscar actor, acción o destino…",
	searchLabel: "Buscar entradas de auditoría",
	allActions: "Todas las acciones",
	noMatch: "Ninguna entrada coincide con los filtros.",
	filteredCount: (shown, total) => `Mostrando ${shown} de ${total}`,
	colTime: "Hora",
	colActor: "Actor",
	colAction: "Acción",
	colTarget: "Destino",
	colTenant: "Tenant",
	colDetail: "Detalle",
	emptyTitle: "Sin entradas de auditoría",
	emptyDescription: "Las acciones de admin de la plataforma aparecerán aquí.",
	detailTitle: "Entrada de auditoría",
	systemActor: "sistema",
	noTarget: "—",
	noTenant: "—",
};

const CATALOGS: Record<AuditLocale, AuditMessages> = { en, "pt-BR": ptBR, es };

export const isAuditLocale = (locale: string): locale is AuditLocale =>
	(AUDIT_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const auditMessages = (locale: string): AuditMessages =>
	CATALOGS[isAuditLocale(locale) ? locale : BASE_LOCALE];
