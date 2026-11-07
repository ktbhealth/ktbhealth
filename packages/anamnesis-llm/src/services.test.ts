import { LanguageModel } from "effect/ai";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Anamnesis, AnamnesisReview } from "@ktb/anamnesis";
import {
	AnamnesisEngine,
	AnamnesisEngineLive,
	heuristicAnamnesisEngineLive,
	makeAnamnesisEngine,
	makeOllamaReviewEngine,
	makeReviewEngine,
	ReviewEngine,
	ReviewEngineLive,
	selectReviewProvider,
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

const MOCK_REVIEW: AnamnesisReview = {
	lacunas: [],
	hipoteses: [
		{
			diagnostico: "Enxaqueca",
			probabilidade: "media",
			raciocinio: "padrão típico",
			evidence: ["dor de cabeça"],
			investigar: ["exame neurológico"],
		},
	],
	sinais_de_alerta: [],
	inconsistencias: [],
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
		const res = await Effect.runPromise(engine.extract("paciente com dor"));
		expect(res.engine).toBe("test");
		expect(res.anamnesis.queixa_principal.content).toBe("Dor de cabeça");
		expect(gen).toHaveBeenCalledOnce();
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
		const res = await Effect.runPromise(engine.extract("paciente relata febre"));
		expect(res.engine).toBe("openai!fallback");
		expect(res.anamnesis.queixa_principal.content).toBeTruthy();
	});

	it("heuristic engine extracts without a model", async () => {
		const engine = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* AnamnesisEngine;
			}).pipe(Effect.provide(heuristicAnamnesisEngineLive)),
		);
		const res = await Effect.runPromise(engine.extract("paciente relata tosse"));
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
		expect(AnamnesisEngineLive({})).toBe(heuristicAnamnesisEngineLive);
	});
});

describe("selectReviewProvider", () => {
	it("honours forced provider", () => {
		expect(selectReviewProvider({ reviewProvider: "anthropic" })).toBe("anthropic");
		expect(selectReviewProvider({ reviewProvider: "openai" })).toBe("openai");
		expect(selectReviewProvider({ reviewProvider: "ollama" })).toBe("ollama");
	});

	it("ignores unknown forced values", () => {
		expect(selectReviewProvider({ reviewProvider: "bogus" })).toBe("ollama");
	});

	it("prefers anthropic, then openai, then ollama", () => {
		expect(selectReviewProvider({ anthropicApiKey: "a", openAiApiKey: "o" })).toBe("anthropic");
		expect(selectReviewProvider({ openAiApiKey: "o" })).toBe("openai");
		expect(selectReviewProvider({})).toBe("ollama");
	});
});

