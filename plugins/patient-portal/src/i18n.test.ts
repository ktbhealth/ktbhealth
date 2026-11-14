import { describe, expect, it } from "vitest";

import { SECTION_LABELS } from "@ktb/anamnesis/types";

import { BASE_LOCALE, PORTAL_LOCALES, isPortalLocale, portalMessages } from "./i18n.ts";

/** Flattened `path → rendered string` view of a catalog. */
const flatten = (value: unknown, path = ""): Record<string, string> => {
	if (typeof value === "function") return { [path]: String(value("X")) };
	if (typeof value === "string") return { [path]: value };
	return Object.assign(
		{},
		...Object.entries(value as Record<string, unknown>).map(([key, child]) =>
			flatten(child, path ? `${path}.${key}` : key),
		),
	);
};

describe("portal catalogs", () => {
	it("has a complete, non-empty catalog per locale", () => {
		const keys = Object.keys(flatten(portalMessages(BASE_LOCALE))).sort();
		for (const locale of PORTAL_LOCALES) {
			const catalog = flatten(portalMessages(locale));
			expect(Object.keys(catalog).sort()).toEqual(keys);
			for (const text of Object.values(catalog)) expect(text.trim()).not.toBe("");
		}
	});

	it("labels every section of the record", () => {
		for (const locale of PORTAL_LOCALES) {
			expect(Object.keys(portalMessages(locale).sections).sort()).toEqual(
				Object.keys(SECTION_LABELS).sort(),
			);
		}
	});

	it("greets the user by name", () => {
		expect(portalMessages("en").greeting("Ana")).toBe("Hello, Ana.");
		expect(portalMessages("pt-BR").greeting("Ana")).toBe("Olá, Ana.");
		expect(portalMessages("es").greeting("Ana")).toBe("Hola, Ana.");
	});

	it("translates instead of copying the base catalog", () => {
		expect(portalMessages("pt-BR").title).not.toBe(portalMessages("en").title);
		expect(portalMessages("es").title).not.toBe(portalMessages("en").title);
	});

	it("falls back to the base locale for unknown tags", () => {
		expect(isPortalLocale("pt-BR")).toBe(true);
		expect(isPortalLocale("fr")).toBe(false);
		expect(portalMessages("fr")).toBe(portalMessages(BASE_LOCALE));
	});
});
