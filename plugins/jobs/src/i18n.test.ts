import { describe, expect, it } from "vitest";

import {
	BASE_LOCALE,
	JOB_LOCALES,
	jobMessages,
	isJobLocale,
	type JobMessages,
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

describe("job catalogs", () => {
	it("resolves known locales and falls back to the base locale", () => {
		expect(isJobLocale("pt-BR")).toBe(true);
		expect(isJobLocale("es")).toBe(true);
		expect(isJobLocale("fr")).toBe(false);
		expect(jobMessages("fr")).toBe(jobMessages(BASE_LOCALE));
		expect(jobMessages("pt-BR").label).toBe("Tarefas em segundo plano");
	});

	it("has no blank copy in any locale", () => {
		for (const locale of JOB_LOCALES) {
			expect(leaves(jobMessages(locale)).every((s) => s.trim() !== "")).toBe(true);
		}
	});

	it("formats active counts and consultation refs in every locale", () => {
		const expected: Record<string, [string, string]> = {
			en: ["3 active", "consultation #7"],
			"pt-BR": ["3 ativas", "consulta #7"],
			es: ["3 activas", "consulta #7"],
		};
		for (const locale of JOB_LOCALES) {
			const m = jobMessages(locale) as JobMessages;
			const [active, ref] = expected[locale]!;
			expect(m.activeCount(3)).toBe(active);
			expect(m.consultationRef(7)).toBe(ref);
		}
	});

	it("every catalog function returns copy in every locale", () => {
		for (const locale of JOB_LOCALES) {
			for (const fn of functionsOf(jobMessages(locale))) {
				for (const args of [[1], [2], ["x"], [0]]) {
					expect(typeof fn(...args)).toBe("string");
				}
			}
		}
	});
});
