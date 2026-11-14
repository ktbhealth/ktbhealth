/**
 * policy.ts — manifest gate params → AcceptPolicy (P-074 phase 4).
 *
 * `gates[].params` in a suite manifest is JSON data; this module is
 * the ONLY place that turns it into the typed policy accept.ts
 * consumes. Every numeric must be finite and `stage`/`minN` are
 * range-checked — same M9 rule as the CLI flags: a malformed gate
 * param is a hard error, never a silently-relaxed gate.
 */

import type { AcceptPolicy } from "@ktb/eval-consult";
import { UsageError } from "./args.ts";

/** Policy field → flag name, for CLI overrides. */
export const POLICY_FLAGS: Readonly<Record<string, string>> = {
	stage: "stage",
	maxWer: "max-wer",
	target: "target",
	minN: "min-n",
	maxRisk: "max-risk",
	maxHarmfulEdits: "max-harmful-edits",
	maxUnjudgedEdits: "max-unjudged-edits",
	z: "z",
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const num = (params: Record<string, unknown>, key: string, def: number, gateId: string): number => {
	const v = params[key] ?? def;
	if (typeof v !== "number" || !Number.isFinite(v)) {
		throw new UsageError(`gate "${gateId}": params.${key} must be a finite number`);
	}
	return v;
};

/** Decode `auto-accept` gate params into an AcceptPolicy. Unknown
 * keys are rejected — a typo'd param must not silently no-op. */
export const decodeAcceptPolicy = (params: unknown, gateId = "auto-accept"): AcceptPolicy => {
	if (params !== undefined && !isRecord(params)) {
		throw new UsageError(`gate "${gateId}": params must be a JSON object`);
	}
	const p = (params ?? {}) as Record<string, unknown>;
	for (const key of Object.keys(p)) {
		if (!(key in POLICY_FLAGS)) {
			throw new UsageError(
				`gate "${gateId}": unknown params key "${key}" (known: ${Object.keys(POLICY_FLAGS).join(", ")})`,
			);
		}
	}
	const stage = p.stage ?? "corrected";
	if (stage !== "asr" && stage !== "corrected") {
		throw new UsageError(`gate "${gateId}": params.stage must be "asr" or "corrected"`);
	}
	const minN = num(p, "minN", 40, gateId);
	if (!Number.isInteger(minN) || minN < 0) {
		throw new UsageError(`gate "${gateId}": params.minN must be an integer >= 0`);
	}
	const z = p.z;
	if (z !== undefined && (typeof z !== "number" || !Number.isFinite(z))) {
		throw new UsageError(`gate "${gateId}": params.z must be a finite number`);
	}
	return {
		stage,
		maxWer: num(p, "maxWer", 0.05, gateId),
		target: num(p, "target", 0.9, gateId),
		minN,
		maxRisk: num(p, "maxRisk", 0, gateId),
		maxHarmfulEdits: num(p, "maxHarmfulEdits", 0, gateId),
		maxUnjudgedEdits: num(p, "maxUnjudgedEdits", 0, gateId),
		...(z !== undefined ? { z: z as number } : {}),
	};
};

/** Gate id → policy decoder. Only gates with a real implementation
 * belong here — an id the registry knows but this map doesn't is a
 * "declared but not runnable" error at gate time. */
export const GATE_DECODERS: Readonly<
	Record<string, (params: unknown, gateId: string) => AcceptPolicy>
> = {
	"auto-accept": decodeAcceptPolicy,
};
