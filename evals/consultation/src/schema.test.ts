import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { Sample, SampleResult } from "./schema.ts";

const decode = Schema.decodeUnknownSync(Sample);

const base = {
	id: "s1",
	datasetVersion: "v1",
	origin: "synthetic" as const,
	script: "x",
	scriptHash: "h",
	persona: {
		region: "southeast",
		ageBand: "adult",
		register: "formal",
		specialty: "general_practice",
	},
	gold: { validatedBy: "generator" },
};

describe("Sample schema", () => {
	it("decodes synthetic without provenance", () => {
		expect(decode(base).id).toBe("s1");
	});

	it("rejects real_anonymized without provenance", () => {
		expect(() => decode({ ...base, origin: "real_anonymized" })).toThrowError(/provenance/);
		expect(() =>
			decode({ ...base, origin: "real_anonymized", provenance: { consentRef: "c" } }),
		).toThrowError(/provenance/);
	});

	it("rejects real_anonymized without an LGPD legal basis", () => {
		expect(() =>
			decode({
				...base,
				origin: "real_anonymized",
				provenance: {
					sourcePartner: "clinica-x",
					anonymizationMethod: "redaction-v1",
					consentRef: "c-123",
				},
			}),
		).toThrowError(/lgpdBasis/);
	});

	it("accepts real_anonymized with full provenance", () => {
		const s = decode({
			...base,
			origin: "real_anonymized",
			provenance: {
				sourcePartner: "clinica-x",
				anonymizationMethod: "redaction-v1",
				consentRef: "c-123",
				lgpdBasis: "consentimento",
			},
		});
		expect(s.provenance?.sourcePartner).toBe("clinica-x");
	});

	it("decodes unknown origin without provenance (untrusted, not gated like real)", () => {
		const s = decode({ ...base, origin: "unknown" });
		expect(s.origin).toBe("unknown");
	});

	it("rejects empty-string provenance values", () => {
		expect(() =>
			decode({
				...base,
				origin: "real_anonymized",
				provenance: {
					sourcePartner: "",
					anonymizationMethod: "redaction-v1",
					consentRef: "c-123",
					lgpdBasis: "consentimento",
				},
			}),
		).toThrowError(/sourcePartner/);
	});
});

describe("SampleResult schema", () => {
	it("decodes a minimal result row", () => {
		const r = Schema.decodeUnknownSync(SampleResult)({
			runId: "r",
			sampleId: "s",
			asrText: "t",
			editVerdicts: [],
			confSegments: [],
			createdAt: 0,
		});
		expect(r.runId).toBe("r");
	});
});
