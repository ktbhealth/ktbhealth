import * as m from "#/paraglide/messages.js";
import { baseLocale, cookieName, setLocale, toLocale, type Locale } from "#/paraglide/runtime.js";

/** Endonym labels for the language picker (not translated themselves). */
const LOCALE_NAMES: Record<string, () => string> = {
	en: m.locale_en,
	"pt-BR": m.locale_pt_BR,
	es: m.locale_es,
};

/**
 * Extract the paraglide locale cookie from a raw `Cookie` header value.
 * Returns undefined when absent or not a known locale.
 */
export function localeFromCookieHeader(header: string | null): Locale | undefined {
	if (!header) return undefined;
	const match = header.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`));
	const value = match?.[1];
	return toLocale(value);
}

/** Locale for an incoming request: cookie first, then the base locale. */
export function requestLocale(request: Request): Locale {
	return localeFromCookieHeader(request.headers.get("cookie")) ?? baseLocale;
}

/** Display name for a locale, falling back to the raw tag. */
export function localeName(locale: string): string {
	return LOCALE_NAMES[locale]?.() ?? locale;
}

// Plugin nav labels are declared in plugin manifests (English-only data);
// the host maps known destinations to localized chrome strings here.
const NAV_LABELS: Record<string, () => string> = {
	"/consultations": () => m.nav_consultations(),
	"/patients": () => m.nav_patients(),
};

// Same deal for /platform console chrome: sidebar item labels are keyed
// by route path, group headers by their manifest group name.
const PANEL_LABELS: Record<string, () => string> = {
	"/platform": () => m.panel_nav_dashboard(),
	"/platform/consultations": () => m.nav_consultations(),
	"/platform/patients": () => m.nav_patients(),
	"/platform/users": () => m.panel_nav_users(),
	"/platform/groups": () => m.panel_nav_groups(),
	"/platform/ops": () => m.panel_nav_ops(),
};

const PANEL_GROUPS: Record<string, () => string> = {
	Access: () => m.panel_group_access(),
	Domains: () => m.panel_group_domains(),
	System: () => m.panel_group_system(),
};

/** Switch the UI locale (paraglide persists the cookie and reloads). */
export function changeLocale(locale: string): void {
	const resolved = toLocale(locale);
	if (resolved) void setLocale(resolved);
}

/** Localized label for a plugin-declared nav item, or its raw label. */
export function pluginNavLabel(to: string, fallback: string): string {
	return NAV_LABELS[to]?.() ?? fallback;
}

/** Localized label for a plugin-declared /platform sidebar item. */
export function pluginPanelLabel(to: string, fallback: string): string {
	return PANEL_LABELS[to]?.() ?? fallback;
}

/** Localized label for a plugin-declared sidebar group, or its raw label. */
export function pluginPanelGroup(group: string): string {
	return PANEL_GROUPS[group]?.() ?? group;
}
