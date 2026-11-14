/**
 * policy.ts — manifest gate config → AcceptPolicy (P-074 phase 4,
 * contribution-owned decoding by P-078).
 *
 * The auto-accept gate's config SHAPE is domain knowledge: it lives
 * in @ktb/eval-consultation (`decodeAutoAcceptConfig`,
 * POLICY_FIELDS, policyNumberError — evals/consultation/src/config.ts)
 * and is registered on the `eval.gate:auto-accept` contribution as
 * `validateConfig`, so `eval list`/`eval run` resolution validates
 * manifest configs against the same decoder this module consumes.
 * This file is the apps/eval adapter: it lifts the domain decoder's
 * `Result` failures into `UsageError` (exit 2) and keeps the
 * GATE_DECODERS dispatch table — the ONLY place manifest gate ids
 * become runnable policies.
 */

import * as Result from "effect/Result";

import {
	decodeAutoAcceptConfig,
	policyNumberError,
	type AcceptPolicy,
} from "@ktb/eval-consultation";

import { UsageError } from "./errors.ts";

// Re-exported for commands/gate.ts CLI-flag overrides and tests —
// the range rules are the domain's, this is just the import site.
export { policyNumberError };

/** Decode `auto-accept` gate config into an AcceptPolicy. The
 * domain decoder owns validation (unknown keys rejected, ranges
 * checked); failures surface as UsageError so `eval gate` exits 2 —
 * a malformed gate config is a usage error, never a silently-relaxed
 * gate. */
export const decodeAcceptPolicy = (params: unknown, gateId = "auto-accept"): AcceptPolicy => {
	const r = decodeAutoAcceptConfig(params);
	if (Result.isFailure(r)) {
		throw new UsageError({ message: `gate "${gateId}": ${r.failure}` });
	}
	return r.success;
};

/** Gate id → policy decoder. Only gates with a real implementation
 * belong here — an id the registry knows but this map doesn't is a
 * "declared but not runnable" error at gate time. */
export const GATE_DECODERS: Readonly<
	Record<string, (params: unknown, gateId: string) => AcceptPolicy>
> = {
	"auto-accept": decodeAcceptPolicy,
};
