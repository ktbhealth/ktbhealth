import { describe, expect, it } from "vitest";

import { BASE_LOCALE, DOCTOR_LOCALES, doctorMessages, isDoctorLocale } from "./i18n.ts";

describe("doctor catalogs", () => {
	it("has a complete, non-empty catalog per locale", () => {
		const keys = Object.keys(doctorMessages(BASE_LOCALE)).sort();
		for (const locale of DOCTOR_LOCALES) {
			const catalog = doctorMessages(locale);
			expect(Object.keys(catalog).sort()).toEqual(keys);
			for (const value of Object.values(catalog)) expect(value.trim()).not.toBe("");
		}
	});

	it("translates instead of copying the base catalog", () => {
		expect(doctorMessages("pt-BR").selectTitle).not.toBe(doctorMessages("en").selectTitle);
		expect(doctorMessages("es").selectTitle).not.toBe(doctorMessages("en").selectTitle);
	});

	it("falls back to the base locale for unknown tags", () => {
		expect(isDoctorLocale("pt-BR")).toBe(true);
		expect(isDoctorLocale("fr")).toBe(false);
		expect(doctorMessages("fr")).toBe(doctorMessages(BASE_LOCALE));
	});
});
