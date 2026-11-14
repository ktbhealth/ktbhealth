import { definePlugin, type Plugin } from "@ktb/kernel";
import type { Contribution } from "@ktb/eval-core";
import { TtsPort } from "@ktb/eval-consult/ports";

/**
 * transcription.tts — TTS capability plugin (P-074 phase 3).
 *
 * Capability plugins are DATA-ONLY registrars: they declare which
 * eval-core contributions (stage/capability) they provide and which
 * adapter keys implement the port, but they contain NO adapter code.
 * plugins/* sits inside the arch-policy PORT_GLOBS — node:*,
 * process/Bun/Deno, provider literals and adapter-package imports are
 * all banned there — so implementations live in the adapter packages
 * (@ktb/eval-dataset-stub/-local/-cloud), which are the exempt edge.
 *
 * Consumption (Phase 4): the eval composition root iterates
 * `ttsContributions`, registers each entry into a
 * `ContributionRegistry` (`registry.register(c)`), and resolves
 * `meta.adapters[key]` to the layer factory exported by that package
 * for `meta.port`. `TtsPort.key` pins the port tag so a renamed port
 * fails typecheck here, not silently at runtime.
 */
export const ttsPlugin = definePlugin({
	id: "transcription.tts",
});

export const plugins: readonly Plugin[] = [ttsPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"transcription.tts": true;
	}
}

/**
 * Declared contributions. `capability` entries name the port and the
 * adapter keys that implement it; `stage` entries name the pipeline
 * stage the capability serves (RunRecord.stage vocabulary). Adapter
 * keys → packages: "stub" → @ktb/eval-dataset-stub TtsPort layer,
 * "edge-tts" → @ktb/eval-dataset-local `makeLocalTts`.
 */
export const ttsContributions: readonly Contribution[] = [
	{
		kind: "capability",
		id: "tts",
		version: "1",
		meta: {
			port: TtsPort.key,
			adapters: {
				stub: "@ktb/eval-dataset-stub",
				"edge-tts": "@ktb/eval-dataset-local",
			},
		},
	},
	{
		kind: "stage",
		id: "synthesize",
		version: "1",
		meta: { port: TtsPort.key },
	},
];
