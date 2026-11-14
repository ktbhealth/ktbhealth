import { definePlugin, type Plugin } from "@ktb/kernel";
import type { Contribution } from "@ktb/eval-core";
import { TtsPort } from "@ktb/eval-consult/ports";

/**
 * transcription.tts — TTS capability plugin (P-074 phase 3, P-070).
 *
 * Capability plugins are DATA-ONLY registrars: they declare which
 * eval-core contributions (eval.stage/eval.capability kinds on the
 * manifest's `contributions` channel) they provide and which adapter
 * keys implement the port, but they contain NO adapter code.
 * plugins/* sits inside the arch-policy PORT_GLOBS — node:*,
 * process/Bun/Deno, provider literals and adapter-package imports are
 * all banned there — so implementations live in the adapter packages
 * (@ktb/eval-adapter-stub/-local/-cloud), which are the exempt edge.
 *
 * Consumption: the eval composition root (apps/eval) collects the
 * `contributions` entries off the ordered plugin graph, registers each
 * into a `ContributionRegistry` (`registry.register(c)`), and resolves
 * `meta.adapters[key]` to the layer factory exported by that package
 * for `meta.port`. `TtsPort.key` pins the port tag so a renamed port
 * fails typecheck here, not silently at runtime.
 */

/**
 * Declared contributions. `capability` entries name the port and the
 * adapter keys that implement it; `stage` entries name the pipeline
 * stage the capability serves (RunRecord.stage vocabulary). Adapter
 * keys → packages: "stub" → @ktb/eval-adapter-stub TtsPort layer,
 * "edge-tts" → @ktb/eval-adapter-local `makeLocalTts`.
 */
export const ttsContributions: readonly Contribution[] = [
	{
		kind: "eval.capability",
		id: "tts",
		version: "1",
		meta: {
			port: TtsPort.key,
			adapters: {
				stub: "@ktb/eval-adapter-stub",
				"edge-tts": "@ktb/eval-adapter-local",
			},
		},
	},
	{
		kind: "eval.stage",
		id: "synthesize",
		version: "1",
		meta: { port: TtsPort.key },
	},
];

export const ttsPlugin = definePlugin({
	id: "transcription.tts",
	contributions: ttsContributions,
});

export const plugins: readonly Plugin[] = [ttsPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"transcription.tts": true;
	}
}
