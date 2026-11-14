/**
 * contributions.ts — the composition root's contribution graph
 * (P-070, domain packs by P-075).
 *
 * The CLI cannot use import.meta.glob, so the eval plugin packages'
 * `plugins` manifests are imported explicitly, dep-ordered with the
 * shared `orderPlugins`, and their `contributions` entries — the
 * `eval.*` kinds declared in @ktb/eval-core/kinds — are collected into
 * one ContributionRegistry. Domain packs under evals/ are NOT plugins:
 * they export their contribution declarations as a plain array
 * (`consultContributions`) which is appended here directly.
 * `list` resolves manifest refs against this; commands resolve the
 * adapter key per capability from the profile.
 *
 * Kinds are opt-in: EVAL_CONTRIBUTION_KINDS is the set this consumer
 * knows; an entry of any other kind on an eval manifest is a
 * packaging bug and throws rather than silently registering under a
 * foreign kind.
 */

import { orderPlugins } from "@ktb/driver-framework";
import type { Plugin } from "@ktb/kernel";
import {
	ContributionRegistry,
	isEvalContributionKind,
	toEvalContribution,
	type Contribution,
} from "@ktb/eval-core";
import { consultContributions } from "@ktb/eval-consultation";
import { plugins as llmEvalPlugins } from "@ktb/llm-eval";
import { plugins as storageDatasetPlugins } from "@ktb/storage-dataset";
import { plugins as asrPlugins } from "@ktb/transcription-asr";
import { plugins as ttsPlugins } from "@ktb/transcription-tts";

/** The eval plugin graph — explicit imports replace import.meta.glob
 * (unavailable outside Vite), dep-ordered by the shared kernel-level
 * sorter so requiredDeps/optionalDeps keep working for eval packs.
 * Capability plugins only: domain packs (evals/<domain>/) are plain
 * packages, not plugins (P-075). */
export const evalPlugins = orderPlugins([
	...ttsPlugins,
	...asrPlugins,
	...llmEvalPlugins,
	...storageDatasetPlugins,
]);

/**
 * Collect every `eval.*` contribution off an ordered plugin graph, in
 * plugin topo order then manifest declaration order. Entries of kinds
 * this consumer does not know throw — a manifest declaring a foreign
 * kind is a packaging bug, not something to paper over.
 */
export const collectEvalContributions = (plugins: readonly Plugin[]): readonly Contribution[] =>
	plugins.flatMap((plugin) =>
		(plugin.contributions ?? []).map((entry) => {
			if (!isEvalContributionKind(entry.kind)) {
				throw new Error(
					`plugin "${plugin.id}" declares unregistered contribution kind "${entry.kind}"`,
				);
			}
			// The kind guard passed — toEvalContribution only returns
			// undefined for foreign kinds (already rejected above) and
			// throws on a missing version.
			return toEvalContribution(entry)!;
		}),
	);

/** Every contribution the eval CLI knows about — domain metrics/gates
 * come from the domain packs' plain contribution arrays
 * (`consultContributions`); stages and capabilities from the
 * capability plugins. Domain contributions come last, matching the
 * order the dissolved eval.consult plugin occupied. */
export const ALL_CONTRIBUTIONS: readonly Contribution[] = [
	...collectEvalContributions(evalPlugins),
	...consultContributions,
];

/** Fresh registry with all contributions registered. Throws
 * DuplicateContributionError if two sources ever claim the same
 * kind+id — that is a packaging bug, not something to paper over. */
export const buildRegistry = (): ContributionRegistry => {
	const registry = new ContributionRegistry();
	for (const c of ALL_CONTRIBUTIONS) registry.register(c);
	return registry;
};
