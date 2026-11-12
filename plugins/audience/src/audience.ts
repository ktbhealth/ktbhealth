import type { SearchSchemaInput } from "@tanstack/react-router";

/**
 * Landing page audiences — the same four sections as the docs site
 * (`docs` repo, content/docs/<lang>/<audience>). The active audience
 * lives in the URL as `?audience=…` so a link can open the landing for
 * one audience. Renamed from `persona` (P-056) — "persona" collides
 * with the Rive avatar in `@ktbhealth/ui` ai-elements.
 */
export const AUDIENCES = ["doctors", "patients", "developers", "business"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const DEFAULT_AUDIENCE: Audience = "doctors";

export function isAudience(value: unknown): value is Audience {
	return typeof value === "string" && (AUDIENCES as readonly string[]).includes(value);
}

/** Unknown or missing values fall back to the default audience. */
export function parseAudience(value: unknown): Audience {
	return isAudience(value) ? value : DEFAULT_AUDIENCE;
}

/**
 * `validateSearch` for the landing route. The input is optional
 * (`SearchSchemaInput`), so `<Link to="/">` needs no search params.
 */
export function validateAudienceSearch(
	search: {
		audience?: unknown;
	} & SearchSchemaInput,
): {
	audience: Audience;
} {
	return { audience: parseAudience(search.audience) };
}

/** Entry page of each audience's docs section (see docs content/docs/en/index.mdx). */
const DOCS_PATHS: Record<Audience, string> = {
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

/** Docs URL for an audience; the docs site has `en` and `pt-BR` (anything else reads `en`). */
export function docsHref(
	audience: Audience,
	locale: string,
	base: string = docsBaseUrl(import.meta.env),
): string {
	const lang = locale === "pt-BR" ? "pt-BR" : "en";
	return `${base.replace(/\/$/, "")}/${lang}/docs/${DOCS_PATHS[audience]}`;
}
