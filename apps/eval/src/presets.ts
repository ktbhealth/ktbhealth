/**
 * presets.ts — gate preset expansion (P-078).
 *
 * A manifest `gates` entry is either an `id` invocation
 * (`{id, config?|params?}`) or a `preset` reference
 * (`{preset, overrides?}`) naming an `eval.gatepreset`
 * contribution. This module expands preset refs into concrete gate
 * invocations — pure data in, pure data out, no Effect.
 *
 * Expansion rules:
 *   - `id` entries pass through with `config` normalized
 *     (`config` wins over legacy `params`).
 *   - `preset` entries resolve the contribution's `meta.gates`
 *     (validated against eval-core's GatePresetPayload schema —
 *     unknown/malformed payloads are problems, never silently
 *     skipped) and emit one gate per declared ref.
 *   - `overrides` shallow-merges per gate id onto the preset's own
 *     config — the "reference a preset but tweak one knob" path.
 *     Override keys naming a gate the preset does not declare are
 *     problems (a typo'd override must not silently no-op).
 *
 * Problems are DATA (`PresetProblem[]`), not throws: resolve.ts
 * folds them into `unresolved` for `eval list`, commands/gate.ts
 * turns them into usage errors.
 */

import { Option, Schema } from "effect";
import type { JsonObject } from "effect/Schema";

import {
	GatePresetPayload,
	gateEntryConfig,
	type ContributionRegistry,
	type SuiteGateEntry,
} from "@ktb/eval-core";

/** One concrete gate invocation after preset expansion. `config` is
 * the merged JSON config (preset config + manifest overrides, or the
 * entry's own `config`/`params`); `preset` records the source preset
 * id for provenance when the gate came from one. */
export interface ExpandedGate {
	readonly id: string;
	readonly config?: JsonObject;
	readonly preset?: string;
}

/** A preset reference that could not expand — `preset` is the
 * manifest-declared id, `reason` is human-readable. */
interface PresetProblem {
	readonly preset: string;
	readonly reason: string;
}

export interface GateExpansion {
	readonly gates: readonly ExpandedGate[];
	readonly problems: readonly PresetProblem[];
}

const withConfig = (id: string, config: JsonObject | undefined, preset?: string): ExpandedGate => ({
	id,
	...(config !== undefined ? { config } : {}),
	...(preset !== undefined ? { preset } : {}),
});

export const expandGates = (
	registry: ContributionRegistry,
	entries: readonly SuiteGateEntry[],
): GateExpansion => {
	const gates: ExpandedGate[] = [];
	const problems: PresetProblem[] = [];
	const problem = (preset: string, reason: string) => problems.push({ preset, reason });

	for (const entry of entries) {
		if (entry.id !== undefined) {
			// `config` ?? `params` — the schema already rejected both
			// being set, so this is a pure legacy-normalization.
			gates.push(withConfig(entry.id, gateEntryConfig(entry)));
			continue;
		}
		// SuiteGateEntry's check guarantees `preset` is set whenever
		// `id` is absent.
		const presetId = entry.preset!;
		if (!registry.has("eval.gatepreset", presetId)) {
			problem(presetId, "no registered contribution");
			continue;
		}
		const meta = registry.get("eval.gatepreset", presetId).meta;
		const payload = Option.getOrNull(Schema.decodeUnknownOption(GatePresetPayload)(meta));
		if (payload === null) {
			problem(presetId, 'invalid preset declaration — meta must be {"gates": [{"id", "config"?}]}');
			continue;
		}
		const overrides = entry.overrides ?? {};
		const presetIds = new Set(payload.gates.map((g) => g.id));
		for (const key of Object.keys(overrides)) {
			if (!presetIds.has(key)) {
				problem(presetId, `overrides "${key}" — preset declares no such gate`);
			}
		}
		for (const ref of payload.gates) {
			const override = overrides[ref.id];
			const config =
				ref.config !== undefined || override !== undefined
					? ({ ...(ref.config ?? {}), ...(override ?? {}) } as JsonObject)
					: undefined;
			gates.push(withConfig(ref.id, config, presetId));
		}
	}
	return { gates, problems };
};
