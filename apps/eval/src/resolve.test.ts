import { describe, expect, test } from "vitest";

import { ContributionRegistry, defineSuite } from "@ktb/eval-core";

import { buildRegistry } from "./contributions.ts";
import { resolveSuite } from "./resolve.ts";

const manifest = (over: Record<string, unknown> = {}) =>
	defineSuite({
		id: "s",
		domain: "eval.consult",
		dataset: { id: "d", version: "v1" },
		stages: ["transcribe"],
		caps: { asr: "transcription.asr" },
		metrics: ["wer"],
		gates: [{ id: "auto-accept" }],
		schemaVersion: 1,
		...over,
	});

describe("resolveSuite", () => {
	const registry = buildRegistry();

	test("resolves ids without a profile (adapters empty)", () => {
		const res = resolveSuite(registry, manifest());
		expect(res.unresolved).toEqual([]);
		expect(res.adapters).toEqual({});
		expect(res.resolved.map((r) => `${r.kind}:${r.id}`)).toEqual([
			"eval.stage:transcribe",
			"eval.metric:wer",
			"eval.gate:auto-accept",
			"eval.capability:asr",
		]);
	});

	test("resolves adapter keys under a known profile", () => {
		const res = resolveSuite(registry, manifest(), "stub");
		expect(res.adapters).toEqual({ asr: "stub" });
		expect(res.unresolved).toEqual([]);
	});

	test("local-systemone profile swaps only the eval adapter", () => {
		const res = resolveSuite(registry, manifest({ caps: { eval: "llm.eval" } }), "local-systemone");
		expect(res.adapters).toEqual({ eval: "systemone" });
		expect(res.unresolved).toEqual([]);
	});

	test("unknown refs are unresolved with a reason", () => {
		const res = resolveSuite(
			registry,
			manifest({
				stages: ["transcribe", "bogus-stage"],
				metrics: ["nope"],
				gates: [{ id: "nope-gate" }],
				caps: { asr: "transcription.asr", ghost: "x" },
			}),
			"stub",
		);
		const ids = res.unresolved.map((u) => `${u.kind}:${u.id}`);
		expect(ids).toEqual([
			"eval.stage:bogus-stage",
			"eval.metric:nope",
			"eval.gate:nope-gate",
			"eval.capability:ghost",
		]);
		expect(res.unresolved[0]!.reason).toBe("no registered contribution");
		// Resolved caps still get their adapter.
		expect(res.adapters.asr).toBe("stub");
	});

	test("unknown profile selects no adapter for any capability", () => {
		const res = resolveSuite(registry, manifest(), "nope");
		expect(res.adapters).toEqual({});
		expect(res.unresolved).toContainEqual({
			kind: "eval.capability",
			id: "asr",
			reason: 'profile "nope" selects no adapter',
		});
	});

	test("profile key not declared by the contribution is unresolved", () => {
		// Fresh registry: capability "tts" is in the stub profile map
		// but declares NO adapters — the key lookup hits "not declared".
		const reg = new ContributionRegistry();
		reg.register({ kind: "eval.capability", id: "tts", version: "1", meta: { adapters: {} } });
		const res = resolveSuite(
			reg,
			defineSuite({
				id: "s",
				domain: "d",
				dataset: { id: "d", version: "1" },
				stages: [],
				caps: { tts: "p" },
				metrics: [],
				gates: [],
				schemaVersion: 1,
			}),
			"stub",
		);
		expect(res.unresolved).toContainEqual({
			kind: "eval.capability",
			id: "tts",
			reason: 'profile "stub" adapter "stub" not declared',
		});
	});

	test("DAG node entries resolve stage ids and when-conditions (P-077)", () => {
		const res = resolveSuite(
			registry,
			manifest({
				stages: [
					"transcribe",
					{ id: "cleanup", needs: ["transcribe"], optional: true },
					{ id: "judge", needs: [], when: { condition: "nonempty" } },
				],
			}),
		);
		const ids = res.resolved.map((r) => `${r.kind}:${r.id}`);
		expect(ids).toContain("eval.stage:transcribe");
		expect(ids).toContain("eval.stage:cleanup");
		expect(ids).toContain("eval.stage:judge");
		// "nonempty" is not a registered eval.condition contribution.
		expect(res.unresolved).toContainEqual({
			kind: "eval.condition",
			id: "nonempty",
			reason: "no registered contribution",
		});
		expect(res.dagError).toBeUndefined();
	});

	test("invalid stage graphs surface dagError", () => {
		const dup = resolveSuite(registry, manifest({ stages: ["transcribe", "transcribe"] }));
		expect(dup.dagError).toContain("duplicate stage id");
		const cyc = resolveSuite(
			registry,
			manifest({
				stages: [
					{ id: "a", needs: ["b"] },
					{ id: "b", needs: ["a"] },
				],
			}),
		);
		expect(cyc.dagError).toContain("dependency cycle");
		expect(cyc.dagError).toContain("stuck:");
	});

	test("malformed meta.adapters shapes all resolve to 'not declared'", () => {
		const reg = new ContributionRegistry();
		// No meta at all.
		reg.register({ kind: "eval.capability", id: "tts", version: "1" });
		// meta without adapters.
		reg.register({ kind: "eval.capability", id: "asr", version: "1", meta: {} });
		// adapters: null.
		reg.register({ kind: "eval.capability", id: "llm", version: "1", meta: { adapters: null } });
		// adapters: non-object.
		reg.register({ kind: "eval.capability", id: "eval", version: "1", meta: { adapters: "x" } });
		const res = resolveSuite(
			reg,
			defineSuite({
				id: "s",
				domain: "d",
				dataset: { id: "d", version: "1" },
				stages: [],
				caps: { tts: "p", asr: "p", llm: "p", eval: "p" },
				metrics: [],
				gates: [],
				schemaVersion: 1,
			}),
			"stub",
		);
		expect(res.unresolved).toHaveLength(4);
		for (const u of res.unresolved) {
			expect(u.reason).toBe('profile "stub" adapter "stub" not declared');
		}
	});
});
