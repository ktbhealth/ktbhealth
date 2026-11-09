import { describe, expect, it } from "vitest";

import {
	ageFromBirthDate,
	demographicContext,
	recordSummary,
	birthDateFromAge,
	countryName,
	COUNTRIES,
	formatBirthDate,
	formatCns,
	formatCpf,
	formatPostalCode,
	isValidCns,
	isValidCpf,
	parseFhirDate,
	validatePatient,
} from "./record.ts";

const NOW = new Date(2026, 10, 8); // 8 Nov 2026, local time

describe("identifiers", () => {
	it("validates CPF check digits", () => {
		expect(isValidCpf("529.982.247-25")).toBe(true);
		expect(isValidCpf("52998224725")).toBe(true);
		expect(isValidCpf("529.982.247-24")).toBe(false);
		expect(isValidCpf("529.982.247-15")).toBe(false);
		expect(isValidCpf("111.111.111-11")).toBe(false);
		expect(isValidCpf("123")).toBe(false);
	});

	it("validates CNS (definitive and provisional)", () => {
		expect(isValidCns("100000000000007")).toBe(true);
		expect(isValidCns("700 0000 0000 0005")).toBe(true);
		expect(isValidCns("100000000000008")).toBe(false);
		expect(isValidCns("300000000000007")).toBe(false);
		expect(isValidCns("1000")).toBe(false);
	});

	it("formats identifiers and postal codes", () => {
		expect(formatCpf("52998224725")).toBe("529.982.247-25");
		expect(formatCns("100000000000007")).toBe("100 0000 0000 0007");
		expect(formatPostalCode("01310100", "BR")).toBe("01310-100");
		expect(formatPostalCode("SW1A 1AA", "GB")).toBe("SW1A 1AA");
	});
});

describe("dates", () => {
	it("parses FHIR dates at every precision", () => {
		expect(parseFhirDate("1984")).toEqual({ year: 1984 });
		expect(parseFhirDate("1984-03")).toEqual({ year: 1984, month: 3 });
		expect(parseFhirDate("1984-03-05")).toEqual({ year: 1984, month: 3, day: 5 });
	});

	it("rejects malformed or impossible dates", () => {
		expect(parseFhirDate("05/03/1984")).toBeNull();
		expect(parseFhirDate("1984-13")).toBeNull();
		expect(parseFhirDate("1984-00")).toBeNull();
		expect(parseFhirDate("2023-02-29")).toBeNull();
		expect(parseFhirDate("1984-04-31")).toBeNull();
	});

	it("computes age from full and partial birth dates", () => {
		expect(ageFromBirthDate("1984-11-08", NOW)).toBe(42);
		expect(ageFromBirthDate("1984-11-09", NOW)).toBe(41);
		expect(ageFromBirthDate("1984-12-01", NOW)).toBe(41);
		expect(ageFromBirthDate("1984-10-31", NOW)).toBe(42);
		expect(ageFromBirthDate("1984-11", NOW)).toBe(42);
		expect(ageFromBirthDate("1984-12", NOW)).toBe(41);
		expect(ageFromBirthDate("1984", NOW)).toBe(42);
		expect(ageFromBirthDate("nope", NOW)).toBeNull();
		expect(ageFromBirthDate("1984")).toBe(new Date().getFullYear() - 1984);
	});

	it("round-trips a quick-registration age through a year-only birth date", () => {
		expect(birthDateFromAge(42, NOW)).toBe("1984");
		expect(ageFromBirthDate(birthDateFromAge(42, NOW), NOW)).toBe(42);
		expect(birthDateFromAge(0)).toBe(String(new Date().getFullYear()));
	});

	it("formats birth dates day-first", () => {
		expect(formatBirthDate("1984-03-05")).toBe("05/03/1984");
		expect(formatBirthDate("1984-03")).toBe("03/1984");
		expect(formatBirthDate("1984")).toBe("1984");
	});
});

