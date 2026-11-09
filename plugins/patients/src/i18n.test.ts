import { describe, expect, it } from "vitest";

import {
	BASE_LOCALE,
	isPatientLocale,
	PATIENT_LOCALES,
	patientMessages,
	type PatientErrorCode,
} from "./i18n.ts";
import { errorMessage, MAX_TEXT } from "./record.ts";

const CODES: PatientErrorCode[] = [
	"too_long",
	"name_required",
	"birth_date_required",
	"invalid_date",
	"future_date",
	"invalid_option",
	"invalid_country",
	"invalid_cpf",
	"invalid_cns",
	"invalid_email",
	"invalid_phone",
	"invalid_state",
	"invalid_cep",
];

/** Every string leaf of a catalog (functions are exercised separately). */
const leaves = (node: unknown): string[] =>
	typeof node === "string"
		? [node]
		: node && typeof node === "object"
			? Object.values(node).flatMap(leaves)
			: [];

describe("patient catalogs", () => {
	it("resolves known locales and falls back to the base locale", () => {
		expect(isPatientLocale("pt-BR")).toBe(true);
		expect(isPatientLocale("fr")).toBe(false);
		expect(patientMessages("fr")).toBe(patientMessages(BASE_LOCALE));
		expect(patientMessages("pt-BR").common.patients).toBe("Pacientes");
	});

	it("has no blank copy in any locale", () => {
		for (const locale of PATIENT_LOCALES) {
			expect(leaves(patientMessages(locale)).every((s) => s.trim() !== "")).toBe(true);
		}
	});

	it("pluralizes counts and ages", () => {
		const en = patientMessages("en");
		const pt = patientMessages("pt-BR");
		expect(en.list.count(1)).toBe("1 patient registered.");
		expect(en.list.count(3)).toBe("3 patients registered.");
		expect(pt.list.count(1)).toBe("1 paciente cadastrado.");
		expect(pt.list.count(3)).toBe("3 pacientes cadastrados.");
		expect(pt.age(1, false)).toBe("1 ano");
		expect(pt.age(42, true)).toBe("~42 anos");
	});

	it("interpolates the approximate birth date", () => {
		expect(patientMessages("pt-BR").form.approximate("1984")).toBe(
			"Registrado como 1984 (aproximado). Informe a data exata, se souber.",
		);
	});

	it("translates every validation code", () => {
		for (const locale of PATIENT_LOCALES) {
			for (const code of CODES) expect(errorMessage(code, locale)).not.toBe("");
		}
		expect(errorMessage("too_long")).toBe(`Must be at most ${MAX_TEXT} characters.`);
		expect(errorMessage("too_long", "pt-BR")).toBe(`Use no máximo ${MAX_TEXT} caracteres.`);
		expect(errorMessage("invalid_cpf", "pt-BR")).toBe("CPF inválido.");
	});
});
