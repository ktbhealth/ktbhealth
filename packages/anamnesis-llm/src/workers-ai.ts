import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { Anamnesis, ExtractInput } from "@ktb/anamnesis";
import { anamnesisWithHistory, HeuristicExtractor } from "@ktb/anamnesis";
import { AnamnesisEngine } from "@ktb/anamnesis/services";
import { AnamnesisSchema } from "@ktb/anamnesis/schema";
import { buildPrompt } from "./prompt.ts";

/**
 * Minimal Workers AI binding surface — structurally typed so the host
 * stays runtime-agnostic (workerd `env.AI` satisfies this).
 */
export interface WorkersAiBinding {
	run(model: string, inputs: unknown): Promise<unknown>;
}

export const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const heuristicExtract = (transcript: string): Effect.Effect<Anamnesis> =>
	Effect.promise(() => new HeuristicExtractor().extract(transcript));

/** Extract text from the various Workers AI response shapes. */
export const responseText = (raw: unknown): string => {
	if (typeof raw === "string") return raw;
	if (raw && typeof raw === "object") {
		const r = raw as Record<string, unknown>;
		if (typeof r.response === "string") return r.response;
		if (typeof r.result === "string") return r.result;
		if (r.response && typeof r.response === "object") {
			const inner = r.response as Record<string, unknown>;
			if (typeof inner.response === "string") return inner.response;
		}
	}
	throw new Error("Workers AI returned an unrecognized response shape");
};

export const runChat = (
	ai: WorkersAiBinding,
	model: string,
	system: string,
	user: string,
): Effect.Effect<string, unknown> =>
	Effect.tryPromise({
		try: () =>
			ai.run(model, {
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
				max_tokens: 4096,
			}),
		catch: (e) => e,
	}).pipe(Effect.flatMap((raw) => Effect.try({ try: () => responseText(raw), catch: (e) => e })));

/** Models sometimes wrap JSON in prose/fences — extract the outermost object. */
const extractJson = (text: string): unknown => {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end <= start) throw new Error("no JSON object in model output");
	return JSON.parse(text.slice(start, end + 1));
};

/** AnamnesisEngine backed by the Workers AI binding (JSON mode via prompt). */
export const makeWorkersAiAnamnesisEngine = (
	ai: WorkersAiBinding,
	model: string,
): Layer.Layer<AnamnesisEngine> =>
	Layer.succeed(
		AnamnesisEngine,
		AnamnesisEngine.of({
			extract: Effect.fn("AnamnesisEngine.extract")((input: ExtractInput) =>
				runChat(ai, model, buildPrompt(input.history), input.transcript).pipe(
					Effect.flatMap((text) =>
						Effect.try({ try: () => extractJson(text), catch: (e) => e }).pipe(
							Effect.flatMap((raw) => Schema.decodeUnknownEffect(AnamnesisSchema)(raw)),
						),
					),
					Effect.map((anamnesis) => ({
						anamnesis: anamnesisWithHistory(anamnesis, input.history),
						engine: `workers-ai:${model}`,
					})),
					Effect.catch((error) =>
						Effect.logWarning(`workers-ai extraction failed, using heuristic`, {
							engine: `workers-ai:${model}`,
							error: String(error),
						}).pipe(
							Effect.andThen(heuristicExtract(input.transcript)),
							Effect.map((anamnesis) => ({
								anamnesis: anamnesisWithHistory(anamnesis, input.history),
								engine: `workers-ai:${model}!fallback`,
							})),
						),
					),
				),
			),
		}),
	);
