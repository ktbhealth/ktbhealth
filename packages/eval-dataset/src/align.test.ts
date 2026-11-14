import { describe, expect, it } from "vitest";

import { alignEntities, droppedEntities } from "./align.ts";
import type { AsrSegment, GoldEntity } from "./schema.ts";

const segs: AsrSegment[] = [
	{ t0: 0, t1: 1, text: "o paciente nega febre", confidence: 0.9 },
	{ t0: 1, t1: 2, text: "e toma losartana 50 mg", confidence: 0.7 },
	{ t0: 2, t1: 3, text: "de 8 em 8 horas" },
];

const ents: GoldEntity[] = [
	{ category: "negation", value: "nega febre" },
	{ category: "medication", value: "losartana" },
	{ category: "medication", value: "dipirona" },
];

describe("alignEntities", () => {
	it("maps entities to their segment indexes + confidence", () => {
		const a = alignEntities(segs, ents);
		expect(a[0]?.matched).toBe(true);
		expect(a[0]?.segmentIndexes).toEqual([0]);
		expect(a[0]?.confidence).toBe(0.9);
		expect(a[1]?.confidence).toBe(0.7);
		expect(a[2]?.matched).toBe(false);
		expect(a[2]?.confidence).toBeUndefined();
	});

	it("matches through normalization (accents/case)", () => {
		const a = alignEntities(
			[{ t0: 0, t1: 1, text: "NEGA FEBRE" }],
			[{ category: "negation", value: "nega febre" }],
		);
		expect(a[0]?.matched).toBe(true);
	});

	it("picks max confidence when an entity spans segments", () => {
		const a = alignEntities(
			[
				{ t0: 0, t1: 1, text: "losartana", confidence: 0.5 },
				{ t0: 1, t1: 2, text: "losartana", confidence: 0.8 },
			],
			[{ category: "medication", value: "losartana" }],
		);
		expect(a[0]?.confidence).toBe(0.8);
		expect(a[0]?.segmentIndexes).toEqual([0, 1]);
	});

	it("a segment that normalizes to empty never matches", () => {
		const a = alignEntities(
			[{ t0: 0, t1: 1, text: "!!! --- ..." }],
			[{ category: "medication", value: "losartana" }],
		);
		expect(a[0]?.matched).toBe(false);
	});

	it("droppedEntities lists only unmatched", () => {
		const dropped = droppedEntities(alignEntities(segs, ents));
		expect(dropped).toEqual([{ category: "medication", value: "dipirona" }]);
	});
});
