/**
 * generate.ts — dataset generation orchestration (T-102).
 *
 * Composition: personas × .eta template → Sample manifests → TTS →
 * store, all through `runBatch` — resilience (retry/timeout/
 * concurrency/isolation) is the runner's, this module only wires
 * domain steps. Ports injected via the environment; no fs, no
 * provider literals.
 */

import * as Effect from "effect/Effect";

import { runBatch, type BatchOptions, type BatchResult } from "./batch.ts";
import type { LocaleProfile } from "./locale.ts";
import { DatasetStorePort, PortError, ReportPort, TtsPort } from "./ports.ts";
import type { AcousticProfile, Persona, Sample } from "./schema.ts";
import { renderScript } from "./scriptgen.ts";

/** FNV-1a hex — dependency-free content hash for ids/scriptHash
 * (domain code cannot use node:crypto). */
export const fnvHex = (s: string): string => {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
};

export interface GenerateInput {
	readonly datasetVersion: string;
	readonly personas: readonly Persona[];
	/** `.eta` template source (adapter/test reads the file — pick the
	 * locale-keyed one, e.g. `templates/pt-BR/consultation.eta`). */
	readonly template: string;
	/** Locale profile — script slot content. Default pt-BR; pair it
	 * with the matching locale's template. */
	readonly profile?: LocaleProfile;
	/** Per-persona acoustic profile — the caller owns voice choice so
	 * provider aliases stay out of this module too. */
	readonly acoustic: (persona: Persona, index: number) => AcousticProfile;
	/** Base seed — sample i renders with seed + i for replayability. */
	readonly seed?: number;
	readonly batch?: BatchOptions<PortError>;
}

export interface GeneratedSample {
	readonly sample: Sample;
	readonly template: string;
}

export const generateDataset = (
	input: GenerateInput,
): Effect.Effect<
	BatchResult<Persona, GeneratedSample, PortError>,
	never,
	TtsPort | DatasetStorePort | ReportPort
> =>
	Effect.gen(function* () {
		const tts = yield* TtsPort;
		const store = yield* DatasetStorePort;
		const report = yield* ReportPort;
		const baseSeed = input.seed ?? 0;

		return yield* runBatch({
			items: input.personas,
			options: input.batch,
			step: (persona, index) =>
				Effect.gen(function* () {
					const render = renderScript({
						template: input.template,
						persona,
						seed: baseSeed + index,
						profile: input.profile,
					});
					const acoustic = input.acoustic(persona, index);
					// datasetVersion is part of the id — regenerating under a
					// new version must coexist, not overwrite the old manifest.
					const id = `s-${fnvHex(`${input.datasetVersion}:${persona.region}:${persona.ageBand}:${persona.register}:${persona.specialty}:${baseSeed + index}`)}`;

					const { audio, record } = yield* tts.synthesize({
						script: render.script,
						voiceId: acoustic.voiceId,
						acoustic,
					});

					const sample: Sample = {
						id,
						datasetVersion: input.datasetVersion,
						origin: "synthetic",
						script: render.script,
						scriptHash: fnvHex(render.script),
						persona,
						acoustic,
						audio,
						gold: { validatedBy: "generator", entities: [...render.entities] },
						status: "pending",
					};

					yield* store.putSample(sample);
					yield* report.append({ ...record, sampleId: id });
					return { sample, template: input.template } satisfies GeneratedSample;
				}),
		});
	});
