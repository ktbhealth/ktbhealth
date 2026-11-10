import { describe, expect, it } from "vitest";

import {
	BASE_LOCALE,
	USER_LOCALES,
	userMessages,
	isUserLocale,
	type UserMessages,
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

describe("user catalogs", () => {
	it("resolves known locales and falls back to the base locale", () => {
		expect(isUserLocale("pt-BR")).toBe(true);
		expect(isUserLocale("es")).toBe(true);
		expect(isUserLocale("fr")).toBe(false);
		expect(userMessages("fr")).toBe(userMessages(BASE_LOCALE));
		expect(userMessages("pt-BR").title).toBe("Usuários");
	});

	it("has no blank copy in any locale", () => {
		for (const locale of USER_LOCALES) {
			expect(leaves(userMessages(locale)).every((s) => s.trim() !== "")).toBe(true);
		}
	});

	it("pluralizes the platform-wide count in every locale", () => {
		const expected: Record<string, [string, string]> = {
			en: ["1 user across the platform.", "3 users across the platform."],
			"pt-BR": ["1 usuário em toda a plataforma.", "3 usuários em toda a plataforma."],
			es: ["1 usuario en toda la plataforma.", "3 usuarios en toda la plataforma."],
		};
		for (const locale of USER_LOCALES) {
			const count = (userMessages(locale) as UserMessages).count;
			const [one, many] = expected[locale]!;
			expect(count(1)).toBe(one);
			expect(count(3)).toBe(many);
		}
	});

	it("every catalog function returns copy in every locale", () => {
		for (const locale of USER_LOCALES) {
			for (const fn of functionsOf(userMessages(locale))) {
				for (const args of [[1], [2], ["x"], [0]]) {
					expect(typeof fn(...args)).toBe("string");
				}
			}
		}
	});
});
