import { describe, expect, it } from "vitest";

import { DEFAULT_MATRIX, expandPersonaMatrix, sampleMatrix } from "./personas.ts";

describe("expandPersonaMatrix", () => {
	it("cartesian product in stable order", () => {
		const cells = expandPersonaMatrix({
			regions: ["se", "ne"],
			ageBands: ["adulto"],
			registers: ["formal", "colloquial"],
			specialties: ["clinico"],
		});
		expect(cells).toHaveLength(4);
		expect(cells[0]).toMatchObject({ region: "se", register: "formal" });
		expect(cells[1]).toMatchObject({ region: "se", register: "colloquial" });
		expect(cells[2]?.region).toBe("ne");
	});

	it("default matrix covers the diversity axes", () => {
		const cells = expandPersonaMatrix(DEFAULT_MATRIX);
		expect(cells).toHaveLength(5 * 3 * 2 * 6);
		expect(new Set(cells.map((c) => c.region)).size).toBe(5);
	});
});

describe("sampleMatrix", () => {
	it("deterministic sub-sample", () => {
		const a = sampleMatrix(DEFAULT_MATRIX, 5);
		const b = sampleMatrix(DEFAULT_MATRIX, 5);
		expect(a).toEqual(b);
		expect(a.length).toBe(Math.ceil(expandPersonaMatrix(DEFAULT_MATRIX).length / 5));
	});

	it("step 0 clamps to 1 (full matrix)", () => {
		expect(sampleMatrix(DEFAULT_MATRIX, 0)).toHaveLength(
			expandPersonaMatrix(DEFAULT_MATRIX).length,
		);
	});
});
