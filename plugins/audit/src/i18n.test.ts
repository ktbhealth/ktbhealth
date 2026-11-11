import { describe, expect, it } from "vitest";

import {
	AUDIT_LOCALES,
	BASE_LOCALE,
	auditMessages,
	isAuditLocale,
	type AuditMessages,
} from "./i18n.ts";

/** Every string leaf of a catalog (functions are exercised separately). */
const leaves = (node: unknown): string[] =>
	typeof node === "string"
		? [node]
		: node && typeof node === "object"
			? Object.values(node).flatMap(leaves)
			: [];

/** Every function leaf of a catalog. */
const functionsOf = (
	node: unknown,
	out: Array<(...args: any[]) => unknown> = [],
): Array<(...args: any[]) => unknown> => {
	if (typeof node === "function") out.push(node as (...args: any[]) => unknown);
	else if (node !== null && typeof node === "object")
		for (const value of Object.values(node)) functionsOf(value, out);
	return out;
};

describe("audit catalogs", () => {
	it("resolves known locales and falls back to the base locale", () => {
		expect(isAuditLocale("pt-BR")).toBe(true);
		expect(isAuditLocale("es")).toBe(true);
		expect(isAuditLocale("fr")).toBe(false);
		expect(auditMessages("fr")).toBe(auditMessages(BASE_LOCALE));
		expect(auditMessages("pt-BR").title).toBe("Log de auditoria");
	});

	it("covers exactly the three supported locales", () => {
		expect([...AUDIT_LOCALES].sort()).toEqual(["en", "es", "pt-BR"]);
	});

	it("has no blank copy in any locale", () => {
		for (const locale of AUDIT_LOCALES) {
			expect(leaves(auditMessages(locale)).every((s) => s.trim() !== "")).toBe(true);
		}
	});

	it("describes the capped page and the full count in every locale", () => {
		const expected: Record<string, [string, string]> = {
			en: ["3 admin actions recorded.", "Latest 2 of 5 admin actions."],
			"pt-BR": ["3 ações de admin registradas.", "Últimas 2 de 5 ações de admin."],
			es: ["3 acciones de admin registradas.", "Últimas 2 de 5 acciones de admin."],
		};
		const singularLatest: Record<string, string> = {
			en: "Latest 0 of 1 admin action.",
			"pt-BR": "Últimas 0 de 1 ação de admin.",
			es: "Últimas 0 de 1 acción de admin.",
		};
		for (const locale of AUDIT_LOCALES) {
			const description = (auditMessages(locale) as AuditMessages).description;
			const [all, capped] = expected[locale]!;
			expect(description(3, 3)).toBe(all);
			expect(description(2, 5)).toBe(capped);
			// Singular noun on the capped arm too (shown < total === 1).
			expect(description(0, 1)).toBe(singularLatest[locale]);
		}
	});

	it("every catalog function returns copy in every locale", () => {
		for (const locale of AUDIT_LOCALES) {
			for (const fn of functionsOf(auditMessages(locale))) {
				for (const args of [
					[1, 1],
					[2, 9],
					["x", "y"],
					[0, 0],
				]) {
					expect(typeof fn(...args)).toBe("string");
				}
			}
		}
	});
});
