import { definePlugin, type Plugin } from "@ktb/kernel";
import type { Contribution } from "@ktb/eval-core";
import { AsrPort } from "@ktb/eval-consult/ports";

/**
 * transcription.asr — ASR capability plugin (P-074 phase 3).
 *
 * DATA-ONLY registrar, same contract as transcription.tts: declares
 * the eval-core contributions and adapter keys for AsrPort; adapter
 * implementations stay in the exempt-edge packages
 * (@ktb/eval-adapter-stub/-local/-cloud) because plugins/* is inside
 * arch-policy PORT_GLOBS (no node:*, provider literals, or adapter
 * imports). See plugins/transcription-tts/src/index.ts for the full
 * mechanism — Phase 4 resolves `meta.adapters[key]` per `meta.port`.
 *
 * Adapter keys → packages: "stub" → @ktb/eval-adapter-stub AsrPort
 * layer, "faster-whisper" → @ktb/eval-adapter-local `makeLocalAsr`,
 * "workers-ai" → @ktb/eval-adapter-cloud `makeWorkersAiAsr`.
 */
export const asrPlugin = definePlugin({
	id: "transcription.asr",
});

export const plugins: readonly Plugin[] = [asrPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"transcription.asr": true;
	}
}

/**
 * Declared contributions. ASR is the PHI-sensitive port: every adapter
 * declares `egress` on the port shape and `guardAsrPort` (eval.consult
 * phi.ts) enforces provenance before any egress-capable adapter runs —
 * that policy is domain code and stays in eval.consult.
 */
export const asrContributions: readonly Contribution[] = [
	{
		kind: "capability",
		id: "asr",
		version: "1",
		meta: {
			port: AsrPort.key,
			adapters: {
				stub: "@ktb/eval-adapter-stub",
				"faster-whisper": "@ktb/eval-adapter-local",
				"workers-ai": "@ktb/eval-adapter-cloud",
			},
		},
	},
	{
		kind: "stage",
		id: "transcribe",
		version: "1",
		meta: { port: AsrPort.key },
	},
];
