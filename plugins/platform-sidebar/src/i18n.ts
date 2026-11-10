/**
 * Platform console shell copy, one typed catalog per locale. The shell
 * is a plugin view — it cannot import the host's Paraglide output
 * (arch lint), so the host route injects the active locale as a prop
 * and the chrome strings resolve here. A locale catalog must implement
 * `ConsoleMessages` in full — a missing key is a type error, not an
 * English fallback at runtime.
 */

export const CONSOLE_LOCALES = ["en", "pt-BR"] as const;
export type ConsoleLocale = (typeof CONSOLE_LOCALES)[number];
export const BASE_LOCALE: ConsoleLocale = "en";

export interface ConsoleMessages {
	readonly badge: string;
	readonly breadcrumbRoot: string;
	readonly overview: string;
	readonly backToApp: string;
	readonly signOut: string;
	readonly adminFallback: string;
}

const en: ConsoleMessages = {
	badge: "PLATFORM",
	breadcrumbRoot: "platform",
	overview: "overview",
	backToApp: "back to app",
	signOut: "Sign out",
	adminFallback: "admin",
};

const ptBR: ConsoleMessages = {
	badge: "PLATAFORMA",
	breadcrumbRoot: "plataforma",
	overview: "visão geral",
	backToApp: "voltar ao app",
	signOut: "Sair",
	adminFallback: "admin",
};

const CATALOGS: Record<ConsoleLocale, ConsoleMessages> = { en, "pt-BR": ptBR };

export const isConsoleLocale = (locale: string): locale is ConsoleLocale =>
	(CONSOLE_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const consoleMessages = (locale: string): ConsoleMessages =>
	CATALOGS[isConsoleLocale(locale) ? locale : BASE_LOCALE];
