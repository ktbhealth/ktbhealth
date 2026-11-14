import { describe, expect, it } from "vitest";

import { anonymize, gateTranscript } from "./anonymize.ts";

describe("anonymize", () => {
	it("scrubs CPF in both formats and counts redactions", () => {
		const out = anonymize("CPF 123.456.789-00 e também 12345678900 no prontuário");
		expect(out.scrubbed).toBe(true);
		expect(out.text).toContain("[CPF]");
		expect(out.text).not.toContain("12345678900");
		expect(out.redactions).toEqual([{ category: "cpf", count: 2 }]);
	});

	it("scrubs BR phones", () => {
		// A bare 11-digit run is CPF-shaped — use formatted phones so the
		// categories don't overlap.
		const out = anonymize("ligar para (11) 91234-5678 ou 91234-5678");
		expect(out.redactions).toEqual([{ category: "phone", count: 2 }]);
		expect(out.text).not.toMatch(/\d{4}-?\d{4}/);
	});

	it("scrubs emails", () => {
		const out = anonymize("email joao.silva@exemplo.com.br cadastrado");
		expect(out.redactions).toEqual([{ category: "email", count: 1 }]);
		expect(out.text).toContain("[EMAIL]");
	});

	it("scrubs date-of-birth phrasing in pt-BR", () => {
		const out = anonymize("paciente nascido em 12/03/1985, DN: 01-01-1970");
		expect(out.redactions).toEqual([{ category: "date_of_birth", count: 2 }]);
		expect(out.text).not.toContain("12/03/1985");
	});

	it("leaves clean clinical text untouched", () => {
		const text = "refere cefaleia há 3 dias, prescrevo dipirona 500mg";
		const out = anonymize(text);
		expect(out.text).toBe(text);
		expect(out.scrubbed).toBe(false);
		expect(out.redactions).toEqual([]);
	});

	it("never retains redacted values — audit is counts only", () => {
		const out = anonymize("cpf 111.222.333-44 tel 91234-5678");
		expect(JSON.stringify(out)).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
		expect(out.redactions.length).toBeGreaterThan(0);
	});
});

describe("gateTranscript", () => {
	it("admits clean text", () => {
		expect(gateTranscript("anamnese livre de identificadores")).not.toBeNull();
	});

	it("admits fully scrubbed text", () => {
		const g = gateTranscript("cpf 123.456.789-00");
		expect(g?.scrubbed).toBe(true);
	});

	it("rejects residual long digit runs — likely a document id", () => {
		// 10+ digits that no PHI pattern claims (cpf is exactly 11 digits —
		// use a 14-digit run that looks like a registration number).
		expect(gateTranscript("registro interno 20240102030405 do paciente")).toBeNull();
	});
});
