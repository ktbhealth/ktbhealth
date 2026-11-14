/**
 * resolve.ts — manifest → contribution/adapter resolution (P-074
 * phase 4).
 *
 * A suite manifest references stages/metrics/gates/capabilities BY
 * ID. Resolution answers these questions without wiring anything:
 *
 *   1. Does a registered contribution exist for each ref?
 *   2. For each capability, which adapter key does the selected
 *      profile resolve to — and does that adapter exist in the
 *      contribution's `meta.adapters` map?
 *   3. (P-078) Do entry `config` objects pass the contribution's
 *      declared `validateConfig`, and do `preset` gate refs expand
 *      against registered `eval.gatepreset` contributions?
 *
 * `list` prints the result; commands fail fast on refs they cannot
 * wire. Pure data in, pure data out — no Effect, no fs.
 */

import {
	buildStagePlan,
	refConfigOf,
	refIdOf,
	stageNodesOf,
	StageGraphError,
	type ContributionKind,
	type ContributionRegistry,
	type EvalSuiteManifest,
} from "@ktb/eval-core";

import { expandGates, type ExpandedGate } from "./presets.ts";

interface UnresolvedRef {
	readonly kind: ContributionKind;
	readonly id: string;
	readonly reason: string;
}

interface ResolvedRef {
	readonly kind: ContributionKind;
	readonly id: string;
}

/** A contribution config that failed its declared validator
 * (P-078) — distinct from `unresolved` (missing contributions): the
 * ref EXISTS, its config is malformed. Commands fail on these;
 * `eval list` prints them and counts them toward --strict. */
interface ConfigErrorRef {
	readonly kind: ContributionKind;
	readonly id: string;
	readonly error: string;
}

export interface SuiteResolution {
	readonly resolved: readonly ResolvedRef[];
	readonly unresolved: readonly UnresolvedRef[];
	/** capability id → adapter key chosen for the profile (absent
	 * when the capability or its adapter is unresolved). */
	readonly adapters: Readonly<Record<string, string>>;
	/** Stage-graph validation failure (P-077) — duplicate ids,
	 * unknown/self needs, or a cycle. Absent when the manifest's
	 * `stages` form a valid DAG. */
	readonly dagError?: string;
	/** Concrete gate invocations after preset expansion (P-078) —
	 * `id` entries normalized (`params`→`config`) plus every gate a
	 * referenced `eval.gatepreset` declares, with `overrides`
	 * merged. Commands consume THIS list, never `manifest.gates`
	 * raw. */
	readonly gates: readonly ExpandedGate[];
	/** Config objects that failed their contribution's declared
	 * `validateConfig` (P-078). */
	readonly configErrors: readonly ConfigErrorRef[];
}

/**
 * Adapter profiles — which `meta.adapters` key each capability uses.
 * Capability plugins declare the keys; this table is the composition
 * root's profile → key policy:
 *
 *   stub            — deterministic in-process adapters (CI/dev, zero cost)
 *   local           — on-box services: edge-tts, faster-whisper, ACP agent,
 *                     Jev decision service, sqlite/jsonl persistence
 *   local-systemone — same as `local` but the eval judge is a
 *                     self-hosted System One server (OpenJev `wev
 *                     serve`, local-jev) via EVAL_SYSTEMONE_URL —
 *                     the `local` profile keeps `jev` so existing
 *                     setups are untouched
 *   cloud           — managed adapters that exist today: Workers AI ASR, R2
 *                     store. Partial by design — capabilities without a cloud
 *                     adapter stay unresolved and commands say so.
 */
const ADAPTER_PROFILES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	stub: {
		tts: "stub",
		asr: "stub",
		llm: "stub",
		eval: "stub",
		store: "stub",
		report: "stub",
		registry: "stub",
	},
	local: {
		tts: "edge-tts",
		asr: "faster-whisper",
		llm: "acp",
		eval: "jev",
		store: "sqlite-fs",
		report: "jsonl",
		registry: "sqlite-fs",
	},
	"local-systemone": {
		tts: "edge-tts",
		asr: "faster-whisper",
		llm: "acp",
		eval: "systemone",
		store: "sqlite-fs",
		report: "jsonl",
		registry: "sqlite-fs",
	},
	cloud: { asr: "workers-ai", store: "r2", report: "jsonl", registry: "r2" },
};

export const knownProfiles = (): readonly string[] => Object.keys(ADAPTER_PROFILES);

const metaAdapters = (meta: unknown): Record<string, string> => {
	const adapters = (meta as { adapters?: unknown } | undefined)?.adapters;
	return typeof adapters === "object" && adapters !== null
		? (adapters as Record<string, string>)
		: {};
};

