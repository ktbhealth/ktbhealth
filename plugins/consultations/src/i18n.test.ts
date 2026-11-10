import { describe, expect, it } from "vitest";

import {
	BASE_LOCALE,
	CONSULTATION_LOCALES,
	consultationMessages,
	isConsultationLocale,
	sourceLabel,
} from "./i18n.ts";

/** Every string leaf of a catalog (functions are exercised separately). */
const leaves = (node: unknown): string[] =>
	typeof node === "string"
		? [node]
		: node && typeof node === "object"
			? Object.values(node).flatMap(leaves)
			: [];

/** Every function leaf of a catalog — views call these with real args;
 * the sweep invokes each once per locale so no catalog ships dead copy. */
const functionsOf = (
	node: unknown,
	out: Array<(...args: any[]) => unknown> = [],
): Array<(...args: any[]) => unknown> => {
	if (typeof node === "function") out.push(node as (...args: any[]) => unknown);
	else if (node !== null && typeof node === "object")
		for (const value of Object.values(node)) functionsOf(value, out);
	return out;
};

describe("consultation catalogs", () => {
	it("resolves known locales and falls back to the base locale", () => {
		expect(isConsultationLocale("pt-BR")).toBe(true);
		expect(isConsultationLocale("es")).toBe(true);
		expect(isConsultationLocale("fr")).toBe(false);
		expect(consultationMessages("fr")).toBe(consultationMessages(BASE_LOCALE));
		expect(consultationMessages("pt-BR").speakers.doctor).toBe("Médico");
		expect(consultationMessages("es").speakers.doctor).toBe("Médico");
	});

	it("has no blank copy in any locale", () => {
		for (const locale of CONSULTATION_LOCALES) {
			expect(leaves(consultationMessages(locale)).every((s) => s.trim() !== "")).toBe(true);
		}
	});

	it("every catalog function returns copy in every locale", () => {
		for (const locale of CONSULTATION_LOCALES) {
			const fns = functionsOf(consultationMessages(locale));
			expect(fns.length).toBeGreaterThan(20);
			for (const fn of fns) {
				// Singular/plural, string and empty-arg shapes hit the inner
				// ternaries (`n === 1`, `device ? …`, destructured optionals).
				for (const args of [[1], [2, true], ["x"], [0]]) {
					expect(typeof fn(...args)).toBe("string");
				}
			}
		}
	});

	it("dialogSavedBody covers named/unnamed, saved/updated and consent variants", () => {
		for (const locale of CONSULTATION_LOCALES) {
			const body = consultationMessages(locale).newConsultation.dialogSavedBody;
			expect(
				body({ id: 1, patientName: "Ana", updated: true, consented: true }),
			).toContain("1");
			expect(
				body({ id: 2, patientName: null, updated: false, consented: false }),
			).toContain("2");
		}
	});

	it("sourceLabel localizes known sources and passes the rest through", () => {
		const t = consultationMessages("en");
		expect(sourceLabel(t, "browser")).toBe("Browser voice");
		expect(sourceLabel(t, "dictation")).toBe("Dictation");
		expect(sourceLabel(t, "unknown-source")).toBe("unknown-source");
		expect(sourceLabel(t, null)).toBe("");
		expect(sourceLabel(t, undefined)).toBe("");
	});
});
