/**
 * Notifications plugin copy, one typed catalog per locale. Plugins cannot
 * import the host's Paraglide output (arch lint); the host injects the
 * active locale (header-action prop, `getLocale()` at event ingest) and
 * copy resolves here. A locale catalog must implement
 * `NotificationMessages` in full — a missing key is a type error, not
 * an English fallback at runtime.
 */

export const NOTIFICATION_LOCALES = ["en", "pt-BR"] as const;
export type NotificationLocale = (typeof NOTIFICATION_LOCALES)[number];
export const BASE_LOCALE: NotificationLocale = "en";

export interface NotificationMessages {
	readonly label: string;
	readonly unreadCount: (n: number) => string;
	readonly markAllRead: string;
	readonly empty: string;
	readonly markAsRead: (title: string) => string;
	/** Persisted notification titles, keyed by event kind. */
	readonly titles: {
		readonly patientCreated: string;
		readonly patientDeleted: string;
		readonly consultationCreated: string;
	};
}

const en: NotificationMessages = {
	label: "Notifications",
	unreadCount: (n) => `${n} unread`,
	markAllRead: "Mark all read",
	empty: "No notifications",
	markAsRead: (title) => `Mark "${title}" as read`,
	titles: {
		patientCreated: "Patient created",
		patientDeleted: "Patient deleted",
		consultationCreated: "Consultation started",
	},
};

const ptBR: NotificationMessages = {
	label: "Notificações",
	unreadCount: (n) => `${n} não lida${n === 1 ? "" : "s"}`,
	markAllRead: "Marcar todas como lidas",
	empty: "Nenhuma notificação",
	markAsRead: (title) => `Marcar "${title}" como lida`,
	titles: {
		patientCreated: "Paciente criado",
		patientDeleted: "Paciente excluído",
		consultationCreated: "Consulta iniciada",
	},
};

const CATALOGS: Record<NotificationLocale, NotificationMessages> = { en, "pt-BR": ptBR };

export const isNotificationLocale = (locale: string): locale is NotificationLocale =>
	(NOTIFICATION_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const notificationMessages = (locale: string): NotificationMessages =>
	CATALOGS[isNotificationLocale(locale) ? locale : BASE_LOCALE];
