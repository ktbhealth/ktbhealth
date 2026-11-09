import { describe, expect, it } from "vitest";

import { ageLabel, demographics, displayName, initials } from "./-format.ts";

const NOW = new Date(2026, 10, 8);

describe("view formatting", () => {
	it("prefers the social name", () => {
		expect(displayName({ name: "João Pereira", socialName: "Joana" })).toBe("Joana");
		expect(displayName({ name: "João Pereira", socialName: null })).toBe("João Pereira");
	});

	it("builds initials from first and last names", () => {
		expect(initials("maria da silva")).toBe("MS");
		expect(initials("  Ana  ")).toBe("A");
	});

	it("labels exact, approximate, singular and unreadable ages", () => {
		expect(ageLabel("1984-03-05", NOW)).toBe("42 years");
		expect(ageLabel("1984", NOW)).toBe("~42 years");
		expect(ageLabel("2025-10-01", NOW)).toBe("1 year");
		expect(ageLabel(null, NOW)).toBeNull();
		expect(ageLabel("garbage", NOW)).toBeNull();
	});

	it("joins whatever demographics are recorded", () => {
		expect(demographics({ gender: "male", birthDate: "1984-03-05" }, NOW)).toBe("Male · 42 years");
		expect(demographics({ gender: null, birthDate: "1984-03-05" }, NOW)).toBe("42 years");
		expect(demographics({ gender: null, birthDate: null }, NOW)).toBe("");
	});
});
