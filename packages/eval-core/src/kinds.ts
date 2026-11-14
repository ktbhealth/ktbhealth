import type { ContributionKindDescriptor, PluginContribution } from "@ktb/kernel";

import type { Contribution, ContributionKind } from "./registry.ts";

/**
 * kinds.ts — the eval domain's contribution-kind descriptors (P-070).
 *
 * These register the `eval.*` kinds on the generalized plugin
 * contribution channel: every entry is a `PluginContribution` carried
 * in a plugin manifest's `contributions` array, and `slot` is
 * GENERIC_CONTRIBUTION_SLOT ("contributions") for all of them. The
 * payload type is eval-core's `Contribution` — `{kind, id, version,
 * meta}` — validated by `toEvalContribution` when a consumer collects
 * entries from the plugin graph.
 *
 * Consumers: `eval-cli` (apps/eval) is the only surface that resolves
 * suite refs today; a future in-app eval runner would list itself in
 * `consumers` and collect the same kinds.
 */

const evalKind = (id: ContributionKind): ContributionKindDescriptor => ({
	id,
	slot: "contributions",
	consumers: ["eval-cli"],
	// Registration/declaration order is the contract — suites reference
	// contributions by id, so intra-kind order carries no meaning beyond
	// deterministic listing.
	ordering: "declared",
});

/** All eval contribution kinds, in canonical order. */
export const EVAL_CONTRIBUTION_KINDS: readonly ContributionKindDescriptor[] = [
	evalKind("eval.stage"),
	evalKind("eval.metric"),
	evalKind("eval.gate"),
	evalKind("eval.condition"),
	evalKind("eval.capability"),
];

const EVAL_KIND_IDS: ReadonlySet<string> = new Set(EVAL_CONTRIBUTION_KINDS.map((k) => k.id));

/** Whether `kind` is one of the registered eval contribution kinds. */
export const isEvalContributionKind = (kind: string): kind is ContributionKind =>
	EVAL_KIND_IDS.has(kind);

/**
 * Narrow a collected `PluginContribution` payload to eval-core's
 * `Contribution`. Returns `undefined` for entries of other kinds —
 * consumers filtering by `EVAL_CONTRIBUTION_KINDS` never see them, so
 * this is the type-level bridge, not a validation boundary. `version`
 * is required by the eval contract: entries missing it are a packaging
 * bug and throw rather than silently default.
 */
export const toEvalContribution = (entry: PluginContribution): Contribution | undefined => {
	if (!isEvalContributionKind(entry.kind)) return undefined;
	if (entry.version === undefined) {
		throw new Error(`eval contribution "${entry.kind}:${entry.id}" is missing a version`);
	}
	return { kind: entry.kind, id: entry.id, version: entry.version, meta: entry.meta };
};
