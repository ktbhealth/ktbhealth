import { definePlugin, type Plugin } from "@ktb/kernel";
import { EvalPort, type Contribution } from "@ktb/eval-core";
import { LlmPort } from "@ktb/eval-consult/ports";

/**
 * llm.eval — generative + decision capability plugin (P-074 phase 3,
 * P-070).
 *
 * DATA-ONLY registrar, same contract as transcription.tts: declares
 * the eval-core contributions (on the manifest's `contributions`
 * channel) and adapter keys for the two model ports — LlmPort
 * (generative, ACP-delegated: script_gen + cleanup stages) and
 * EvalPort (typed decision/judge). Adapter implementations stay in the
 * exempt-edge packages (@ktb/eval-adapter-stub/-local/-cloud) because
 * plugins/* is inside arch-policy PORT_GLOBS — the Jev adapter's
 * provider path literal alone would trip ktb-arch/provider-lockin
 * here. See plugins/transcription-tts/src/index.ts for the full
 * mechanism.
 *
 * The ACP wire contract (acp.ts) and TaskEnvelope codec are DOMAIN
 * code and stay in eval.consult — this plugin only declares which
 * adapters speak it.
 *
 * Adapter keys → packages: "stub" → @ktb/eval-adapter-stub,
 * "acp" → @ktb/eval-adapter-local `makeAcpLlm`,
 * "jev" → @ktb/eval-adapter-local `makeJevEval`,
 * "systemone" → @ktb/eval-adapter-local `makeSystemOneEval` — the
 * TypeSafe `/v1/systemone` wire shape, served locally by OpenJev
 * (`wev serve`), razorback16/openjev or amithgc/local-jev.
 */

/**
 * Declared contributions. `llm` covers LlmPort.generate (stage
 * `script_gen`) and LlmPort.correct (stage `cleanup`, EditList-pinned);
 * `eval` covers EvalPort.judge (stage `judge`). Stage ids match the
 * RunRecord.stage vocabulary the adapters emit.
 */
export const llmEvalContributions: readonly Contribution[] = [
	{
		kind: "eval.capability",
		id: "llm",
		version: "1",
		meta: {
			port: LlmPort.key,
			adapters: {
				stub: "@ktb/eval-adapter-stub",
				acp: "@ktb/eval-adapter-local",
			},
		},
	},
	{
		kind: "eval.capability",
		id: "eval",
		version: "1",
		meta: {
			port: EvalPort.key,
			adapters: {
				stub: "@ktb/eval-adapter-stub",
				jev: "@ktb/eval-adapter-local",
				systemone: "@ktb/eval-adapter-local",
			},
		},
	},
	{
		kind: "eval.stage",
		id: "script_gen",
		version: "1",
		meta: { port: LlmPort.key },
	},
	{
		kind: "eval.stage",
		id: "cleanup",
		version: "1",
		meta: { port: LlmPort.key },
	},
	{
		kind: "eval.stage",
		id: "judge",
		version: "1",
		meta: { port: EvalPort.key },
	},
];

export const llmEvalPlugin = definePlugin({
	id: "llm.eval",
	contributions: llmEvalContributions,
});

export const plugins: readonly Plugin[] = [llmEvalPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"llm.eval": true;
	}
}
