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
					{
						id: "judge",
						needs: [],
						when: { condition: "nonempty", params: { key: "transcribe" } },
					},
					{ id: "extra", needs: [], when: { condition: "ghost-cond" } },
				],
			}),
		);
		const ids = res.resolved.map((r) => `${r.kind}:${r.id}`);
		expect(ids).toContain("eval.stage:transcribe");
		expect(ids).toContain("eval.stage:cleanup");
		expect(ids).toContain("eval.stage:judge");
		// "nonempty" is a builtin eval.condition contribution (P-078);
		// "ghost-cond" is not registered.
		expect(ids).toContain("eval.condition:nonempty");
		expect(res.unresolved).toContainEqual({
			kind: "eval.condition",
			id: "ghost-cond",
			reason: "no registered contribution",
		});
		expect(res.dagError).toBeUndefined();
	});

	test("condition params validate against the contributed validator (P-078)", () => {
		// nonempty requires params.key — absent params is a config error.
		const res = resolveSuite(
			registry,
			manifest({
				stages: [{ id: "judge", when: { condition: "nonempty" } }],
			}),
		);
		expect(res.configErrors).toEqual([
			{
				kind: "eval.condition",
				id: "nonempty",
				error: 'condition param "key" must be a non-empty string',
			},
		]);
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

	test("metric entries accept {id, config} validated by the contribution (P-078)", () => {
		const ok = resolveSuite(
			registry,
			manifest({ metrics: ["wer", { id: "cer", config: { profile: "ptbr-v1" } }] }),
		);
		expect(ok.configErrors).toEqual([]);
		expect(ok.unresolved).toEqual([]);

		const bad = resolveSuite(
			registry,
			manifest({ metrics: [{ id: "wer", config: { bogus: 1 } }] }),
		);
		expect(bad.configErrors).toHaveLength(1);
		expect(bad.configErrors[0]).toMatchObject({ kind: "eval.metric", id: "wer" });
		expect(bad.configErrors[0]!.error).toContain("bogus");
	});

	test("config on a validator-less contribution is a config error", () => {
		// Capability-plugin stage contributions declare no
		// validateConfig — unverifiable config must not pass silently.
		const res = resolveSuite(
			registry,
			manifest({ stages: [{ id: "transcribe", config: { engine: "x" } }] }),
		);
		expect(res.configErrors).toEqual([
			{ kind: "eval.stage", id: "transcribe", error: "no config validator declared" },
		]);
	});

	test("gate config validates through the domain decoder; legacy params too (P-078)", () => {
		const ok = resolveSuite(
			registry,
			manifest({ gates: [{ id: "auto-accept", config: { target: 0.95, minN: 80 } }] }),
		);
		expect(ok.configErrors).toEqual([]);
		expect(ok.gates).toEqual([{ id: "auto-accept", config: { target: 0.95, minN: 80 } }]);

		// Legacy `params` normalize to config before validation.
		const legacy = resolveSuite(
			registry,
			manifest({ gates: [{ id: "auto-accept", params: { target: 0.95 } }] }),
		);
		expect(legacy.configErrors).toEqual([]);
		expect(legacy.gates).toEqual([{ id: "auto-accept", config: { target: 0.95 } }]);

		for (const gate of [
			{ id: "auto-accept", config: { target: 9 } },
			{ id: "auto-accept", params: { stage: "bogus" } },
		]) {
			const bad = resolveSuite(registry, manifest({ gates: [gate] }));
			expect(bad.configErrors).toHaveLength(1);
			expect(bad.configErrors[0]).toMatchObject({ kind: "eval.gate", id: "auto-accept" });
		}
	});

	test("gate presets expand to concrete gates; overrides merge per gate id (P-078)", () => {
		const res = resolveSuite(
			registry,
			manifest({
				gates: [
					{ preset: "consult.strict" },
					{ preset: "consult.standard", overrides: { "auto-accept": { minN: 80 } } },
				],
			}),
		);
		expect(res.unresolved).toEqual([]);
		expect(res.configErrors).toEqual([]);
		expect(res.gates).toEqual([
			{
				id: "auto-accept",
				config: {
					stage: "corrected",
					maxWer: 0.02,
					target: 0.95,
					minN: 40,
					maxRisk: 0,
					maxHarmfulEdits: 0,
					maxUnjudgedEdits: 0,
				},
				preset: "consult.strict",
			},
			{
				id: "auto-accept",
				config: {
					stage: "corrected",
					maxWer: 0.05,
					target: 0.9,
					minN: 80,
					maxRisk: 0,
					maxHarmfulEdits: 0,
					maxUnjudgedEdits: 0,
				},
				preset: "consult.standard",
			},
		]);
		expect(res.resolved.map((r) => `${r.kind}:${r.id}`)).toEqual(
			expect.arrayContaining([
				"eval.gatepreset:consult.strict",
				"eval.gatepreset:consult.standard",
				"eval.gate:auto-accept",
			]),
		);
	});

	test("unknown and malformed presets surface as unresolved gatepreset refs", () => {
		const missing = resolveSuite(registry, manifest({ gates: [{ preset: "ghost" }] }));
		expect(missing.unresolved).toContainEqual({
			kind: "eval.gatepreset",
			id: "ghost",
			reason: "no registered contribution",
		});
		expect(missing.gates).toEqual([]);

		// A registered preset with a malformed meta.gates payload.
		const reg = new ContributionRegistry();
		reg.register({
			kind: "eval.gatepreset",
			id: "bad-payload",
			version: "1",
			meta: { gates: "nope" },
		});
		const badPayload = resolveSuite(
			reg,
			defineSuite({
				id: "s",
				domain: "d",
				dataset: { id: "d", version: "1" },
				stages: [],
				caps: {},
				metrics: [],
				gates: [{ preset: "bad-payload" }],
				schemaVersion: 1,
			}),
		);
		expect(badPayload.unresolved).toContainEqual({
			kind: "eval.gatepreset",
			id: "bad-payload",
			reason: expect.stringContaining("invalid preset declaration"),
		});

		// Override keys must name gates the preset declares.
		const badOverride = resolveSuite(
			registry,
			manifest({
				gates: [{ preset: "consult.strict", overrides: { "ghost-gate": {} } }],
			}),
		);
		expect(badOverride.unresolved).toContainEqual({
			kind: "eval.gatepreset",
			id: "consult.strict",
			reason: 'overrides "ghost-gate" — preset declares no such gate',
		});
		// The preset's own gates still expand — the bad override is
		// reported, not fatal to the rest of the expansion.
		expect(badOverride.gates.map((g) => g.id)).toEqual(["auto-accept"]);
	});

	test("preset gates without config merge overrides or stay config-less", () => {
		const reg = new ContributionRegistry();
		reg.register({
			kind: "eval.gatepreset",
			id: "bare",
			version: "1",
			meta: { gates: [{ id: "auto-accept" }, { id: "other", config: { a: 1 } }] },
		});
		reg.register({
			kind: "eval.gate",
			id: "auto-accept",
			version: "1",
			validateConfig: () => ({ ok: true, config: {} }),
		});
		reg.register({
			kind: "eval.gate",
			id: "other",
			version: "1",
			validateConfig: () => ({ ok: true, config: {} }),
		});
		const res = resolveSuite(
			reg,
			defineSuite({
				id: "s",
				domain: "d",
				dataset: { id: "d", version: "1" },
				stages: [],
				caps: {},
				metrics: [],
				gates: [{ preset: "bare" }, { preset: "bare", overrides: { "auto-accept": { minN: 7 } } }],
				schemaVersion: 1,
			}),
		);
		expect(res.unresolved).toEqual([]);
		expect(res.gates).toEqual([
			// No config anywhere → ExpandedGate carries none.
			{ id: "auto-accept", preset: "bare" },
			{ id: "other", config: { a: 1 }, preset: "bare" },
			// Override alone becomes the whole config.
			{ id: "auto-accept", config: { minN: 7 }, preset: "bare" },
			{ id: "other", config: { a: 1 }, preset: "bare" },
		]);
	});

	test("a preset gate id with no registered gate contribution is unresolved", () => {
		const reg = new ContributionRegistry();
		reg.register({
			kind: "eval.gatepreset",
			id: "p",
			version: "1",
			meta: { gates: [{ id: "ghost-gate", config: {} }] },
		});
		const res = resolveSuite(
			reg,
			defineSuite({
				id: "s",
				domain: "d",
				dataset: { id: "d", version: "1" },
				stages: [],
				caps: {},
				metrics: [],
				gates: [{ preset: "p" }],
				schemaVersion: 1,
			}),
		);
		expect(res.unresolved).toContainEqual({
			kind: "eval.gate",
			id: "ghost-gate",
			reason: "no registered contribution",
		});
	});
});