/**
 * Resolve a manifest against the registry. `profile` selects the
 * adapter key per capability (manifest.adapterProfile is the
 * default); pass `undefined` to resolve contribution ids only.
 */
export const resolveSuite = (
	registry: ContributionRegistry,
	manifest: EvalSuiteManifest,
	profile?: string,
): SuiteResolution => {
	const resolved: ResolvedRef[] = [];
	const unresolved: UnresolvedRef[] = [];
	const configErrors: ConfigErrorRef[] = [];
	const adapters: Record<string, string> = {};
	let dagError: string | undefined;

	const check = (kind: ContributionKind, id: string): boolean => {
		if (registry.has(kind, id)) {
			resolved.push({ kind, id });
			return true;
		}
		unresolved.push({ kind, id, reason: "no registered contribution" });
		return false;
	};

	// Config validation (P-078): every ref's `config` runs through the
	// contribution's declared `validateConfig`. A contribution with
	// NO validator rejects any declared config — unverifiable config
	// is a manifest bug, never silently accepted. Validators also
	// run on absent config (`undefined`) so a contribution that
	// REQUIRES config is caught.
	const checkConfig = (kind: ContributionKind, id: string, config: unknown): void => {
		const validate = registry.configValidator(kind, id);
		if (validate === undefined) {
			if (config !== undefined) {
				configErrors.push({ kind, id, error: "no config validator declared" });
			}
			return;
		}
		const v = validate(config);
		if (!v.ok) {
			configErrors.push({ kind, id, error: v.error });
		}
	};

	// Stage entries are StageEntry = id string | StageNode — resolve
	// every node id plus each `when.condition` guard ref, then
	// validate the graph shape itself (P-077). Node `config` and
	// condition `params` validate against their contributions (P-078).
	for (const node of stageNodesOf(manifest.stages)) {
		// Config validation only when the contribution exists — a
		// missing ref is already `unresolved`; piling a config error
		// on top would double-report the same manifest bug.
		if (check("eval.stage", node.id)) checkConfig("eval.stage", node.id, node.config);
		if (node.when !== undefined) {
			if (check("eval.condition", node.when.condition)) {
				checkConfig("eval.condition", node.when.condition, node.when.params);
			}
		}
	}
	try {
		buildStagePlan(manifest.stages);
	} catch (e) {
		// buildStagePlan only throws StageGraphError by construction.
		const err = e as StageGraphError;
		dagError = err.detail !== undefined ? `${err.message} (${err.detail})` : err.message;
	}
	// Metric entries are string | {id, config} (P-078).
	for (const m of manifest.metrics) {
		const id = refIdOf(m);
		if (check("eval.metric", id)) checkConfig("eval.metric", id, refConfigOf(m));
	}
	// Gate entries expand presets first (P-078): `{preset}` refs
	// become concrete `{id, config}` invocations; expansion problems
	// surface as unresolved `eval.gatepreset` refs. Valid presets
	// still resolve as contributions for the list counts.
	const gateExpansion = expandGates(registry, manifest.gates);
	const badPresets = new Set(gateExpansion.problems.map((p) => p.preset));
	for (const g of manifest.gates) {
		if (g.preset !== undefined && !badPresets.has(g.preset)) {
			check("eval.gatepreset", g.preset);
		}
	}
	for (const p of gateExpansion.problems) {
		unresolved.push({ kind: "eval.gatepreset", id: p.preset, reason: p.reason });
	}
	for (const g of gateExpansion.gates) {
		if (check("eval.gate", g.id)) checkConfig("eval.gate", g.id, g.config);
	}

	const profileMap = profile === undefined ? undefined : ADAPTER_PROFILES[profile];
	for (const capId of Object.keys(manifest.caps)) {
		// The caps value (providing plugin id) is documentation for the
		// manifest reader — resolution keys off the capability id,
		// which is what contributions register.
		if (!check("eval.capability", capId)) continue;
		if (profile === undefined) continue;
		const key = profileMap?.[capId];
		if (key === undefined) {
			unresolved.push({
				kind: "eval.capability",
				id: capId,
				reason: `profile "${profile}" selects no adapter`,
			});
			continue;
		}
		const declared = metaAdapters(registry.get("eval.capability", capId).meta);
		if (declared[key] === undefined) {
			unresolved.push({
				kind: "eval.capability",
				id: capId,
				reason: `profile "${profile}" adapter "${key}" not declared`,
			});
			continue;
		}
		adapters[capId] = key;
	}

	return {
		resolved,
		unresolved,
		adapters,
		gates: gateExpansion.gates,
		configErrors,
		...(dagError !== undefined ? { dagError } : {}),
	};
};
