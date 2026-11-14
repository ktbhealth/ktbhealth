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
import { UsageError } from "./errors.ts";

/** AcceptPolicy field names — the only keys a manifest gate's
 * `params` object may carry (CLI flag overrides map 1:1 onto these
 * fields in commands/gate.ts). */
const POLICY_FIELDS = [
	"stage",
	"maxWer",
	"target",
	"minN",
	"maxRisk",
	"maxHarmfulEdits",
	"maxUnjudgedEdits",
	"z",
] as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Range rules for every numeric AcceptPolicy field — shared by
 * manifest params (decodeAcceptPolicy) and CLI flag overrides
 * (commands/gate.ts applyOverrides). A gate that out-of-range numbers
 * can weaken (negative z collapsing the Wilson bound, target > 1,
 * negative error budgets) is not a gate: every entry point rejects
 * them as usage errors. */
export const policyNumberError = (field: string, v: number): string | null => {
	switch (field) {
		case "target":
			return v >= 0 && v <= 1 ? null : "must be in [0, 1]";
		case "minN":
			return Number.isInteger(v) && v >= 0 ? null : "must be an integer >= 0";
		case "z":
			// z <= 0 degenerates the Wilson lower bound — it would
			// silently weaken the precision gate, so it must be > 0.
			return v > 0 ? null : "must be > 0";
		case "maxWer":
		case "maxRisk":
		case "maxHarmfulEdits":
		case "maxUnjudgedEdits":
			return v >= 0 ? null : "must be >= 0";
		default:
			return null;
	}
};

const num = (params: Record<string, unknown>, key: string, def: number, gateId: string): number => {
	const v = params[key] ?? def;
	if (typeof v !== "number" || !Number.isFinite(v)) {
		throw new UsageError({ message: `gate "${gateId}": params.${key} must be a finite number` });
	}
	return v;
};

/** num() + range rule — the decoded value or a UsageError. */
const ranged = (
	params: Record<string, unknown>,
	key: string,
	def: number,
	gateId: string,
): number => {
	const v = num(params, key, def, gateId);
	const err = policyNumberError(key, v);
	if (err !== null) {
		throw new UsageError({ message: `gate "${gateId}": params.${key} ${err}` });
	}
	return v;
};

/** Decode `auto-accept` gate params into an AcceptPolicy. Unknown
 * keys are rejected — a typo'd param must not silently no-op. */
export const decodeAcceptPolicy = (params: unknown, gateId = "auto-accept"): AcceptPolicy => {
	if (params !== undefined && !isRecord(params)) {
		throw new UsageError({ message: `gate "${gateId}": params must be a JSON object` });
	}
	const p = (params ?? {}) as Record<string, unknown>;
	for (const [key, v] of Object.entries(p)) {
		if (!(POLICY_FIELDS as readonly string[]).includes(key)) {
			throw new UsageError({
				message: `gate "${gateId}": unknown params key "${key}" (known: ${POLICY_FIELDS.join(", ")})`,
			});
		}
		// Explicit JSON null is NOT "absent" — `?? default` would
		// silently substitute the default and weaken the gate. A null
		// param is malformed data: reject it.
		if (v === null) {
			throw new UsageError({ message: `gate "${gateId}": params.${key} must not be null` });
		}
	}
	const stage = p.stage ?? "corrected";
	if (stage !== "asr" && stage !== "corrected") {
		throw new UsageError({
			message: `gate "${gateId}": params.stage must be "asr" or "corrected"`,
		});
	}
	const minN = ranged(p, "minN", 40, gateId);
	const z = p.z;
	if (z !== undefined && (typeof z !== "number" || !Number.isFinite(z))) {
		throw new UsageError({ message: `gate "${gateId}": params.z must be a finite number` });
	}
	if (z !== undefined) {
		const err = policyNumberError("z", z as number);
		if (err !== null) {
			throw new UsageError({ message: `gate "${gateId}": params.z ${err}` });
		}
	}
	return {
		stage,
		maxWer: ranged(p, "maxWer", 0.05, gateId),
		target: ranged(p, "target", 0.9, gateId),
		minN,
		maxRisk: ranged(p, "maxRisk", 0, gateId),
		maxHarmfulEdits: ranged(p, "maxHarmfulEdits", 0, gateId),
		maxUnjudgedEdits: ranged(p, "maxUnjudgedEdits", 0, gateId),
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
