import { describe, expect, it } from "vitest";

import { AUDIENCE_LOCALES, BASE_LOCALE, audienceMessages, isAudienceLocale } from "./i18n.ts";

/** Every string leaf of a catalog. */
const leaves = (node: unknown): string[] =>
	typeof node === "string"
		? [node]
		: node && typeof node === "object"
			? Object.values(node).flatMap(leaves)
			: [];

describe("audience catalogs", () => {
	it("resolves known locales and falls back to the base locale", () => {
		expect(isAudienceLocale("pt-BR")).toBe(true);
		expect(isAudienceLocale("es")).toBe(true);
		expect(isAudienceLocale("fr")).toBe(false);
		expect(audienceMessages("fr")).toBe(audienceMessages(BASE_LOCALE));
		expect(audienceMessages("pt-BR").audience_doctors).toBe("Médicos");
		expect(audienceMessages("es").audience_doctors).toBe("Médicos");
	});

	it("covers every app locale", () => {
		expect([...AUDIENCE_LOCALES]).toEqual(["en", "pt-BR", "es"]);
	});

	it("has no blank copy in any locale", () => {
		for (const locale of AUDIENCE_LOCALES) {
			expect(leaves(audienceMessages(locale)).every((s) => s.trim() !== "")).toBe(true);
		}
	});
});
