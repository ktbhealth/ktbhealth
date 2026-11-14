import { describe, expect, it } from "vitest";

import { DEFAULT_MATRIX, expandPersonaMatrix, sampleMatrix } from "./personas.ts";

describe("expandPersonaMatrix", () => {
	it("cartesian product in stable order", () => {
		const cells = expandPersonaMatrix({
			regions: ["southeast", "northeast"],
			ageBands: ["adult"],
			registers: ["formal", "colloquial"],
			specialties: ["general_practice"],
		});
		expect(cells).toHaveLength(4);
		expect(cells[0]).toMatchObject({ region: "southeast", register: "formal" });
		expect(cells[1]).toMatchObject({ region: "southeast", register: "colloquial" });
		expect(cells[2]?.region).toBe("northeast");
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
