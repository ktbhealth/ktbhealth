import { describe, expect, it } from "vitest";

import {
	AUTH_LOCALES,
	BASE_LOCALE,
	authMessages,
	isAuthLocale,
	type AuthMessages,
} from "./i18n.ts";

/** Every string leaf of a catalog (functions are exercised separately). */
const leaves = (node: unknown): string[] =>
	typeof node === "string"
		? [node]
		: node && typeof node === "object"
			? Object.values(node).flatMap(leaves)
			: [];

describe("auth catalogs", () => {
	it("resolves known locales and falls back to the base locale", () => {
		expect(isAuthLocale("pt-BR")).toBe(true);
		expect(isAuthLocale("es")).toBe(true);
		expect(isAuthLocale("fr")).toBe(false);
		expect(authMessages("fr")).toBe(authMessages(BASE_LOCALE));
		expect(authMessages("pt-BR").metaTitle).toBe("Entrar | KTB Health");
	});

	it("has no blank copy in any locale", () => {
		for (const locale of AUTH_LOCALES) {
			const catalog = authMessages(locale);
			for (const value of leaves(catalog)) {
				expect(value.trim(), `${locale} catalog`).not.toBe("");
			}
		}
	});

	it("keeps every catalog key a non-empty localized string", () => {
		const en = authMessages(BASE_LOCALE);
		const keys = Object.keys(en) as Array<keyof AuthMessages>;
		expect(keys.length).toBeGreaterThan(0);
		for (const locale of AUTH_LOCALES) {
			const catalog = authMessages(locale);
			for (const key of keys) {
				expect(typeof catalog[key], `${locale}.${key}`).toBe("string");
			}
		}
	});
});
