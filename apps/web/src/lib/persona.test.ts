import { describe, expect, it } from "vitest";

import {
	DEFAULT_DOCS_URL,
	DEFAULT_PERSONA,
	PERSONAS,
	docsBaseUrl,
	docsHref,
	isPersona,
	parsePersona,
	personaLabel,
	validatePersonaSearch,
} from "./persona.ts";

describe("persona", () => {
	it("lists the four docs audiences, doctors first", () => {
		expect(PERSONAS).toEqual(["doctors", "patients", "developers", "business"]);
		expect(DEFAULT_PERSONA).toBe("doctors");
	});

	it("recognizes only known personas", () => {
		expect(isPersona("patients")).toBe(true);
		expect(isPersona("admins")).toBe(false);
		expect(isPersona(3)).toBe(false);
		expect(isPersona(undefined)).toBe(false);
	});

	it("parses unknown or missing values to the default persona", () => {
		expect(parsePersona("business")).toBe("business");
		expect(parsePersona("nope")).toBe("doctors");
		expect(parsePersona(null)).toBe("doctors");
	});

	it("validates the landing search params", () => {
		expect(validatePersonaSearch({ persona: "developers" } as never)).toEqual({
			persona: "developers",
		});
		expect(validatePersonaSearch({ persona: "x" } as never)).toEqual({ persona: "doctors" });
		expect(validatePersonaSearch({} as never)).toEqual({ persona: "doctors" });
	});

	it("labels every persona", () => {
		expect(PERSONAS.map(personaLabel)).toEqual(["Doctors", "Patients", "Developers", "Business"]);
	});

	it("reads the docs origin from VITE_DOCS_URL, else the local dev server", () => {
		expect(docsBaseUrl({ VITE_DOCS_URL: "https://docs.example" })).toBe("https://docs.example");
		expect(docsBaseUrl({ VITE_DOCS_URL: "" })).toBe(DEFAULT_DOCS_URL);
		expect(docsBaseUrl({})).toBe(DEFAULT_DOCS_URL);
	});

	it("links each persona to its docs section, in en or pt-BR", () => {
		const base = "https://docs.example/";
		expect(docsHref("doctors", "en", base)).toBe(
			"https://docs.example/en/docs/doctors/getting-started",
		);
		expect(docsHref("patients", "pt-BR", base)).toBe(
			"https://docs.example/pt-BR/docs/patients/what-to-expect",
		);
		// The docs site has no Spanish: es reads the English docs.
		expect(docsHref("developers", "es", base)).toBe(
			"https://docs.example/en/docs/developers/tutorials/getting-started",
		);
		expect(docsHref("business", "en")).toBe(`${DEFAULT_DOCS_URL}/en/docs/business/positioning`);
	});
});
