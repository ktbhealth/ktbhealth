import type { SearchSchemaInput } from "@tanstack/react-router";

import * as m from "#/paraglide/messages.js";

/**
 * Landing page audiences — the same four sections as the docs site
 * (`docs` repo, content/docs/<lang>/<persona>). The active persona lives in
 * the URL as `?persona=…` so a link can open the landing for one audience.
 */
export const PERSONAS = ["doctors", "patients", "developers", "business"] as const;
export type Persona = (typeof PERSONAS)[number];
export const DEFAULT_PERSONA: Persona = "doctors";

export function isPersona(value: unknown): value is Persona {
	return typeof value === "string" && (PERSONAS as readonly string[]).includes(value);
}

/** Unknown or missing values fall back to the default persona. */
export function parsePersona(value: unknown): Persona {
	return isPersona(value) ? value : DEFAULT_PERSONA;
}

/**
 * `validateSearch` for the landing route. The input is optional
 * (`SearchSchemaInput`), so `<Link to="/">` needs no search params.
 */
export function validatePersonaSearch(search: { persona?: unknown } & SearchSchemaInput): {
	persona: Persona;
} {
	return { persona: parsePersona(search.persona) };
}

const LABELS: Record<Persona, () => string> = {
	doctors: m.persona_doctors,
	patients: m.persona_patients,
	developers: m.persona_developers,
	business: m.persona_business,
};

export function personaLabel(persona: Persona): string {
	return LABELS[persona]();
}

/** Entry page of each persona's docs section (see docs content/docs/en/index.mdx). */
const DOCS_PATHS: Record<Persona, string> = {
	doctors: "doctors/getting-started",
	patients: "patients/what-to-expect",
	developers: "developers/tutorials/getting-started",
	business: "business/positioning",
};

/** Local docs dev server (`vite dev` in the docs repo). */
export const DEFAULT_DOCS_URL = "http://localhost:5173";

/** Docs site origin: `VITE_DOCS_URL` at build time, else the local dev server. */
export function docsBaseUrl(env: Record<string, unknown>): string {
	const url = env.VITE_DOCS_URL;
	return typeof url === "string" && url !== "" ? url : DEFAULT_DOCS_URL;
}

/** Docs URL for a persona; the docs site has `en` and `pt-BR` (anything else reads `en`). */
export function docsHref(
	persona: Persona,
	locale: string,
	base: string = docsBaseUrl(import.meta.env),
): string {
	const lang = locale === "pt-BR" ? "pt-BR" : "en";
	return `${base.replace(/\/$/, "")}/${lang}/docs/${DOCS_PATHS[persona]}`;
}
