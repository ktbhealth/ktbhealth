import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { audioEgressError, guardAsrPort, scrubAsrResult, untrustedOrigin } from "./phi.ts";
import { AsrPort, PortError } from "./ports.ts";
import type { AsrResult, RunRecord } from "./schema.ts";

const record: RunRecord = {
	runId: "r",
	taskId: "t",
	stage: "s",
	engine: "test",
	inputHash: "h",
	startedAt: 0,
};

const asr: AsrResult = {
	text: "paciente cpf 123.456.789-00 nega febre",
	language: "pt",
	segments: [{ t0: 0, t1: 1, text: "cpf 123.456.789-00" }],
};

describe("untrustedOrigin", () => {
	it("flags real_anonymized and unknown, not synthetic/undefined", () => {
		expect(untrustedOrigin("real_anonymized")).toBe(true);
		expect(untrustedOrigin("unknown")).toBe(true);
		expect(untrustedOrigin("synthetic")).toBe(false);
		expect(untrustedOrigin(undefined)).toBe(false);
	});
});

describe("audioEgressError", () => {
	it("allows local-only ports regardless of provenance", () => {
		expect(
			audioEgressError({ origin: "real_anonymized", blobMeta: null, egress: false }),
		).toBeNull();
	});

	it("allows verified-synthetic provenance on egress ports", () => {
		expect(
			audioEgressError({
				origin: "synthetic",
				blobMeta: { origin: "synthetic" },
				egress: true,
			}),
		).toBeNull();
	});

	it("allows the documented no-record bypass: synthetic + null meta", () => {
		expect(audioEgressError({ origin: "synthetic", blobMeta: null, egress: true })).toBeNull();
	});

	it("refuses real_anonymized on egress ports", () => {
		const err = audioEgressError({ origin: "real_anonymized", egress: true });
		expect(err).toBeInstanceOf(PortError);
		expect(err?.message).toContain("real_anonymized");
	});

	it("refuses unknown provenance on egress ports", () => {
		expect(audioEgressError({ origin: "unknown", egress: true })).toBeInstanceOf(PortError);
		expect(
			audioEgressError({ origin: "synthetic", blobMeta: { origin: "unknown" }, egress: true }),
		).toBeInstanceOf(PortError);
	});

	it("stored real_anonymized beats a synthetic declaration", () => {
		const err = audioEgressError({
			origin: "synthetic",
			blobMeta: { origin: "real_anonymized" },
			egress: true,
		});
		expect(err?.message).toContain("real_anonymized");
	});

	it("treats undeclared egress as egress-capable (fail closed)", () => {
		expect(audioEgressError({ origin: "real_anonymized" })).toBeInstanceOf(PortError);
		expect(audioEgressError({})).toBeInstanceOf(PortError);
	});
});

describe("guardAsrPort", () => {
	const mkAsr = (egress?: boolean) => {
		const seen: unknown[] = [];
		const service = AsrPort.of({
			...(egress !== undefined ? { egress } : {}),
			transcribe: (_audio, opts) =>
				Effect.sync(() => {
					seen.push(opts);
					return { asr, record };
				}),
		});
		return { service, seen };
	};

	it("delegates when provenance is verified-synthetic", async () => {
		const { service, seen } = mkAsr(true);
		const guarded = guardAsrPort(service);
		const r = await Effect.runPromise(
			guarded.transcribe({ uri: "u" }, { origin: "synthetic", blobMeta: { origin: "synthetic" } }),
		);
		expect(r.asr.text).toContain("cpf");
		expect(seen).toHaveLength(1);
	});

	it("fails before delegating on egress + untrusted provenance", async () => {
		const { service, seen } = mkAsr(true);
		const guarded = guardAsrPort(service);
		const err = await Effect.runPromise(
			guarded
				.transcribe({ uri: "u" }, { origin: "real_anonymized", blobMeta: null })
				.pipe(Effect.catchTag("PortError", (e) => Effect.succeed(e))),
		);
		expect(err).toBeInstanceOf(PortError);
		expect(seen).toHaveLength(0);
	});

	it("passes through local-only ports untouched", async () => {
		const { service, seen } = mkAsr(false);
		const guarded = guardAsrPort(service);
		await Effect.runPromise(guarded.transcribe({ uri: "u" }, { origin: "real_anonymized" }));
		expect(seen).toHaveLength(1);
	});

	it("preserves the egress declaration on the wrapped service", () => {
		const { service } = mkAsr(true);
		expect(guardAsrPort(service).egress).toBe(true);
		const { service: undeclared } = mkAsr();
		expect(guardAsrPort(undeclared).egress).toBeUndefined();
	});
});

describe("scrubAsrResult", () => {
	it("scrubs PHI from text and segment text", () => {
		const out = scrubAsrResult(asr);
		expect(out).not.toBeNull();
		expect(out?.text).toContain("[CPF]");
		expect(out?.text).not.toContain("123.456.789-00");
		expect(out?.segments[0]?.text).toContain("[CPF]");
		expect(out?.segments[0]?.text).not.toContain("123.456.789-00");
	});

	it("returns null on residual identifiers", () => {
		expect(scrubAsrResult({ ...asr, text: "registro 20240102030405 interno" })).toBeNull();
	});

	it("leaves clean text unchanged", () => {
		const clean: AsrResult = { text: "nega febre", segments: [] };
		expect(scrubAsrResult(clean)).toEqual(clean);
	});
});
