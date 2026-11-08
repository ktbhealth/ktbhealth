import { LanguageModel } from "effect/ai";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it, vi } from "vitest";

import type { Anamnesis } from "@ktb/anamnesis";
import { AnamnesisEngine } from "@ktb/anamnesis/services";
import {
	AnamnesisEngineLive,
	heuristicAnamnesisEngineLive,
	makeAnamnesisEngine,
} from "./services.ts";

const section = (content: string) => ({
	content,
	confidence: "alta" as const,
	evidence: ["evidência"],
});

const MOCK_ANAMNESIS: Anamnesis = {
	queixa_principal: section("Dor de cabeça"),
	hda: section("Há 3 dias"),
	antecedentes: section("Nega"),
	alergias: section("Nega"),
	medicamentos_em_uso: section("Nega"),
	exame_fisico: section("N/A"),
	hipoteses: section("Enxaqueca"),
	conduta: section("Dipirona"),
};

/** Minimal LanguageModel fake — only generateObject is exercised. */
const fakeModel = (
	generateObject: LanguageModel.LanguageModel["generateObject"],
): LanguageModel.LanguageModel =>
	({
		[LanguageModel.TypeId]: LanguageModel.TypeId,
		generateText: () => Effect.die("unused"),
		generateObject,
		streamText: () => {
			throw new Error("unused");
		},
	}) as unknown as LanguageModel.LanguageModel;

const okObject = <A>(value: A) =>
	vi.fn(
		() =>
			Effect.succeed(
				new LanguageModel.GenerateObjectResponse(value as never, [] as never),
			) as never,
	);

const failingModel = () => fakeModel((() => Effect.fail(new Error("provider down"))) as never);

describe("AnamnesisEngine", () => {
	it("extracts via the provided LanguageModel", async () => {
		const gen = okObject(MOCK_ANAMNESIS);
		const layer = makeAnamnesisEngine("test").pipe(
			Layer.provide(Layer.succeed(LanguageModel.LanguageModel, fakeModel(gen))),
		);
		const engine = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* AnamnesisEngine;
			}).pipe(Effect.provide(layer)),
		);
		const res = await Effect.runPromise(engine.extract({ transcript: "paciente com dor" }));
		expect(res.engine).toBe("test");
		expect(res.anamnesis.queixa_principal.content).toBe("Dor de cabeça");
		expect(res.anamnesis.historico).toBeUndefined();
		expect(gen).toHaveBeenCalledOnce();
	});

	it("sends patient history as prompt context and records it in historico", async () => {
		const gen = okObject(MOCK_ANAMNESIS);
		const layer = makeAnamnesisEngine("test").pipe(
			Layer.provide(Layer.succeed(LanguageModel.LanguageModel, fakeModel(gen))),
		);
		const engine = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* AnamnesisEngine;
			}).pipe(Effect.provide(layer)),
		);
		const history = {
			count: 1,
			visits: [
				{
					id: 5,
					date: "2026-03-01T10:00:00.000Z",
					chiefComplaint: "Dor de cabeça",
					plan: "Repouso",
				},
			],
		};
		const res = await Effect.runPromise(engine.extract({ transcript: "retorno", history }));
		expect(res.anamnesis.historico?.content).toContain("Consultas anteriores (1):");
		const call = (gen.mock.calls as unknown as [[{ prompt: unknown }]])[0]![0];
		expect(JSON.stringify(call.prompt)).toContain("PATIENT HISTORY");
		expect(JSON.stringify(call.prompt)).toContain("Dor de cabeça");
	});

	it("falls back to heuristic when the model fails", async () => {
		const layer = makeAnamnesisEngine("openai").pipe(
			Layer.provide(Layer.succeed(LanguageModel.LanguageModel, failingModel())),
		);
		const engine = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* AnamnesisEngine;
			}).pipe(Effect.provide(layer)),
		);
		const res = await Effect.runPromise(engine.extract({ transcript: "paciente relata febre" }));
		expect(res.engine).toBe("openai!fallback");
		expect(res.anamnesis.queixa_principal.content).toBeTruthy();
	});

	it("heuristic fallback still attaches historico when history is given", async () => {
		const layer = makeAnamnesisEngine("openai").pipe(
			Layer.provide(Layer.succeed(LanguageModel.LanguageModel, failingModel())),
		);
		const engine = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* AnamnesisEngine;
			}).pipe(Effect.provide(layer)),
		);
		const res = await Effect.runPromise(
			engine.extract({
				transcript: "paciente relata tosse",
				history: {
					count: 1,
					visits: [
						{
							id: 2,
							date: "2026-01-01T00:00:00.000Z",
							chiefComplaint: "Tosse",
							plan: null,
						},
					],
				},
			}),
		);
		expect(res.engine).toBe("openai!fallback");
		expect(res.anamnesis.historico?.content).toContain("Consultas anteriores (1):");
	});

	it("heuristic engine extracts without a model", async () => {
		const engine = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* AnamnesisEngine;
			}).pipe(Effect.provide(heuristicAnamnesisEngineLive)),
		);
		const res = await Effect.runPromise(engine.extract({ transcript: "paciente relata tosse" }));
		expect(res.engine).toBe("heuristic");
	});
});

describe("AnamnesisEngineLive selection", () => {
	it("builds a layer for each config branch", () => {
		expect(AnamnesisEngineLive({ anthropicApiKey: "k" })).toBeDefined();
		expect(
			AnamnesisEngineLive({
				openAiApiKey: "k",
				openAiBaseUrl: "http://localhost:1234/v1",
				openAiModel: "m",
				anthropicModel: "claude-x",
			}),
		).toBeDefined();
		expect(AnamnesisEngineLive({ openAiApiKey: "k" })).toBeDefined();
		expect(
			AnamnesisEngineLive({ workersAi: { run: async () => ({ response: "{}" }) } }),
		).toBeDefined();
		expect(AnamnesisEngineLive({})).toBe(heuristicAnamnesisEngineLive);
	});
});
