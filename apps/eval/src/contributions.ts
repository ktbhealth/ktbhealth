/**
 * contributions.ts — the composition root's explicit contribution
 * graph (P-074 phase 4).
 *
 * A Bun CLI cannot use import.meta.glob, so every capability plugin's
 * `*Contributions` array is imported by name and registered into one
 * ContributionRegistry. `list` resolves manifest refs against this;
 * commands resolve the adapter key per capability from the profile.
 */

import type { Contribution } from "@ktb/eval-core";
import { ContributionRegistry } from "@ktb/eval-core";
import { consultContributions } from "@ktb/eval-consult";
import { llmEvalContributions } from "@ktb/llm-eval";
import { storageDatasetContributions } from "@ktb/storage-dataset";
import { asrContributions } from "@ktb/transcription-asr";
import { ttsContributions } from "@ktb/transcription-tts";

/** Every contribution the eval CLI knows about, in registration
 * order. Domain metrics/gates come from eval.consult; stages and
 * capabilities from the capability plugins. */
export const ALL_CONTRIBUTIONS: readonly Contribution[] = [
	...ttsContributions,
	...asrContributions,
	...llmEvalContributions,
	...storageDatasetContributions,
	...consultContributions,
];

/** Fresh registry with all contributions registered. Throws
 * DuplicateContributionError if two plugins ever claim the same
 * kind+id — that is a packaging bug, not something to paper over. */
export const buildRegistry = (): ContributionRegistry => {
	const registry = new ContributionRegistry();
	for (const c of ALL_CONTRIBUTIONS) registry.register(c);
	return registry;
};