describe("countries", () => {
	it("lists ISO 3166-1 alpha-2 codes with English names by default", () => {
		expect(COUNTRIES).toContain("BR");
		expect(COUNTRIES.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
		expect(countryName("BR")).toBe("Brazil");
	});

	it("names countries in the requested locale", () => {
		expect(countryName("DE", "pt-BR")).toBe("Alemanha");
		expect(countryName("DE", "pt-BR")).toBe("Alemanha"); // cached formatter
	});
});

describe("validatePatient", () => {
	const minimal = { name: "Ana Souza", birthDate: "1984-03-05" };

	it("accepts name + birth date and normalizes blanks to null", () => {
		const r = validatePatient({ ...minimal, socialName: "  ", phone: null }, NOW);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.fields.name).toBe("Ana Souza");
		expect(r.fields.socialName).toBeNull();
		expect(r.fields.phone).toBeNull();
		expect(r.fields.active).toBe(true);
	});

	it("keeps an explicit inactive flag", () => {
		const r = validatePatient({ ...minimal, active: false }, NOW);
		expect(r.ok && r.fields.active).toBe(false);
	});

	it("normalizes identifiers, codes and Brazilian address", () => {
		const r = validatePatient(
			{
				...minimal,
				cpf: "529.982.247-25",
				cns: "100 0000 0000 0007",
				country: "br",
				nationality: "pt",
				state: "sp",
				postalCode: "01310-100",
				gender: "female",
				maritalStatus: "M",
				raceColor: "03",
				preferredLanguage: "pt-BR",
				email: "ana@example.com",
				phone: "+55 (11) 98765-4321",
				emergencyContactPhone: "11 3333-4444",
			},
			NOW,
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.fields).toMatchObject({
			cpf: "52998224725",
			cns: "100000000000007",
			country: "BR",
			nationality: "PT",
			state: "SP",
			postalCode: "01310100",
		});
	});

	it("leaves foreign addresses free-form", () => {
		const r = validatePatient(
			{ ...minimal, country: "GB", state: "England", postalCode: "SW1A 1AA" },
			NOW,
		);
		expect(r.ok && r.fields.postalCode).toBe("SW1A 1AA");
		expect(r.ok && r.fields.state).toBe("England");
	});

	it("requires name and birth date", () => {
		const r = validatePatient({}, NOW);
		expect(r).toEqual({
			ok: false,
			errors: { name: "name_required", birthDate: "birth_date_required" },
		});
	});

	it("rejects invalid, ancient or future birth dates", () => {
		const err = (birthDate: string) => {
			const r = validatePatient({ name: "X", birthDate }, NOW);
			return r.ok ? null : r.errors.birthDate;
		};
		expect(err("1984-02-30")).toBe("invalid_date");
		expect(err("1850")).toBe("invalid_date");
		expect(err("2027-01-01")).toBe("future_date");
		expect(err("2026-11-08")).toBeNull();
	});

	it("reports every invalid field at once", () => {
		const r = validatePatient(
			{
				...minimal,
				name: "x".repeat(201),
				gender: "f",
				maritalStatus: "X",
				raceColor: "06",
				preferredLanguage: "xx",
				country: "BR",
				nationality: "ZZ",
				state: "XX",
				postalCode: "123",
				cpf: "123.456.789-00",
				cns: "123",
				email: "nope",
				phone: "123",
				emergencyContactPhone: "1".repeat(16),
			},
			NOW,
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(Object.keys(r.errors).sort()).toEqual(
			[
				"cns",
				"cpf",
				"email",
				"emergencyContactPhone",
				"gender",
				"maritalStatus",
				"name",
				"nationality",
				"phone",
				"postalCode",
				"preferredLanguage",
				"raceColor",
				"state",
			].sort(),
		);
	});

	it("validates the Brazilian CEP when the state is valid", () => {
		const r = validatePatient({ ...minimal, country: "BR", state: "RJ", postalCode: "123" }, NOW);
		expect(r.ok ? null : r.errors).toEqual({ postalCode: "invalid_cep" });
	});

	it("accepts a Brazilian address without state or CEP", () => {
		const r = validatePatient({ ...minimal, country: "BR", city: "Olinda" }, NOW);
		expect(r.ok && r.fields).toMatchObject({ country: "BR", state: null, postalCode: null });
	});

	it("rejects an unknown address country", () => {
		const r = validatePatient({ ...minimal, country: "XX" }, NOW);
		expect(r.ok ? null : r.errors.country).toBe("invalid_country");
	});

	it("defaults the clock to now", () => {
		expect(validatePatient(minimal).ok).toBe(true);
	});
});

describe("record summaries", () => {
	it("summarizes demographics and CPF for documents", () => {
		expect(
			recordSummary({ gender: "female", birthDate: "1984-03-05", cpf: "52998224725" }, "en", NOW),
		).toBe("Female · 42 years · CPF 529.982.247-25");
		expect(recordSummary({ gender: null, birthDate: null, cpf: "52998224725" }, "en", NOW)).toBe(
			"CPF 529.982.247-25",
		);
		expect(recordSummary({ gender: null, birthDate: null, cpf: null }, "en", NOW)).toBeNull();
	});

	it("builds drafter context with only the known keys", () => {
		expect(demographicContext({ gender: "male", birthDate: "1984" }, NOW)).toEqual({
			sex: "male",
			age: 42,
		});
		expect(demographicContext({ gender: null, birthDate: null }, NOW)).toEqual({});
		expect(demographicContext({ gender: null, birthDate: "garbage" }, NOW)).toEqual({});
	});
});
