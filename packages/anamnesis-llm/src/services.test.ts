import { LanguageModel } from "effect/ai";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import { describe, expect, it, vi } from "vitest";

import type { Anamnesis, AnamnesisReview } from "@ktb/anamnesis";
import { AnamnesisEngine, ReviewEngine } from "@ktb/anamnesis/services";
import {
	AnamnesisEngineLive,
	heuristicAnamnesisEngineLive,
	makeAnamnesisEngine,
	makeOllamaReviewEngine,
	makeReviewEngine,
	ReviewEngineLive,
	selectReviewProvider,
} from "./services.ts";
import { reviewViaOllama } from "./review.ts";

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
	// FetchHttpClient reads globalThis.fetch once via a cached Context.Reference,
	// so tests inject the Fetch service explicitly instead of stubGlobal("fetch").
	const okFetch = () =>
		vi.fn<typeof fetch>(
			async () =>
				new Response(JSON.stringify({ message: { content: JSON.stringify(MOCK_REVIEW) } }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);

	const run = <A>(eff: Effect.Effect<A>, fetchImpl: typeof fetch) =>
		Effect.runPromise(eff.pipe(Effect.provideService(FetchHttpClient.Fetch, fetchImpl)));

	const getEngine = () =>
		Effect.runPromise(
			Effect.gen(function* () {
				return yield* ReviewEngine;
			}).pipe(Effect.provide(makeOllamaReviewEngine("http://localhost:11434", "qwen3:8b"))),
		);

	it("returns a parsed review and caches it", async () => {
		const fetchMock = okFetch();
		const engine = await getEngine();
		const first = await run(engine.review("t", MOCK_ANAMNESIS), fetchMock);
		const second = await run(engine.review("t", MOCK_ANAMNESIS), fetchMock);
		expect(first).toEqual({ review: MOCK_REVIEW, engine: "ollama:qwen3:8b" });
		expect(second).toEqual(first);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("degrades with pull instructions on 404", async () => {
		const engine = await getEngine();
		const res = await run(
			engine.review("t", MOCK_ANAMNESIS),
			vi.fn<typeof fetch>(async () => new Response("missing", { status: 404 })),
		);
		expect(res.review).toBeNull();
		expect(res.review === null && res.reason).toContain("ollama pull qwen3:8b");
	});

	it("degrades with serve instructions when fetch fails", async () => {
		const engine = await getEngine();
		const res = await run(
			engine.review("t", MOCK_ANAMNESIS),
			vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")),
		);
		expect(res.review).toBeNull();
		expect(res.review === null && res.reason).toContain("ollama serve");
	});

	it("degrades on timeout aborts", async () => {
		const engine = await getEngine();
		const res = await run(
			engine.review("t", MOCK_ANAMNESIS),
			vi
				.fn<typeof fetch>()
				.mockRejectedValue(new DOMException("The operation timed out", "TimeoutError")),
		);
		expect(res.review).toBeNull();
		expect(res.review === null && res.reason).toContain("ollama serve");
	});

	it("stringifies non-Error failures in the degrade reason", async () => {
		// HttpClient.make only allows HttpClientError failures, so a defect
		// exercises the same non-Error degrade path.
		const failingClient = HttpClient.make(() => Effect.die("plain failure"));
		const res = await Effect.runPromise(
			reviewViaOllama({
				baseUrl: "http://localhost:11434",
				model: "qwen3:8b",
				transcript: "t",
				anamnesis: MOCK_ANAMNESIS,
			}).pipe(Effect.provide(Layer.succeed(HttpClient.HttpClient, failingClient))),
		);
		expect(res.review).toBeNull();
		expect(res.review === null && res.reason).toContain("plain failure");
	});

	it("degrades on defects like circular JSON payloads", async () => {
		const circular: Record<string, unknown> = { ...MOCK_ANAMNESIS };
		circular.self = circular;
		const res = await Effect.runPromise(
			reviewViaOllama({
				baseUrl: "http://localhost:11434",
				model: "qwen3:8b",
				transcript: "t",
				anamnesis: circular as unknown as Anamnesis,
			}).pipe(Effect.provide(FetchHttpClient.layer)),
		);
		expect(res.review).toBeNull();
		expect(res.review === null && res.reason).toContain("Segunda opinião falhou");
	});

	it("degrades with serve instructions when the request times out", async () => {
		vi.useFakeTimers();
		try {
			const engine = await getEngine();
			const pending = run(
				engine.review("t", MOCK_ANAMNESIS),
				vi.fn<typeof fetch>(() => new Promise<Response>(() => {})),
			);
			await vi.advanceTimersByTimeAsync(181_000);
			const res = await pending;
			expect(res.review).toBeNull();
			expect(res.review === null && res.reason).toContain("ollama serve");
		} finally {
			vi.useRealTimers();
		}
	});

	it("degrades on non-404 HTTP errors and bad JSON", async () => {
		const engine = await getEngine();
		const res = await run(
			engine.review("t", MOCK_ANAMNESIS),
			vi.fn<typeof fetch>(async () => new Response("err", { status: 500 })),
		);
		expect(res.review).toBeNull();
		expect(res.review === null && res.reason).toContain("ollama api: 500");

		const engine2 = await getEngine();
		const res2 = await run(
			engine2.review("t2", MOCK_ANAMNESIS),
			vi.fn<typeof fetch>(async () => new Response("not json", { status: 200 })),
		);
		expect(res2.review).toBeNull();
		expect(res2.review === null && res2.reason).toContain("Segunda opinião falhou");

		const engine3 = await getEngine();
		const res3 = await run(
			engine3.review("t3", MOCK_ANAMNESIS),
			vi.fn<typeof fetch>(
				async () =>
					new Response(JSON.stringify({ message: { content: "garbage{" } }), { status: 200 }),
			),
		);
		expect(res3.review).toBeNull();
		expect(res3.review === null && res3.reason).toContain("Segunda opinião falhou");

		const engine4 = await getEngine();
		const res4 = await run(
			engine4.review("t4", MOCK_ANAMNESIS),
			vi.fn<typeof fetch>(async () => new Response(JSON.stringify({}), { status: 200 })),
		);
		expect(res4.review).toBeNull();
		expect(res4.review === null && res4.reason).toContain("Segunda opinião falhou");
	});

	it("expires ollama cached reviews after the TTL", async () => {
		vi.useFakeTimers();
		try {
			const fetchMock = okFetch();
			const engine = await getEngine();
			await run(engine.review("t", MOCK_ANAMNESIS), fetchMock);
			vi.setSystemTime(Date.now() + 6 * 60_000);
			await run(engine.review("t", MOCK_ANAMNESIS), fetchMock);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});
