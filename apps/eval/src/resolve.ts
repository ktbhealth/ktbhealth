/**
 * resolve.ts — manifest → contribution/adapter resolution (P-074
 * phase 4).
 *
 * A suite manifest references stages/metrics/gates/capabilities BY
 * ID. Resolution answers two questions without wiring anything:
 *
 *   1. Does a registered contribution exist for each ref?
 *   2. For each capability, which adapter key does the selected
 *      profile resolve to — and does that adapter exist in the
 *      contribution's `meta.adapters` map?
 *
 * `list` prints the result; commands fail fast on refs they cannot
 * wire. Pure data in, pure data out — no Effect, no fs.
 */

import type { ContributionKind, ContributionRegistry, EvalSuiteManifest } from "@ktb/eval-core";

interface UnresolvedRef {
	readonly kind: ContributionKind;
	readonly id: string;
	readonly reason: string;
}

interface ResolvedRef {
	readonly kind: ContributionKind;
	readonly id: string;
}

export interface SuiteResolution {
	readonly resolved: readonly ResolvedRef[];
	readonly unresolved: readonly UnresolvedRef[];
	/** capability id → adapter key chosen for the profile (absent
	 * when the capability or its adapter is unresolved). */
	readonly adapters: Readonly<Record<string, string>>;
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
	stub: { tts: "stub", asr: "stub", llm: "stub", eval: "stub", store: "stub", report: "stub" },
	local: {
		tts: "edge-tts",
		asr: "faster-whisper",
		llm: "acp",
		eval: "jev",
		store: "sqlite-fs",
		report: "jsonl",
	},
	"local-systemone": {
		tts: "edge-tts",
		asr: "faster-whisper",
		llm: "acp",
		eval: "systemone",
		store: "sqlite-fs",
		report: "jsonl",
	},
	cloud: { asr: "workers-ai", store: "r2", report: "jsonl" },
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
	const adapters: Record<string, string> = {};

	const check = (kind: ContributionKind, id: string): boolean => {
		if (registry.has(kind, id)) {
			resolved.push({ kind, id });
			return true;
		}
		unresolved.push({ kind, id, reason: "no registered contribution" });
		return false;
	};

	for (const id of manifest.stages) check("eval.stage", id);
	for (const id of manifest.metrics) check("eval.metric", id);
	for (const g of manifest.gates) check("eval.gate", g.id);

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

	return { resolved, unresolved, adapters };
};
