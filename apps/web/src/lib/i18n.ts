import * as m from "#/paraglide/messages.js";
import { baseLocale, cookieName, setLocale, toLocale, type Locale } from "#/paraglide/runtime.js";

/** Endonym labels for the language picker (not translated themselves). */
const LOCALE_NAMES: Record<string, () => string> = {
	en: m.locale_en,
	"pt-BR": m.locale_pt_BR,
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
