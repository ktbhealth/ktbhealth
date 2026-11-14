import { describe, expect, it } from "vitest";

import {
	ContributionRegistry,
	DuplicateContributionError,
	UnknownContributionError,
	type Contribution,
} from "./registry.ts";

const stage = (id: string, version = "1.0.0"): Contribution => ({
	kind: "stage",
	id,
	version,
});

describe("ContributionRegistry", () => {
	it("registers and looks up by kind+id", () => {
		const r = new ContributionRegistry();
		const c = stage("asr", "2.0.0");
		r.register(c);
		expect(r.get("stage", "asr")).toBe(c);
		expect(r.has("stage", "asr")).toBe(true);
	});

	it("same id under different kinds does not collide", () => {
		const r = new ContributionRegistry();
		r.register(stage("wer"));
		r.register({ kind: "metric", id: "wer", version: "1.0.0" });
		expect(r.get("stage", "wer").kind).toBe("stage");
		expect(r.get("metric", "wer").kind).toBe("metric");
	});

	it("throws DuplicateContributionError on re-register", () => {
		const r = new ContributionRegistry();
		r.register(stage("asr"));
		expect(() => r.register(stage("asr", "9.9.9"))).toThrowError(DuplicateContributionError);
		expect(() => r.register(stage("asr", "9.9.9"))).toThrowError(
			expect.objectContaining({ kind: "stage", id: "asr", version: "9.9.9" }),
		);
	});

	it("throws UnknownContributionError on missing lookup", () => {
		const r = new ContributionRegistry();
		expect(() => r.get("gate", "nope")).toThrowError(UnknownContributionError);
		expect(() => r.get("gate", "nope")).toThrowError(
			expect.objectContaining({ kind: "gate", id: "nope" }),
		);
		expect(r.has("gate", "nope")).toBe(false);
	});

	it("list returns registration order, optionally filtered by kind", () => {
		const r = new ContributionRegistry();
		r.register(stage("asr"));
		r.register({ kind: "metric", id: "wer", version: "1" });
		r.register(stage("cleanup"));
		r.register({ kind: "capability", id: "asr.pt", version: "1", meta: { adapter: "whisper" } });
		expect(r.list().map((c) => `${c.kind}:${c.id}`)).toEqual([
			"stage:asr",
			"metric:wer",
			"stage:cleanup",
			"capability:asr.pt",
		]);
		expect(r.list("stage").map((c) => c.id)).toEqual(["asr", "cleanup"]);
		expect(r.list("gate")).toEqual([]);
	});
});
