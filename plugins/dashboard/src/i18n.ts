/**
 * Dashboard plugin copy, one typed catalog per locale. Plugins cannot
 * import the host's Paraglide output (arch lint); the host injects the
 * active locale through the panel page ctx and the view resolves its
 * strings here. A locale catalog must implement `DashboardMessages`
 * in full — a missing key is a type error, not an English fallback.
 */

export const DASHBOARD_LOCALES = ["en", "pt-BR", "es"] as const;
export type DashboardLocale = (typeof DASHBOARD_LOCALES)[number];
export const BASE_LOCALE: DashboardLocale = "en";

export interface DashboardMessages {
	readonly title: string;
	readonly subtitle: string;
	readonly stats: {
		readonly patients: string;
		readonly consultations: string;
		readonly plugins: string;
		readonly sidebarItems: string;
	};
	readonly recentConsultations: string;
	readonly noConsultations: string;
	readonly registeredPlugins: string;
	readonly colId: string;
	readonly colStatus: string;
	readonly colSource: string;
	readonly colOwner: string;
	readonly colCreated: string;
	readonly colContributions: string;
	readonly consoleActivity: string;
	readonly unreadNotifications: string;
	readonly noNotifications: string;
}

const en: DashboardMessages = {
	title: "dashboard",
	subtitle: "System overview — aggregated across plugins.",
	stats: {
		patients: "Patients",
		consultations: "Consultations",
		plugins: "Plugins",
		sidebarItems: "Sidebar items",
	},
	recentConsultations: "Recent consultations",
	noConsultations: "No consultations yet.",
	registeredPlugins: "Registered plugins",
	colId: "Id",
	colStatus: "Status",
	colSource: "Source",
	colOwner: "Owner",
	colCreated: "Created",
	colContributions: "Contributions",
	consoleActivity: "Console activity",
	unreadNotifications: "Unread notifications",
	noNotifications: "No notifications yet.",
};

const ptBR: DashboardMessages = {
	title: "painel",
	subtitle: "Visão geral do sistema — consolidada entre os plugins.",
	stats: {
		patients: "Pacientes",
		consultations: "Consultas",
		plugins: "Plugins",
		sidebarItems: "Itens da barra lateral",
	},
	recentConsultations: "Consultas recentes",
	noConsultations: "Nenhuma consulta ainda.",
	registeredPlugins: "Plugins registrados",
	colId: "Id",
	colStatus: "Status",
	colSource: "Origem",
	colOwner: "Proprietário",
	colCreated: "Criada em",
	colContributions: "Contribuições",
	consoleActivity: "Atividade do console",
	unreadNotifications: "Notificações não lidas",
	noNotifications: "Nenhuma notificação ainda.",
};

const es: DashboardMessages = {
	title: "panel",
	subtitle: "Resumen del sistema — consolidado entre los plugins.",
	stats: {
		patients: "Pacientes",
		consultations: "Consultas",
		plugins: "Plugins",
		sidebarItems: "Elementos de la barra lateral",
	},
	recentConsultations: "Consultas recientes",
	noConsultations: "Ninguna consulta aún.",
	registeredPlugins: "Plugins registrados",
	colId: "Id",
	colStatus: "Estado",
	colSource: "Origen",
	colOwner: "Propietario",
	colCreated: "Creada",
	colContributions: "Contribuciones",
	consoleActivity: "Actividad de la consola",
	unreadNotifications: "Notificaciones no leídas",
	noNotifications: "Ninguna notificación aún.",
};

const CATALOGS: Record<DashboardLocale, DashboardMessages> = { en, "pt-BR": ptBR, es };

export const isDashboardLocale = (locale: string): locale is DashboardLocale =>
	(DASHBOARD_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const dashboardMessages = (locale: string): DashboardMessages =>
	CATALOGS[isDashboardLocale(locale) ? locale : BASE_LOCALE];
