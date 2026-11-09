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
		expect(ageLabel("1984-03-05", "en", NOW)).toBe("42 years");
		expect(ageLabel("1984", "en", NOW)).toBe("~42 years");
		expect(ageLabel("2025-10-01", "en", NOW)).toBe("1 year");
		expect(ageLabel(null, "en", NOW)).toBeNull();
		expect(ageLabel("garbage", "en", NOW)).toBeNull();
	});

	it("joins whatever demographics are recorded", () => {
		expect(demographics({ gender: "male", birthDate: "1984-03-05" }, "en", NOW)).toBe(
			"Male · 42 years",
		);
		expect(demographics({ gender: null, birthDate: "1984-03-05" }, "en", NOW)).toBe("42 years");
		expect(demographics({ gender: null, birthDate: null }, "en", NOW)).toBe("");
	});

	it("localizes ages and sex", () => {
		expect(ageLabel("1984", "pt-BR", NOW)).toBe("~42 anos");
		expect(ageLabel("2025-10-01", "pt-BR", NOW)).toBe("1 ano");
		expect(demographics({ gender: "female", birthDate: "1984-03-05" }, "pt-BR", NOW)).toBe(
			"Feminino · 42 anos",
		);
	});
});
