import { describe, expect, it } from "vitest";

import {
	AUDIENCES,
	DEFAULT_AUDIENCE,
	DEFAULT_DOCS_URL,
	docsBaseUrl,
	docsHref,
	isAudience,
	parseAudience,
	validateAudienceSearch,
} from "./audience.ts";
import { audienceMessages } from "./i18n.ts";

describe("audience", () => {
	it("lists the four docs audiences, doctors first", () => {
		expect(AUDIENCES).toEqual(["doctors", "patients", "developers", "business"]);
		expect(DEFAULT_AUDIENCE).toBe("doctors");
	});

	it("recognizes only known audiences", () => {
		expect(isAudience("patients")).toBe(true);
		expect(isAudience("admins")).toBe(false);
		expect(isAudience(3)).toBe(false);
		expect(isAudience(undefined)).toBe(false);
	});

	it("parses unknown or missing values to the default audience", () => {
		expect(parseAudience("business")).toBe("business");
		expect(parseAudience("nope")).toBe("doctors");
		expect(parseAudience(null)).toBe("doctors");
	});

	it("validates the landing search params", () => {
		expect(validateAudienceSearch({ audience: "developers" } as never)).toEqual({
			audience: "developers",
		});
		expect(validateAudienceSearch({ audience: "x" } as never)).toEqual({ audience: "doctors" });
		expect(validateAudienceSearch({} as never)).toEqual({ audience: "doctors" });
	});

	it("labels every audience", () => {
		const t = audienceMessages("en");
		expect(
			AUDIENCES.map(
				(a) =>
					({
						doctors: t.audience_doctors,
						patients: t.audience_patients,
						developers: t.audience_developers,
						business: t.audience_business,
					})[a],
			),
		).toEqual(["Doctors", "Patients", "Developers", "Business"]);
	});

	it("reads the docs origin from VITE_DOCS_URL, else the local dev server", () => {
		expect(docsBaseUrl({ VITE_DOCS_URL: "https://docs.example" })).toBe("https://docs.example");
		expect(docsBaseUrl({ VITE_DOCS_URL: "" })).toBe(DEFAULT_DOCS_URL);
		expect(docsBaseUrl({})).toBe(DEFAULT_DOCS_URL);
	});

	it("links each audience to its docs section, in en or pt-BR", () => {
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
