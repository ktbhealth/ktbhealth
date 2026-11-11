import { describe, expect, it } from "vitest";

import {
	BASE_LOCALE,
	TENANT_LOCALES,
	tenantMessages,
	isTenantLocale,
	type TenantMessages,
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

describe("tenant catalogs", () => {
	it("resolves known locales and falls back to the base locale", () => {
		expect(isTenantLocale("pt-BR")).toBe(true);
		expect(isTenantLocale("es")).toBe(true);
		expect(isTenantLocale("fr")).toBe(false);
		expect(tenantMessages("fr")).toBe(tenantMessages(BASE_LOCALE));
		expect(tenantMessages("pt-BR").title).toBe("Tenants");
	});

	it("has no blank copy in any locale", () => {
		for (const locale of TENANT_LOCALES) {
			expect(leaves(tenantMessages(locale)).every((s) => s.trim() !== "")).toBe(true);
		}
	});

	it("pluralizes the platform-wide count in every locale", () => {
		const expected: Record<string, [string, string]> = {
			en: ["1 tenant across the platform.", "3 tenants across the platform."],
			"pt-BR": ["1 tenant em toda a plataforma.", "3 tenants em toda a plataforma."],
			es: ["1 tenant en toda la plataforma.", "3 tenants en toda la plataforma."],
		};
		for (const locale of TENANT_LOCALES) {
			const count = (tenantMessages(locale) as TenantMessages).count;
			const [one, many] = expected[locale]!;
			expect(count(1)).toBe(one);
			expect(count(3)).toBe(many);
		}
	});

	it("every catalog function returns copy in every locale", () => {
		for (const locale of TENANT_LOCALES) {
			for (const fn of functionsOf(tenantMessages(locale))) {
				for (const args of [[1], [2], ["x"], [0]]) {
					expect(typeof fn(...args)).toBe("string");
				}
			}
		}
	});
});
