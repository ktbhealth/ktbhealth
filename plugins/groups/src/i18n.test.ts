import { describe, expect, it } from "vitest";

import {
	BASE_LOCALE,
	GROUP_LOCALES,
	groupMessages,
	isGroupLocale,
	type GroupMessages,
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

describe("group catalogs", () => {
	it("resolves known locales and falls back to the base locale", () => {
		expect(isGroupLocale("pt-BR")).toBe(true);
		expect(isGroupLocale("es")).toBe(true);
		expect(isGroupLocale("fr")).toBe(false);
		expect(groupMessages("fr")).toBe(groupMessages(BASE_LOCALE));
		expect(groupMessages("pt-BR").title).toBe("Grupos");
	});

	it("has no blank copy in any locale", () => {
		for (const locale of GROUP_LOCALES) {
			expect(leaves(groupMessages(locale)).every((s) => s.trim() !== "")).toBe(true);
		}
	});

	it("pluralizes the platform-wide count in every locale", () => {
		const expected: Record<string, [string, string]> = {
			en: ["1 group across the platform.", "3 groups across the platform."],
			"pt-BR": ["1 grupo em toda a plataforma.", "3 grupos em toda a plataforma."],
			es: ["1 grupo en toda la plataforma.", "3 grupos en toda la plataforma."],
		};
		for (const locale of GROUP_LOCALES) {
			const count = (groupMessages(locale) as GroupMessages).count;
			const [one, many] = expected[locale]!;
			expect(count(1)).toBe(one);
			expect(count(3)).toBe(many);
		}
	});

	it("every catalog function returns copy in every locale", () => {
		for (const locale of GROUP_LOCALES) {
			for (const fn of functionsOf(groupMessages(locale))) {
				for (const args of [[1], [2], ["x"], [0]]) {
					expect(typeof fn(...args)).toBe("string");
				}
			}
		}
	});
});