describe("ReviewEngine (cloud)", () => {
	const getEngine = async (model: LanguageModel.LanguageModel) =>
		Effect.runPromise(
			Effect.gen(function* () {
				return yield* ReviewEngine;
			}).pipe(
				Effect.provide(
					makeReviewEngine("openai", "gpt-4o").pipe(
						Layer.provide(Layer.succeed(LanguageModel.LanguageModel, model)),
					),
				),
			),
		);

	it("returns a successful review and caches it", async () => {
		const gen = okObject(MOCK_REVIEW);
		const engine = await getEngine(fakeModel(gen));
		const first = await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
		const second = await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
		expect(first).toEqual({ review: MOCK_REVIEW, engine: "openai:gpt-4o" });
		expect(second).toEqual(first);
		expect(gen).toHaveBeenCalledOnce();
	});

	it("stringifies non-Error failures in the degrade reason", async () => {
		const model = fakeModel((() => Effect.fail("raw failure")) as never);
		const engine = await getEngine(model);
		const res = await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
		expect(res.review).toBeNull();
		expect(res.review === null && res.reason).toContain("raw failure");
	});

	it("degrades on model failure and never caches it", async () => {
		let calls = 0;
		const model = fakeModel((() => {
			calls++;
			return Effect.fail(new Error("boom"));
		}) as never);
		const engine = await getEngine(model);
		const first = await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
		const second = await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
		expect(first.review).toBeNull();
		expect(first.review === null && first.reason).toContain("Segunda opinião falhou");
		expect(second.review).toBeNull();
		expect(calls).toBe(2);
	});

	it("expires cached reviews after the TTL", async () => {
		vi.useFakeTimers();
		try {
			const gen = okObject(MOCK_REVIEW);
			const engine = await getEngine(fakeModel(gen));
			await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
			vi.setSystemTime(Date.now() + 6 * 60_000);
			await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
			expect(gen).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("ReviewEngineLive selection", () => {
	it("builds a layer for each branch", () => {
		expect(ReviewEngineLive({ anthropicApiKey: "k" })).toBeDefined();
		expect(ReviewEngineLive({ openAiApiKey: "k", reviewModel: "m" })).toBeDefined();
		expect(ReviewEngineLive({})).toBeDefined();
		expect(ReviewEngineLive({ reviewProvider: "anthropic" })).toBeDefined();
		expect(ReviewEngineLive({ reviewProvider: "openai", openAiApiKey: "k" })).toBeDefined();
	});
});

describe("ReviewEngine (ollama)", () => {
	const okFetch = () =>
		vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ message: { content: JSON.stringify(MOCK_REVIEW) } }),
		});

	beforeEach(() => vi.unstubAllGlobals());
	afterEach(() => vi.unstubAllGlobals());

	const getEngine = () =>
		Effect.runPromise(
			Effect.gen(function* () {
				return yield* ReviewEngine;
			}).pipe(Effect.provide(makeOllamaReviewEngine("http://localhost:11434", "qwen3:8b"))),
		);

	it("returns a parsed review and caches it", async () => {
		const fetchMock = okFetch();
		vi.stubGlobal("fetch", fetchMock);
		const engine = await getEngine();
		const first = await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
		const second = await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
		expect(first).toEqual({ review: MOCK_REVIEW, engine: "ollama:qwen3:8b" });
		expect(second).toEqual(first);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("degrades with pull instructions on 404", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
		const engine = await getEngine();
		const res = await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
		expect(res.review).toBeNull();
		expect(res.review === null && res.reason).toContain("ollama pull qwen3:8b");
	});

	it("degrades with serve instructions when fetch fails", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
		const engine = await getEngine();
		const res = await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
		expect(res.review).toBeNull();
		expect(res.review === null && res.reason).toContain("ollama serve");
	});

	it("degrades on timeout aborts", async () => {
		const timeout = new Error("The operation timed out");
		timeout.name = "TimeoutError";
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));
		const engine = await getEngine();
		const res = await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
		expect(res.review).toBeNull();
		expect(res.review === null && res.reason).toContain("ollama serve");
	});

	it("stringifies non-Error rejections in the degrade reason", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue("plain failure"));
		const engine = await getEngine();
		const res = await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
		expect(res.review).toBeNull();
		expect(res.review === null && res.reason).toContain("plain failure");
	});

	it("degrades on non-404 HTTP errors and bad JSON", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
		const engine = await getEngine();
		const res = await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
		expect(res.review).toBeNull();
		expect(res.review === null && res.reason).toContain("ollama api: 500");

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }),
		);
		const engine2 = await getEngine();
		const res2 = await Effect.runPromise(engine2.review("t2", MOCK_ANAMNESIS));
		expect(res2.review).toBeNull();
		expect(res2.review === null && res2.reason).toContain("Segunda opinião falhou");
	});

	it("expires ollama cached reviews after the TTL", async () => {
		vi.useFakeTimers();
		try {
			const fetchMock = okFetch();
			vi.stubGlobal("fetch", fetchMock);
			const engine = await getEngine();
			await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
			vi.setSystemTime(Date.now() + 6 * 60_000);
			await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
			expect(fetchMock).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});
